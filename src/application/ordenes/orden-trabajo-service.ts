import type { EstadoOrdenTrabajo, Prisma, PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/errors/domain-error.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import type { OrdenTrabajoCreateInput, OrdenTrabajoTransitionInput } from '../../shared/schemas/orden-trabajo.schema.js';
import { CATEGORIA_CONSTRUCCION_MODULAR, PAQUETE_CONSTRUCCION_MODULAR } from '../operacion/paquete-construccion-modular.js';

const SIGUIENTE: Partial<Record<EstadoOrdenTrabajo, EstadoOrdenTrabajo>> = {
  BORRADOR: 'COTIZADA',
  COTIZADA: 'APROBADA',
  APROBADA: 'EN_PRODUCCION',
  EN_PRODUCCION: 'TERMINADA_TECNICA',
  TERMINADA_TECNICA: 'PENDIENTE_CIERRE',
};

export const ETIQUETAS_ESTADO: Record<EstadoOrdenTrabajo, string> = {
  BORRADOR: 'Borrador', COTIZADA: 'Cotizada', APROBADA: 'Aprobada',
  EN_PRODUCCION: 'En producción', TERMINADA_TECNICA: 'Terminada técnicamente',
  PENDIENTE_CIERRE: 'Pendiente de cierre', CERRADA: 'Cerrada', CANCELADA: 'Cancelada',
};

class InvalidStateTransitionError extends ValidationError {
  override readonly code = 'INVALID_STATE_TRANSITION';
}

function present<T extends { estado: EstadoOrdenTrabajo }>(order: T) {
  return { ...order, etiquetaEstado: ETIQUETAS_ESTADO[order.estado] };
}

export class OrdenTrabajoService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async companyDe(userId: string, companyId: string) {
    const company = await withTenant(userId, (tx) => tx.company.findFirst({ where: { id: companyId, userId } }));
    if (!company) throw new NotFoundError('Negocio no encontrado');
    return company;
  }

  private etapasPorDefecto(industry: string | null) {
    if (industry !== CATEGORIA_CONSTRUCCION_MODULAR) return [];
    return PAQUETE_CONSTRUCCION_MODULAR.screens.etapasPorDefecto.map((etapa, index) => ({
      clave: etapa.clave, nombre: etapa.etiqueta, orden: index + 1, esEntrega: etapa.entrega,
    }));
  }

  private async ordenDe(userId: string, id: string) {
    const order = await withTenant(userId, (tx) => tx.ordenTrabajo.findFirst({ where: { id, userId } }));
    if (!order) throw new NotFoundError('Orden de trabajo no encontrada');
    return order;
  }

  async create(userId: string, companyId: string, input: OrdenTrabajoCreateInput, actor: TraceActor) {
    const company = await this.companyDe(userId, companyId);
    const duplicate = await withTenant(userId, (tx) => tx.ordenTrabajo.findFirst({ where: { companyId, codigo: input.codigo } }));
    if (duplicate) throw new ConflictError('Ya existe una orden con ese código en el negocio', { field: 'codigo' });

    const plantillaId = input.plantillaId ?? null;
    let plantilla: Prisma.PlantillaOrdenGetPayload<{ include: { etapas: true } }> | null = null;
    if (plantillaId) {
      plantilla = await withTenant(userId, (tx) => tx.plantillaOrden.findFirst({
          where: {
            id: plantillaId,
            OR: [
              { companyId },
              ...(company.industry === CATEGORIA_CONSTRUCCION_MODULAR ? [{ companyId: null }] : []),
            ],
          },
          include: { etapas: { orderBy: { orden: 'asc' } } },
        }));
      if (!plantilla) throw new NotFoundError('Modelo de orden no encontrado');
    }

    const etapas = plantilla?.etapas ?? this.etapasPorDefecto(company.industry);
    const renglonesBase = (plantilla?.renglonesBase ?? []) as Prisma.InputJsonValue;

    return withTenant(userId, async (tx) => {
      const order = await tx.ordenTrabajo.create({ data: {
        companyId, userId, codigo: input.codigo, descripcion: input.descripcion,
        cliente: input.cliente, plantillaId,
        renglonesBase,
        ...(etapas.length > 0 ? { etapas: { create: etapas.map((etapa) => ({
          userId, clave: etapa.clave, nombre: etapa.nombre, orden: etapa.orden, esEntrega: etapa.esEntrega,
        })) } } : {}),
        fechaInicio: input.fechaInicio ? new Date(`${input.fechaInicio}T00:00:00.000Z`) : null,
      }, include: { etapas: { orderBy: { orden: 'asc' } } } });
      await recordTraceAudit({ entityType: 'OrdenTrabajo', entityId: order.id, action: 'create', actor, after: order }, tx);
      return present(order);
    });
  }

  async listTemplates(userId: string, companyId: string) {
    const company = await this.companyDe(userId, companyId);
    const templates = await withTenant(userId, (tx) => tx.plantillaOrden.findMany({
      where: {
        OR: [
          { companyId },
          ...(company.industry === CATEGORIA_CONSTRUCCION_MODULAR ? [{ companyId: null }] : []),
        ],
      },
      include: { etapas: { orderBy: { orden: 'asc' } } },
      orderBy: [{ companyId: 'asc' }, { nombre: 'asc' }],
    }));
    return templates.map((template) => ({
      ...template,
      renglonesBase: Array.isArray(template.renglonesBase) ? template.renglonesBase : [],
    }));
  }

  async listStages(userId: string, id: string) {
    await this.ordenDe(userId, id);
    return withTenant(userId, (tx) => tx.etapaOrden.findMany({
      where: { ordenId: id, userId }, orderBy: { orden: 'asc' },
    }));
  }

  async list(userId: string, companyId: string, ordenIds?: string[]) {
    await this.companyDe(userId, companyId);
    const orders = await withTenant(userId, (tx) => tx.ordenTrabajo.findMany({ where: { companyId, userId, ...(ordenIds ? { id: { in: ordenIds } } : {}) }, orderBy: { createdAt: 'desc' } }));
    return orders.map(present);
  }

  async get(userId: string, id: string) { return present(await this.ordenDe(userId, id)); }

  async transition(userId: string, id: string, input: OrdenTrabajoTransitionInput, actor: TraceActor) {
    const actual = await this.ordenDe(userId, id);
    const cancelable = actual.estado !== 'CERRADA' && actual.estado !== 'CANCELADA';
    if (input.estado === 'CERRADA') {
      throw new InvalidStateTransitionError('Para cerrar la orden, usá el cierre de orden');
    }
    if (input.estado !== SIGUIENTE[actual.estado] && !(input.estado === 'CANCELADA' && cancelable)) {
      throw new InvalidStateTransitionError(`No se puede pasar de ${ETIQUETAS_ESTADO[actual.estado]} a ${ETIQUETAS_ESTADO[input.estado]}`);
    }

    return withTenant(userId, async (tx) => {
      const order = await tx.ordenTrabajo.update({
        where: { id },
        data: {
          estado: input.estado,
          ...(input.estado === 'TERMINADA_TECNICA' ? { fechaFinTecnica: new Date() } : {}),
        },
      });
      await recordTraceAudit({
        entityType: 'OrdenTrabajo', entityId: id, action: 'transition', actor,
        before: { estado: actual.estado }, after: { estado: input.estado }, comment: input.motivo,
      }, tx);
      return present(order);
    });
  }
}
