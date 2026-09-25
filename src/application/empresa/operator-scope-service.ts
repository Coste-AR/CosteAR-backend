import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ForbiddenError, NotFoundError } from '../../domain/errors/domain-error.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';

export interface OperatorScopeInput {
  unidadProductivaIds: string[];
  depositoIds: string[];
  ordenTrabajoIds: string[];
  permisos: string[];
}

export const PERMISOS_OPERADOR = [
  'ordenes.ver', 'ordenes.editar', 'ordenes.ver_margen', 'ordenes.aprobar_presupuesto',
  'ordenes.cerrar', 'inventario.mover', 'horas.cargar', 'horas.aprobar',
] as const;
export type PermisoOperador = typeof PERMISOS_OPERADOR[number];
export const esPermisoOperador = (value: string): value is PermisoOperador =>
  (PERMISOS_OPERADOR as readonly string[]).includes(value);

export class OperatorScopeService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async assertUnidad(operatorId: string, unidadProductivaId: string, actor?: TraceActor): Promise<void> {
    const allowed = await this.db.operatorUnidadProductiva.findFirst({
      where: { unidadProductivaId, membership: { operatorId, isActive: true } },
      select: { membershipId: true },
    });
    if (!allowed) {
      if (actor) await recordTraceAudit({ entityType: 'UnidadProductiva', entityId: unidadProductivaId, action: 'scope.denied', actor, comment: 'Intento de carga fuera del alcance autorizado' }, this.db);
      throw new ForbiddenError('No tenés autorización para cargar datos de esa unidad productiva.');
    }
  }

  async assertDeposito(operatorId: string, depositoId: string, actor?: TraceActor): Promise<void> {
    const allowed = await this.db.operatorDeposito.findFirst({
      where: { depositoId, membership: { operatorId, isActive: true } },
      select: { membershipId: true },
    });
    if (!allowed) {
      if (actor) await recordTraceAudit({ entityType: 'Deposito', entityId: depositoId, action: 'scope.denied', actor, comment: 'Intento de carga fuera del alcance autorizado' }, this.db);
      throw new ForbiddenError('No tenés autorización para cargar datos de ese depósito.');
    }
  }

  async tenantForDeposito(operatorId: string, depositoId: string, permission: PermisoOperador): Promise<string> {
    const allowed = await this.db.operatorDeposito.findFirst({
      where: { depositoId, membership: { operatorId, isActive: true, permisos: { has: permission } } },
      select: { membership: { select: { connection: { select: { costistId: true } } } } },
    });
    if (!allowed) throw new ForbiddenError('No tenés autorización para acceder a ese depósito.');
    return allowed.membership.connection.costistId;
  }

  async assertPermission(operatorId: string, permission: PermisoOperador): Promise<void> {
    const membership = await this.db.operatorMembership.findFirst({
      where: { operatorId, isActive: true, permisos: { has: permission } }, select: { id: true },
    });
    if (!membership) throw new ForbiddenError('No tenés permisos para esta acción.');
  }

  async tenantForCompany(operatorId: string, companyId: string, permission: PermisoOperador): Promise<string> {
    const membership = await this.db.operatorMembership.findFirst({
      where: { operatorId, isActive: true, permisos: { has: permission }, connection: { companyId } },
      select: { connection: { select: { costistId: true } } },
    });
    if (!membership) throw new ForbiddenError('No tenés permisos para esta acción.');
    return membership.connection.costistId;
  }

  async tenantForOrden(operatorId: string, ordenId: string, permission: PermisoOperador): Promise<string> {
    const allowed = await this.db.operatorOrdenTrabajo.findFirst({
      where: { ordenId, membership: { operatorId, isActive: true, permisos: { has: permission } } },
      select: { orden: { select: { userId: true } } },
    });
    if (!allowed) throw new ForbiddenError('No tenés autorización para acceder a esa orden de trabajo.');
    return allowed.orden.userId;
  }

  async tenantForPresupuesto(operatorId: string, presupuestoId: string, permission: PermisoOperador): Promise<string> {
    const allowed = await this.db.versionPresupuesto.findFirst({
      where: { id: presupuestoId, orden: { operadoresAutorizados: { some: { membership: { operatorId, isActive: true, permisos: { has: permission } } } } } },
      select: { userId: true },
    });
    if (!allowed) throw new ForbiddenError('No tenés autorización para acceder a ese presupuesto.');
    return allowed.userId;
  }

  async ordenIds(operatorId: string, companyId: string): Promise<string[]> {
    const rows = await this.db.operatorOrdenTrabajo.findMany({
      where: { orden: { companyId }, membership: { operatorId, isActive: true, permisos: { has: 'ordenes.ver' } } },
      select: { ordenId: true },
    });
    return rows.map((row) => row.ordenId);
  }

  async assertOrden(operatorId: string, ordenId: string, permission: PermisoOperador): Promise<void> {
    const allowed = await this.db.operatorOrdenTrabajo.findFirst({
      where: {
        ordenId,
        membership: { operatorId, isActive: true, permisos: { has: permission } },
      },
      select: { membershipId: true },
    });
    if (!allowed) throw new ForbiddenError('No tenés autorización para acceder a esa orden de trabajo.');
  }

  async assertLote(operatorId: string, loteId: string, actor?: TraceActor): Promise<void> {
    const lote = await this.db.loteProductivo.findUnique({ where: { id: loteId }, select: { unidadProductivaId: true } });
    if (!lote?.unidadProductivaId) {
      if (actor) await recordTraceAudit({ entityType: 'LoteProductivo', entityId: loteId, action: 'scope.denied', actor, comment: 'El lote no tiene unidad productiva autorizable' }, this.db);
      throw new ForbiddenError('El lote no está asociado a una unidad productiva autorizada.');
    }
    await this.assertUnidad(operatorId, lote.unidadProductivaId, actor);
  }

  async replace(
    companyId: string,
    operatorId: string,
    administratorId: string,
    input: OperatorScopeInput,
    actor: TraceActor,
  ): Promise<void> {
    const membership = await this.db.operatorMembership.findFirst({
      where: { operatorId, connection: { companyId, company: { userId: administratorId } } },
      include: { unidadesAutorizadas: true, depositosAutorizados: true, ordenesAutorizadas: true },
    });
    // 404 evita confirmar operadores o empresas de otro tenant.
    if (!membership) throw new NotFoundError('Cargador no encontrado');

    const [units, deposits, orders] = await Promise.all([
      this.db.unidadProductiva.count({ where: { id: { in: input.unidadProductivaIds }, companyId, deletedAt: null } }),
      this.db.deposito.count({ where: { id: { in: input.depositoIds }, companyId, deletedAt: null } }),
      this.db.ordenTrabajo.count({ where: { id: { in: input.ordenTrabajoIds }, companyId } }),
    ]);
    if (units !== new Set(input.unidadProductivaIds).size || deposits !== new Set(input.depositoIds).size || orders !== new Set(input.ordenTrabajoIds).size) {
      throw new NotFoundError('Una o más entidades autorizadas no pertenecen a la empresa');
    }

    const before = {
      unidadProductivaIds: membership.unidadesAutorizadas.map((x) => x.unidadProductivaId),
      depositoIds: membership.depositosAutorizados.map((x) => x.depositoId),
      ordenTrabajoIds: membership.ordenesAutorizadas.map((x) => x.ordenId),
      permisos: membership.permisos,
    };
    await this.db.$transaction(async (tx) => {
      await tx.operatorUnidadProductiva.deleteMany({ where: { membershipId: membership.id } });
      await tx.operatorDeposito.deleteMany({ where: { membershipId: membership.id } });
      await tx.operatorOrdenTrabajo.deleteMany({ where: { membershipId: membership.id } });
      if (input.unidadProductivaIds.length) {
        await tx.operatorUnidadProductiva.createMany({
          data: [...new Set(input.unidadProductivaIds)].map((unidadProductivaId) => ({ membershipId: membership.id, unidadProductivaId })),
        });
      }
      if (input.depositoIds.length) {
        await tx.operatorDeposito.createMany({
          data: [...new Set(input.depositoIds)].map((depositoId) => ({ membershipId: membership.id, depositoId })),
        });
      }
      if (input.ordenTrabajoIds.length) {
        await tx.operatorOrdenTrabajo.createMany({
          data: [...new Set(input.ordenTrabajoIds)].map((ordenId) => ({ membershipId: membership.id, ordenId })),
        });
      }
      await tx.operatorMembership.update({ where: { id: membership.id }, data: { permisos: [...new Set(input.permisos)] } });
      await recordTraceAudit({ entityType: 'OperatorMembership', entityId: membership.id, action: 'scope.update', actor, before, after: input }, tx as Prisma.TransactionClient);
    });
  }
}
