import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit, type AuditContext } from '../audit/audit-logger.js';
import { NotFoundError, ValidationError } from '../../domain/errors/domain-error.js';
import {
  periodBounds,
  nextPeriodCode,
  normalizeLegacyCode,
  type Periodicity,
} from '../../domain/periods/period-calendar.js';
import {
  closingStockOf,
  type MaterialClosingBalance,
} from '../../domain/periods/closing-stock.js';

export interface CarryOverOptions {
  recipe?: true;
  amounts?: boolean;
}

export interface ProductiveSetting {
  centerId?: string;
  actualActivity?: number;
  actualCip?: number;
  [k: string]: unknown;
}

export interface PeriodSeed {
  rawMaterialConfig?: Prisma.InputJsonValue;
  directLaborConfig?: Prisma.InputJsonValue;
  indirectCostConfig?: Prisma.InputJsonValue;
  salesUnitPrice?: Prisma.Decimal | number | null;
  salesQuantity?: Prisma.Decimal | number | null;
  productionQuantity?: Prisma.Decimal | number | null;
}

export interface PeriodLike {
  code: string;
  label: string;
  rawMaterialConfig: Prisma.JsonValue;
  directLaborConfig: Prisma.JsonValue;
  indirectCostConfig: Prisma.JsonValue;
  salesUnitPrice: Prisma.Decimal | null;
  salesQuantity: Prisma.Decimal | null;
  productionQuantity?: Prisma.Decimal | null;
  status?: string;
  id?: string;
}

