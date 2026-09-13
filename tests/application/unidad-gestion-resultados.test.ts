import { describe, expect, it, vi } from 'vitest';
import { enrichCalculationResult } from '@/application/cost-structures/calculation-result-enrichment.js';

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
      workingDays: 0,
      paidDays: 0,
      itcsPercent: 0,
      iapPercent: 0,
      hourlyRates: {},
      itcsBreakdown: { certain: 0, uncertainRemunerative: 0, derived: 0, uncertainNonRemunerative: 0 },
      departments: [],
    },
    indirectCosts: { perDepartment: {} },
    unitCost: {
      unitsProduced: 24,
      unitProductionCost: 2.5,
      unitFinishedGoodsCost: 2.5,
      unitCostOfGoodsSold: 2.5,
      basadoEn: 'producidas' as const,
    },
  },
  raw: {} as never,
};

const input = { sales: { unitPrice: 5, quantity: 24, productionQuantity: 24 } } as never;

function db(unidadGestion: { codigo: string; nombre: string; factor: number } | null) {
  return {
    dataPoint: { findMany: vi.fn().mockResolvedValue([]) },
    costPeriod: { findFirst: vi.fn().mockResolvedValue({ id: 'periodo-1' }) },
    company: { findFirst: vi.fn().mockResolvedValue({ unidadGestion }) },
    parametroCosteo: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'p-1', clave: 'comportamiento_materia_prima', comportamientoVolumen: 'VARIABLE', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
        { id: 'p-2', clave: 'comportamiento_mano_obra_directa', comportamientoVolumen: 'FIJO', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
        { id: 'p-3', clave: 'comportamiento_costos_indirectos', comportamientoVolumen: 'FIJO', structureId: null, periodId: null, clasificadoPorUserId: null, clasificadoEn: null },
      ]),
    },
  };
}

describe('proyección de resultados de cálculo a unidad de gestión', () => {
  it('convierte costo unitario y conserva el snapshot base', async () => {
    const result = await enrichCalculationResult(db({
      codigo: 'bulto', nombre: 'Bulto de prueba', factor: 12,
    }) as never, {
      structureId: 'estructura-1', companyId: 'empresa-1', input, output: output as never,
    });

    expect(result.results.unidadGestion).toEqual({ codigo: 'bulto', nombre: 'Bulto de prueba', factor: 12 });
    expect(result.results.detail.unitCost.unitProductionCost).toBe(30);
    expect(result.results.detail.unitCost.unitsProduced).toBe(2);
    expect(result.results.puntoEquilibrio.unidadesEquilibrio).toBe(0.75);
    expect(result.resultsBase.detail.unitCost.unitProductionCost).toBe(2.5);
    expect(result.resultsBase.detail.unitCost.unitsProduced).toBe(24);
    expect(result.resultsBase.puntoEquilibrio.unidadesEquilibrio).toBe(9);
  });

  it('sin unidad conserva valores base y declara la ausencia', async () => {
    const result = await enrichCalculationResult(db(null) as never, {
      structureId: 'estructura-1', companyId: 'empresa-1', input, output: output as never,
    });

    expect(result.results.unidadGestion).toBeNull();
    expect(result.results.detail.unitCost.unitProductionCost).toBe(2.5);
    expect(result.results.detail.unitCost.unitsProduced).toBe(24);
  });
});
