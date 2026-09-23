import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ForbiddenError, NotFoundError } from '../../domain/errors/domain-error.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';

export interface OperatorScopeInput {
  unidadProductivaIds: string[];
  depositoIds: string[];
}

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
      include: { unidadesAutorizadas: true, depositosAutorizados: true },
    });
    // 404 evita confirmar operadores o empresas de otro tenant.
    if (!membership) throw new NotFoundError('Cargador no encontrado');

    const [units, deposits] = await Promise.all([
      this.db.unidadProductiva.count({ where: { id: { in: input.unidadProductivaIds }, companyId, deletedAt: null } }),
      this.db.deposito.count({ where: { id: { in: input.depositoIds }, companyId, deletedAt: null } }),
    ]);
    if (units !== new Set(input.unidadProductivaIds).size || deposits !== new Set(input.depositoIds).size) {
      throw new NotFoundError('Una o más entidades autorizadas no pertenecen a la empresa');
    }

    const before = {
      unidadProductivaIds: membership.unidadesAutorizadas.map((x) => x.unidadProductivaId),
      depositoIds: membership.depositosAutorizados.map((x) => x.depositoId),
    };
    await this.db.$transaction(async (tx) => {
      await tx.operatorUnidadProductiva.deleteMany({ where: { membershipId: membership.id } });
      await tx.operatorDeposito.deleteMany({ where: { membershipId: membership.id } });
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
      await recordTraceAudit({ entityType: 'OperatorMembership', entityId: membership.id, action: 'scope.update', actor, before, after: input }, tx as Prisma.TransactionClient);
    });
  }
}
