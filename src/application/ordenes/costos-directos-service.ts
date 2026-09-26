import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import type { ContingenciaCreateInput, CostoDirectoCreateInput } from '../../shared/schemas/costos-directos.schema.js';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const costo = <T extends { importe: unknown; estadoValidacion: string }>(row: T) => ({ ...row, importe: Number(row.importe), impactaCosto: row.estadoValidacion === 'VALIDADO' });
const evento = <T extends { cantidad: unknown; valor: unknown; recupero: unknown }>(row: T) => ({ ...row, cantidad: Number(row.cantidad), valor: Number(row.valor), recupero: row.recupero == null ? null : Number(row.recupero) });

export class CostosDirectosService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async contexto(userId: string, ordenId: string, etapaId: string) {
    const orden = await withTenant(userId, (tx) => tx.ordenTrabajo.findFirst({ where: { id: ordenId, userId }, include: { company: { select: { politicaRetrabajo: true } } } }));
    if (!orden) throw new NotFoundError('Orden de trabajo no encontrada');
    const etapa = await withTenant(userId, (tx) => tx.etapaOrden.findFirst({ where: { id: etapaId, ordenId, userId } }));
    if (!etapa) throw new NotFoundError('Etapa de la orden no encontrada');
    return { orden, etapa };
  }

  async createCosto(userId: string, ordenId: string, input: CostoDirectoCreateInput, actor: TraceActor) {
    await this.contexto(userId, ordenId, input.etapaId);
    return withTenant(userId, async (tx) => {
      const creado = await tx.costoDirectoOrden.create({ data: { ordenId, etapaId: input.etapaId, userId, categoria: input.categoria, importe: input.importe, documento: input.documento ?? null, periodoImputado: date(input.periodoImputado) } });
      await recordTraceAudit({ entityType: 'CostoDirectoOrden', entityId: creado.id, action: 'create', actor, after: creado }, tx);
      return costo(creado);
    });
  }

  async listCostos(userId: string, ordenId: string) {
    const orden = await withTenant(userId, (tx) => tx.ordenTrabajo.findFirst({ where: { id: ordenId, userId }, select: { id: true } }));
    if (!orden) throw new NotFoundError('Orden de trabajo no encontrada');
    const rows = await withTenant(userId, (tx) => tx.costoDirectoOrden.findMany({ where: { ordenId, userId }, include: { etapa: { select: { esEntrega: true } } }, orderBy: [{ periodoImputado: 'asc' }, { createdAt: 'asc' }] }));
    const data = rows.map(costo);
    return { data, resumen: { totalValidado: data.filter((x) => x.impactaCosto).reduce((sum, x) => sum + x.importe, 0), entregaInstalacionValidada: data.filter((x) => x.impactaCosto && x.etapa.esEntrega).reduce((sum, x) => sum + x.importe, 0) } };
  }

  async createContingencia(userId: string, ordenId: string, input: ContingenciaCreateInput, actor: TraceActor) {
    const { orden } = await this.contexto(userId, ordenId, input.etapaId);
    const politica = input.tipo === 'RETRABAJO' ? orden.company.politicaRetrabajo : null;
    let estadoValidacion: 'PENDIENTE' | 'MARCADO' = 'PENDIENTE';
    if (politica === 'CAMBIO_CLIENTE') {
      const adicional = input.versionPresupuestoId ? await withTenant(userId, (tx) => tx.versionPresupuesto.findFirst({ where: { id: input.versionPresupuestoId!, ordenId, userId, tipo: 'ADICIONAL', estado: 'APROBADO' } })) : null;
      if (!adicional) estadoValidacion = 'MARCADO';
    }
    return withTenant(userId, async (tx) => {
      const creado = await tx.eventoContingencia.create({ data: { ordenId, etapaId: input.etapaId, userId, tipo: input.tipo, cantidad: input.cantidad, valor: input.valor, recupero: input.recupero ?? null, causa: input.causa, tratamiento: input.tratamiento, politicaRetrabajo: politica, versionPresupuestoId: input.versionPresupuestoId ?? null, estadoValidacion } });
      await recordTraceAudit({ entityType: 'EventoContingencia', entityId: creado.id, action: 'create', actor, after: creado }, tx);
      return evento(creado);
    });
  }

  async listContingencias(userId: string, ordenId: string) {
    const orden = await withTenant(userId, (tx) => tx.ordenTrabajo.findFirst({ where: { id: ordenId, userId }, select: { id: true } }));
    if (!orden) throw new NotFoundError('Orden de trabajo no encontrada');
    const data = (await withTenant(userId, (tx) => tx.eventoContingencia.findMany({ where: { ordenId, userId }, orderBy: { createdAt: 'asc' } }))).map(evento);
    const total = (policy: string) => data.filter((x) => x.estadoValidacion === 'VALIDADO' && x.tipo === 'RETRABAJO' && x.politicaRetrabajo === policy).reduce((sum, x) => sum + x.valor - (x.recupero ?? 0), 0);
    return { data, resumen: { perdidaPeriodoValidada: total('PERDIDA_PERIODO'), cifPoolValidado: total('CIF_POOL'), adicionalValidado: total('CAMBIO_CLIENTE') } };
  }
}
