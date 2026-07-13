import type { PrismaClient, MacroSource } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { runCalculation, type CalculationInput } from '../cost-structures/calculate.js';
import {
  rawMaterialSectionSchema,
  directLaborConfigSchema,
  indirectCostConfigSchema,
  inventorySchema,
} from '../../shared/schemas/cost.schema.js';

/**
 * Acceso a los snapshots macroeconómicos (BCRA, INDEC, ARCA, paritarias).
 * Los snapshots son inmutables: este servicio solo lee y registra nuevos.
 */
export class MacroService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** Último valor conocido de cada indicador. */
  async latest() {
    const rows = await this.db.macroSnapshot.findMany({
      orderBy: { effectiveDate: 'desc' },
      distinct: ['source', 'indicatorCode'],
    });
    return rows;
  }

  /**
   * Métricas públicas para la vitrina de la landing (sin login).
   * Devuelve el dólar blue y el IPC mensual con su fecha. Si algún indicador
   * todavía no fue sincronizado, va en null y el front muestra un fallback.
   */
  async landingMetrics() {
    const [blue, ipc] = await Promise.all([
      this.db.macroSnapshot.findFirst({
        where: { indicatorCode: 'USD_BLUE' },
        orderBy: { effectiveDate: 'desc' },
      }),
      this.db.macroSnapshot.findFirst({
        where: { indicatorCode: 'IPC_NACIONAL' },
        orderBy: { effectiveDate: 'desc' },
      }),
    ]);

    return {
      usdBlue: blue
        ? { value: Number(blue.value), effectiveDate: blue.effectiveDate }
        : null,
      ipc: ipc
        ? { value: Number(ipc.value), effectiveDate: ipc.effectiveDate }
        : null,
    };
  }

  async history(params: { source?: MacroSource; indicatorCode?: string; from?: Date; to?: Date }) {
    return this.db.macroSnapshot.findMany({
      where: {
        ...(params.source ? { source: params.source } : {}),
        ...(params.indicatorCode ? { indicatorCode: params.indicatorCode } : {}),
        ...(params.from || params.to
          ? { effectiveDate: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
          : {}),
      },
      orderBy: { effectiveDate: 'asc' },
      take: 500,
    });
  }

  /**
   * Preview de propagación: simula el impacto de un cambio en una variable
   * macro sobre TODAS las estructuras ACTIVAS del costista, SIN persistir nada.
   * Devuelve, por estructura, el resultado anterior y el nuevo, y el delta.
   *
   * El costista ve esto en la pantalla "Revisión de propagación" antes de confirmar.
   */
  async propagationPreview(
    costistId: string,
    /** Factor multiplicador a aplicar sobre el costo de cada elemento.
     * Ej: 1.15 = +15%. En el futuro será más granular por tipo de componente. */
    changeFactor: number,
    indicatorLabel: string,
  ) {
    const structures = await this.db.costStructure.findMany({
      where: { userId: costistId, status: 'ACTIVE' },
      include: { company: { select: { id: true, name: true } } },
    });

    const preview = [];
    for (const s of structures) {
      if (!s.rawMaterialConfig || !s.directLaborConfig || !s.indirectCostConfig) continue;

      try {
        // Cálculo BASE (sin cambio)
        const baseInput: CalculationInput = {
          rawMaterial: rawMaterialSectionSchema.parse(s.rawMaterialConfig),
          directLabor: directLaborConfigSchema.parse(s.directLaborConfig),
          indirectCosts: indirectCostConfigSchema.parse(s.indirectCostConfig),
          inventory: inventorySchema.parse({}),
          sales: { unitPrice: s.salesUnitPrice ? Number(s.salesUnitPrice) : 0, quantity: s.salesQuantity ? Number(s.salesQuantity) : 0 },
        };
        const baseResult = runCalculation(baseInput);

        // Cálculo PROYECTADO: ajustar precio de venta sugerido manteniendo margen,
        // y mostrar cómo queda si NO ajusta el precio.
        // El impacto real es: el costo sube → si el precio no cambia, el margen cae.
        // Aproximamos: productionCost * changeFactor → nuevo costo.
        const newCost = baseResult.productionCost * changeFactor;
        const newCogs = baseResult.costOfGoodsSold * changeFactor;
        const salesRevenue = s.salesUnitPrice && s.salesQuantity
          ? Number(s.salesUnitPrice) * Number(s.salesQuantity)
          : 0;
        const newGrossMargin = salesRevenue > 0 ? salesRevenue - newCogs : 0;
        const newGrossMarginPct = salesRevenue > 0 ? (newGrossMargin / salesRevenue) * 100 : 0;
        const suggestedPrice = s.salesQuantity && Number(s.salesQuantity) > 0
          ? (newCogs / Number(s.salesQuantity)) / (1 - baseResult.grossMarginPct / 100)
          : null;

        preview.push({
          structureId: s.id,
          productName: s.productName,
          period: s.period,
          companyId: s.company.id,
          companyName: s.company.name,
          indicator: indicatorLabel,
          changePct: (changeFactor - 1) * 100,
          before: {
            productionCost: baseResult.productionCost,
            grossMarginPct: baseResult.grossMarginPct,
            salesUnitPrice: s.salesUnitPrice ? Number(s.salesUnitPrice) : null,
          },
          after: {
            productionCost: newCost,
            grossMarginPct: newGrossMarginPct,
            suggestedUnitPrice: suggestedPrice,
          },
          marginDelta: newGrossMarginPct - baseResult.grossMarginPct,
        });
      } catch {
        // Estructura con config inválida → skip
      }
    }

    return { preview, affectedCount: preview.length, indicator: indicatorLabel };
  }

  /**
   * Entrada manual de variable macro (paritarias, tarifas, etc.).
   * Registra el snapshot y encola un recálculo.
   */
  async recordManual(
    input: {
      source: MacroSource;
      indicatorCode: string;
      value: number;
      effectiveDate: Date;
      metadata?: unknown;
    },
  ) {
    const snapshot = await this.record(input);
    // Disparar recálculo encolado
    const { recalculateQueue } = await import('../../infrastructure/workers/queues.js');
    await recalculateQueue.add('manual-macro-entry', { trigger: input.indicatorCode });
    return snapshot;
  }

  /** Registra un snapshot nuevo (idempotente por source+code+fecha). */
  async record(snapshot: {
    source: MacroSource;
    indicatorCode: string;
    value: number;
    effectiveDate: Date;
    metadata?: unknown;
  }) {
    return this.db.macroSnapshot.upsert({
      where: {
        source_indicatorCode_effectiveDate: {
          source: snapshot.source,
          indicatorCode: snapshot.indicatorCode,
          effectiveDate: snapshot.effectiveDate,
        },
      },
      create: {
        source: snapshot.source,
        indicatorCode: snapshot.indicatorCode,
        value: snapshot.value,
        effectiveDate: snapshot.effectiveDate,
        metadata: (snapshot.metadata as object) ?? undefined,
      },
      update: { value: snapshot.value },
    });
  }
}
