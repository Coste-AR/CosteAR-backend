import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import type { SavePriceIndexSeriesInput } from '../../shared/schemas/price-index.schema.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';

export class PriceIndexSeriesService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async requireCompany(userId: string, companyId: string) {
    const company = await this.db.company.findFirst({ where: { id: companyId, userId } });
    if (!company) throw new NotFoundError('Negocio no encontrado');
    return company;
  }

  async get(userId: string, companyId: string) {
    await this.requireCompany(userId, companyId);
    const series = await this.db.priceIndexSeries.findUnique({
      where: { companyId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { values: { orderBy: { periodCode: 'asc' } } } } },
    });
    if (!series || !series.versions[0]) return null;
    return this.view(series, series.versions[0]);
  }

  /** Cada guardado crea un snapshot completo nuevo; nunca actualiza el anterior. */
  async save(userId: string, companyId: string, input: SavePriceIndexSeriesInput, actor: TraceActor) {
    await this.requireCompany(userId, companyId);
    return withTenant(userId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId}::uuid FOR UPDATE`;
      let series = await tx.priceIndexSeries.findUnique({
        where: { companyId },
        include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { values: true } } },
      });

      if (series && (series.source !== input.source || series.basePeriodCode !== input.basePeriodCode)) {
        throw new UnprocessableEntityError(
          'La fuente y el momento cero quedan fijos al crear la serie. Para corregir un índice conservá ambos y enviá el período corregido.',
          { field: 'basePeriodCode' },
        );
      }

      if (!series) {
        series = await tx.priceIndexSeries.create({
          data: { companyId, userId, source: input.source, basePeriodCode: input.basePeriodCode },
          include: { versions: { include: { values: true } } },
        });
      }

      const previous = series.versions[0];
      const merged = new Map<string, number>();
      for (const value of previous?.values ?? []) merged.set(value.periodCode, Number(value.indexValue));
      for (const value of input.values) merged.set(value.periodCode, value.indexValue);

      const version = await tx.priceIndexSeriesVersion.create({
        data: {
          seriesId: series.id,
          companyId,
          userId,
          version: (previous?.version ?? 0) + 1,
          createdBy: actor.id,
          values: {
            create: [...merged.entries()].map(([periodCode, indexValue]) => ({ companyId, userId, periodCode, indexValue })),
          },
        },
        include: { values: { orderBy: { periodCode: 'asc' } } },
      });

      await recordTraceAudit({
        entityType: 'PriceIndexSeriesVersion',
        entityId: version.id,
        action: previous ? 'update' : 'create',
        actor,
        before: previous ?? undefined,
        after: version,
        comment: `Serie ${input.source}, momento cero ${input.basePeriodCode}, versión ${version.version}.`,
      }, tx);

      return this.view(series, version);
    });
  }

  private view(
    series: { id: string; companyId: string; source: string; basePeriodCode: string },
    version: { id: string; version: number; createdAt: Date; values: { periodCode: string; indexValue: unknown }[] },
  ) {
    return {
      id: series.id,
      companyId: series.companyId,
      source: series.source,
      basePeriodCode: series.basePeriodCode,
      version: { id: version.id, number: version.version, createdAt: version.createdAt.toISOString() },
      values: version.values.map((value) => ({ periodCode: value.periodCode, indexValue: Number(value.indexValue) })),
    };
  }
}