export class CostPeriodPropagationService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async requireStructure(userId: string, structureId: string) {
    const s = await this.db.costStructure.findFirst({
      where: { id: structureId, userId, deletedAt: null },
      include: { company: true },
    });
    if (!s) throw new NotFoundError('Estructura de costos no encontrada');
    return s;
  }

  async previewNext(userId: string, structureId: string) {
    const structure = await this.requireStructure(userId, structureId);
    const periodicity = structure.company.periodicity as Periodicity;

    const open = await this.db.costPeriod.findFirst({ where: { structureId, status: 'OPEN' } });
    const last = await this.db.costPeriod.findFirst({
      where: { structureId },
      orderBy: { code: 'desc' },
    });

    const code = last
      ? nextPeriodCode(normalizeLegacyCode(last.code, periodicity), periodicity)
      : normalizeLegacyCode(structure.period, periodicity);
    const bounds = periodBounds(code, periodicity);

    let openingStock: MaterialClosingBalance[] = [];
    let openingStockError: string | null = null;
    if (last) {
      try {
        openingStock = closingStockOf(last.rawMaterialConfig);
      } catch (e) {
        openingStockError = (e as Error).message;
      }
    }

    return {
      isFirst: !last,
      blockedBy: open ? { id: open.id, label: open.label } : null,
      next: {
        code: bounds.code,
        label: bounds.label,
        startDate: bounds.startDate,
        endDate: bounds.endDate,
      },
      from: last ? { id: last.id, code: last.code, label: last.label, status: last.status } : null,
      openingStock,
      openingStockError,
      amounts: last ? this.amountsOf(last) : null,
    };
  }

  private amountsOf(period: PeriodLike): { wages: number; indirect: number } {
    const dl = period.directLaborConfig as { departments?: { basicRemuneration?: number }[] } | null;
    const ic = period.indirectCostConfig as
      | { concepts?: { amount?: { fixed?: number; variable?: number } }[] }
      | null;

    const wages = (dl?.departments ?? []).reduce((a, d) => a + Number(d.basicRemuneration ?? 0), 0);
    const indirect = (ic?.concepts ?? []).reduce(
      (a, c) => a + Number(c.amount?.fixed ?? 0) + Number(c.amount?.variable ?? 0),
      0,
    );
    return { wages, indirect };
  }

  async openNext(
    userId: string,
    structureId: string,
    carry: CarryOverOptions,
    ctx: AuditContext,
  ) {
    const structure = await this.requireStructure(userId, structureId);
    const periodicity = structure.company.periodicity as Periodicity;

    const open = await this.db.costPeriod.findFirst({ where: { structureId, status: 'OPEN' } });
    if (open) {
      throw new ValidationError(
        `No se puede abrir un período nuevo: "${open.label}" sigue abierto. Cerralo primero.`,
      );
    }

    const last = (await this.db.costPeriod.findFirst({
      where: { structureId },
      orderBy: { code: 'desc' },
    })) as PeriodLike | null;

    const code = last
      ? nextPeriodCode(normalizeLegacyCode(last.code, periodicity), periodicity)
      : normalizeLegacyCode(structure.period, periodicity);

    const bounds = periodBounds(code, periodicity);

    const seed = last ? this.carryOver(last, carry) : this.snapshotOf(structure);
    const openingStock = last ? closingStockOf(last.rawMaterialConfig) : [];

    return this.db.$transaction(async (tx) => {
      const created = await tx.costPeriod.create({
        data: {
          structureId,
          companyId: structure.companyId,
          userId,
          code: bounds.code,
          label: bounds.label,
          startDate: bounds.startDate,
          endDate: bounds.endDate,
          status: 'OPEN',
          ...seed,
        },
      });

      if (last) {
        await this.resetStructureTo(tx, structureId, userId, seed, bounds.code, last.label);
      }

      await recordAudit(
        {
          ...ctx,
          userId,
          action: 'cost_period.open',
          entityType: 'CostPeriod',
          entityId: created.id,
          newValue: {
            code: created.code,
            carry,
            from: last?.code ?? null,
            openingStock,
          },
        },
        tx,
      );

      return created;
    });
  }

  private snapshotOf(structure: {
    rawMaterialConfig: Prisma.JsonValue;
    directLaborConfig: Prisma.JsonValue;
    indirectCostConfig: Prisma.JsonValue;
    salesUnitPrice: Prisma.Decimal | null;
    salesQuantity: Prisma.Decimal | null;
    productionQuantity: Prisma.Decimal | null;
  }): PeriodSeed {
    return {
      rawMaterialConfig: (structure.rawMaterialConfig ?? undefined) as Prisma.InputJsonValue,
      directLaborConfig: (structure.directLaborConfig ?? undefined) as Prisma.InputJsonValue,
      indirectCostConfig: (structure.indirectCostConfig ?? undefined) as Prisma.InputJsonValue,
      salesUnitPrice: structure.salesUnitPrice,
      salesQuantity: structure.salesQuantity,
      productionQuantity: structure.productionQuantity,
    };
  }

  private carryOver(last: PeriodLike, carry: CarryOverOptions): PeriodSeed {
    const clone = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));

    const closing = closingStockOf(last.rawMaterialConfig);
    const rm = clone(last.rawMaterialConfig) as {
      materials?: Record<string, unknown>[];
    } | null;
    if (rm && Array.isArray(rm.materials)) {
      rm.materials.forEach((m, i) => {
        m.movements = [];
        const c = closing[i];
        if (c) m.initialStock = { quantity: c.quantity, unitCost: c.unitCost };
      });
    }

    const dl = clone(last.directLaborConfig) as
      | { departments?: { basicRemuneration?: number }[] }
      | null;
    if (dl && Array.isArray(dl.departments) && !carry.amounts) {
      for (const d of dl.departments) d.basicRemuneration = 0;
    }

    const ic = clone(last.indirectCostConfig) as
      | {
          concepts?: { amount?: { fixed?: number; variable?: number } }[];
          productiveSettings?: ProductiveSetting[];
        }
      | null;
    if (ic) {
      if (Array.isArray(ic.concepts) && !carry.amounts) {
        for (const c of ic.concepts) c.amount = { fixed: 0, variable: 0 };
      }
      if (Array.isArray(ic.productiveSettings)) {
        for (const ps of ic.productiveSettings) {
          ps.actualActivity = 0;
          ps.actualCip = 0;
        }
      }
    }

    return {
      rawMaterialConfig: (rm ?? undefined) as Prisma.InputJsonValue,
      directLaborConfig: (dl ?? undefined) as Prisma.InputJsonValue,
      indirectCostConfig: (ic ?? undefined) as Prisma.InputJsonValue,
      salesUnitPrice: last.salesUnitPrice,
      salesQuantity: 0,
      productionQuantity: 0,
    };
  }

  private async resetStructureTo(
    tx: Prisma.TransactionClient,
    structureId: string,
    userId: string,
    seed: PeriodSeed,
    code: string,
    fromLabel: string,
  ) {
    await tx.costStructure.update({
      where: { id: structureId },
      data: {
        rawMaterialConfig: seed.rawMaterialConfig,
        directLaborConfig: seed.directLaborConfig,
        indirectCostConfig: seed.indirectCostConfig,
        salesUnitPrice: seed.salesUnitPrice ?? null,
        salesQuantity: seed.salesQuantity ?? null,
        productionQuantity: seed.productionQuantity ?? null,
        period: code,
      },
    });

    const reason = `Apertura del período ${code} (arrastre desde ${fromLabel})`;
    const sections: [string, Prisma.InputJsonValue | undefined][] = [
      ['rawMaterial', seed.rawMaterialConfig],
      ['directLabor', seed.directLaborConfig],
      ['indirectCosts', seed.indirectCostConfig],
      [
        'sales',
        {
          salesUnitPrice: Number(seed.salesUnitPrice ?? 0),
          salesQuantity: Number(seed.salesQuantity ?? 0),
          productionQuantity: Number(seed.productionQuantity ?? 0),
        },
      ],
    ];

    for (const [section, value] of sections) {
      if (value === undefined) continue;
      const last = await tx.costConfigVersion.findFirst({
        where: { structureId, section },
        orderBy: { versionN: 'desc' },
        select: { versionN: true },
      });
      await tx.costConfigVersion.create({
        data: {
          structureId,
          section,
          versionN: (last?.versionN ?? 0) + 1,
          value,
          createdBy: userId,
          reason,
        },
      });
    }
  }
}
