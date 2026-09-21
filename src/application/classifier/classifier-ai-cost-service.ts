import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { withTenantContext } from '../../infrastructure/database/tenant-context.js';

export interface ClassifierCostSummary {
  provider: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  costCurrency: string | null;
  unmeasuredCalls: number;
}

/** Agrega métricas operativas sin exponer contenido ni saltar el RLS. */
export class ClassifierAiCostService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async summarize(from: Date, to: Date): Promise<ClassifierCostSummary[]> {
    const tenants = await this.db.user.findMany({ select: { id: true } });
    const rows = (await Promise.all(tenants.map(({ id }) => withTenantContext(id, () =>
      this.db.classifierAiCall.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { provider: true, inputTokens: true, outputTokens: true, estimatedCost: true, costCurrency: true },
      }),
    )))).flat();

    const byProvider = new Map<string, ClassifierCostSummary>();
    for (const row of rows) {
      const key = `${row.provider}\u0000${row.costCurrency ?? ''}`;
      const current = byProvider.get(key) ?? {
        provider: row.provider, calls: 0, inputTokens: 0, outputTokens: 0,
        estimatedCost: 0, costCurrency: row.costCurrency, unmeasuredCalls: 0,
      };
      current.calls += 1;
      if (row.inputTokens === null || row.outputTokens === null) {
        current.unmeasuredCalls += 1;
      } else {
        current.inputTokens += row.inputTokens;
        current.outputTokens += row.outputTokens;
      }
      if (row.estimatedCost !== null) current.estimatedCost += Number(row.estimatedCost);
      byProvider.set(key, current);
    }
    return [...byProvider.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  }
}
