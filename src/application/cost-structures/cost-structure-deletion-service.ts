import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit, type AuditContext } from '../audit/audit-logger.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';

export class CostStructureDeletionService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async requireStructure(userId: string, id: string) {
    const structure = await this.db.costStructure.findFirst({ where: { id, userId } });
    if (!structure) throw new NotFoundError('Estructura de costos no encontrada');
    return structure;
  }

  async softDelete(userId: string, id: string, ctx: AuditContext) {
    await this.requireStructure(userId, id);
    return this.db.$transaction(async (tx) => {
      const updated = await tx.costStructure.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await recordAudit(
        { ...ctx, userId, action: 'cost_structure.delete', entityType: 'CostStructure', entityId: id },
        tx,
      );
      return updated;
    });
  }

  async purge(userId: string, id: string, ctx: AuditContext) {
    const structure = await this.requireStructure(userId, id);

    return this.db.$transaction(async (tx) => {
      await recordAudit(
        {
          ...ctx,
          userId,
          action: 'cost_structure.purge',
          entityType: 'CostStructure',
          entityId: id,
          oldValue: {
            productName: structure.productName,
            companyId: structure.companyId,
            period: structure.period,
          },
        },
        tx,
      );

      await tx.$executeRawUnsafe(`SET LOCAL app.purge_mode = 'on'`);

      const points = await tx.dataPoint.findMany({ where: { structureId: id }, select: { id: true } });
      const pointIds = points.map((p) => p.id);
      if (pointIds.length > 0) {
        const versions = await tx.dataPointVersion.findMany({
          where: { dataPointId: { in: pointIds } },
          select: { evidenceId: true },
        });
        const evidenceIds = [...new Set(versions.map((v) => v.evidenceId).filter((e): e is string => !!e))];

        await tx.dataPointVersion.deleteMany({ where: { dataPointId: { in: pointIds } } });
        await tx.dataPoint.deleteMany({ where: { structureId: id } });

        if (evidenceIds.length > 0) {
          await tx.evidence.deleteMany({ where: { id: { in: evidenceIds }, versions: { none: {} } } });
        }
      }

      const runs = await tx.calculationRun.findMany({ where: { structureId: id }, select: { id: true } });
      const runIds = runs.map((r) => r.id);
      if (runIds.length > 0) {
        await tx.calculationNode.deleteMany({ where: { runId: { in: runIds } } });
        await tx.calculationRun.deleteMany({ where: { structureId: id } });
      }

      await tx.allocationBaseValue.deleteMany({ where: { structureId: id } });
      await tx.costConfigVersion.deleteMany({ where: { structureId: id } });
      await tx.costPeriod.deleteMany({ where: { structureId: id } });

      await tx.costStructure.delete({ where: { id } });

      return { id, productName: structure.productName };
    });
  }

  async restore(userId: string, id: string, ctx: AuditContext) {
    await this.requireStructure(userId, id);
    return this.db.$transaction(async (tx) => {
      const updated = await tx.costStructure.update({
        where: { id },
        data: { deletedAt: null },
      });
      await recordAudit(
        { ...ctx, userId, action: 'cost_structure.restore', entityType: 'CostStructure', entityId: id },
        tx,
      );
      return updated;
    });
  }
}
