import { describe, expect, it, vi } from 'vitest';
import { enrichCalculationResult } from '@/application/cost-structures/calculation-result-enrichment.js';

/**
 * MX-04 del plan de análisis marginal.
 *
 * `enrichCalculationResult` resolvía la cascada de clasificación
 * (`período → estructura → empresa`) contra el período con `status: 'OPEN'` de
 * la estructura, sin importar qué período se estuviera calculando.
 *
 * Mientras hay un solo período abierto por estructura eso coincide. Pero
 * `CostPeriodService.reopen()` reabre un período cerrado **sin verificar que no
 * haya otro abierto**, y el schema no tiene ningún `@@unique` que lo impida: con
 * agosto reabierto y septiembre abierto, la estructura tiene dos períodos OPEN y
 * el `findFirst` —que además no traía `orderBy`— devolvía cualquiera de los dos.
 *
 * Es el mismo modo de falla que el hallazgo E1-03 de la auditoría E2E del
 * 06-09-2026, donde los formularios leían el config vivo de la estructura en vez
 * del config del período seleccionado.
 */

const output = {
  rawMaterialConsumed: 24,
  directLaborTotal: 12,
  indirectCostsApplied: 24,
  productionCost: 60,
  costOfGoodsSold: 60,
  grossMargin: 60,
  grossMarginPct: 50,
  detail: {
    rawMaterial: { optimalLot: 0, finalStockQty: 0, finalStockValue: 0, materials: [] },
    directLabor: {
      workingDays: 0, paidDays: 0, itcsPercent: 0, iapPercent: 0, hourlyRates: {},
      itcsBreakdown: { certain: 0, uncertainRemunerative: 0, derived: 0, uncertainNonRemunerative: 0 },
      departments: [],
    },
    indirectCosts: { perDepartment: {} },
    unitCost: {
      unitsProduced: 24, unitProductionCost: 2.5, unitFinishedGoodsCost: 2.5,
      unitCostOfGoodsSold: 2.5, basadoEn: 'producidas' as const,
    },
  },
  raw: {} as never,
};

const input = { sales: { unitPrice: 5, quantity: 24, productionQuantity: 24 } } as never;

const AGOSTO = 'periodo-agosto';
const SEPTIEMBRE = 'periodo-septiembre';

/**
 * Agosto clasifica los costos indirectos como FIJO; septiembre, como VARIABLE.
 * A nivel empresa quedan sin clasificar, así que el resultado delata sin
 * ambigüedad contra qué fila resolvió la cascada.
 */
function db() {
  return {
    dataPoint: { findMany: vi.fn().mockResolvedValue([]) },
    // El período abierto más nuevo es septiembre: es el que devolvía el findFirst.
    costPeriod: { findFirst: vi.fn().mockResolvedValue({ id: SEPTIEMBRE }) },
    company: { findFirst: vi.fn().mockResolvedValue({ unidadGestion: null }) },
    parametroCosteo: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'p-mp', clave: 'comportamiento_materia_prima', comportamientoVolumen: 'VARIABLE', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
        { id: 'p-mod', clave: 'comportamiento_mano_obra_directa', comportamientoVolumen: 'FIJO', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
        { id: 'p-cip-agosto', clave: 'comportamiento_costos_indirectos', comportamientoVolumen: 'FIJO', structureId: null, periodId: AGOSTO, clasificadoPorUserId: null, clasificadoEn: null },
        { id: 'p-cip-septiembre', clave: 'comportamiento_costos_indirectos', comportamientoVolumen: 'VARIABLE', structureId: null, periodId: SEPTIEMBRE, clasificadoPorUserId: null, clasificadoEn: null },
      ]),
    },
    conceptoCosteo: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

const cip = (result: Awaited<ReturnType<typeof enrichCalculationResult>>) =>
  result.results.contribucionMarginal.componentes.find((c) => c.etiqueta === 'Costos indirectos de producción')!;

describe('de qué período sale la clasificación de comportamiento (MX-04)', () => {
  it('usa el período que se está calculando, no el que esté abierto', async () => {
    const prisma = db();
    const result = await enrichCalculationResult(prisma as never, {
      structureId: 'estructura-1', companyId: 'empresa-1', periodId: AGOSTO, input, output: output as never,
    });

    expect(cip(result).comportamientoVolumen).toBe('FIJO');
    expect(cip(result).parametroId).toBe('p-cip-agosto');
    expect(result.periodId).toBe(AGOSTO);
    // Si ya sabemos el período, no hay por qué SALIR A BUSCAR el abierto —
    // pero sí se consulta ESE período puntual (M2-01: para leer sus gastos de
    // no fabricación). La diferencia es la forma del where, no si se llama.
    expect(prisma.costPeriod.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.costPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: AGOSTO } }),
    );
  });

  it('sigue resolviendo contra el período abierto cuando no se le pasa ninguno', async () => {
    const prisma = db();
    const result = await enrichCalculationResult(prisma as never, {
      structureId: 'estructura-1', companyId: 'empresa-1', input, output: output as never,
    });

    expect(cip(result).comportamientoVolumen).toBe('VARIABLE');
    expect(cip(result).parametroId).toBe('p-cip-septiembre');
    expect(result.periodId).toBe(SEPTIEMBRE);
  });

  it('el fallback elige el período abierto más nuevo de forma determinista', async () => {
    const prisma = db();
    await enrichCalculationResult(prisma as never, {
      structureId: 'estructura-1', companyId: 'empresa-1', input, output: output as never,
    });

    // Sin `orderBy` el motor de base elige cualquiera de los abiertos.
    expect(prisma.costPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { code: 'desc' } }),
    );
  });
});
