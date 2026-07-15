import { describe, it, expect } from 'vitest';
import { comparePeriods, type PeriodSide } from '@/application/cost-structures/period-comparison.js';
import type { FrozenCalculation } from '@/application/cost-structures/calculate.js';

/**
 * UNIDADES PRODUCIDAS ≠ UNIDADES VENDIDAS.
 *
 * El motor solo tenía `sales.quantity`, y la usa para FACTURAR (precio × cantidad):
 * son unidades VENDIDAS. Pero el costo unitario tiene que dividir por lo PRODUCIDO.
 * Si se producen 1.000 y se venden 800, dividir el costo por 800 lo infla 25%.
 *
 * Regla: se divide por lo producido; si el período no tiene el dato (es viejo), se
 * cae a lo vendido — y se AVISA, en vez de hacerlo pasar por exacto.
 */

function result(total: number): FrozenCalculation {
  return {
    rawMaterialConsumed: total,
    directLaborTotal: 0,
    indirectCostsApplied: 0,
    productionCost: total,
    costOfGoodsSold: total,
    grossMargin: 0,
    grossMarginPct: 0,
    detail: {
      rawMaterial: { optimalLot: 0, finalStockQty: 0, finalStockValue: 0, materials: [] },
      directLabor: {
        workingDays: 0, paidDays: 0, itcsPercent: 0, iapPercent: 0, hourlyRates: {},
        itcsBreakdown: { certain: 0, uncertainRemunerative: 0, derived: 0, uncertainNonRemunerative: 0 },
        departments: [],
      },
      indirectCosts: { perDepartment: {} },
    },
  };
}

function side(code: string, total: number, units: number | null, unitsAreSales = false): PeriodSide {
  return {
    code,
    label: code,
    status: 'CLOSED',
    source: 'frozen',
    result: result(total),
    rawMaterialConfig: { materials: [] },
    indirectCostConfig: { centers: [] },
    units,
    unitsAreSales,
  };
}

describe('COSTO UNITARIO — se divide por lo PRODUCIDO, no por lo vendido', () => {
  it('el costo unitario sale sobre las unidades producidas', () => {
    // $1.000.000 y se produjeron 1.000 → $1.000 por unidad (aunque se vendan 800).
    const c = comparePeriods(side('2026-05', 1000000, 1000), side('2026-06', 1200000, 1000));
    expect(c.unit!.productionCost.a).toBe(1000);
    expect(c.unit!.productionCost.b).toBe(1200);
    expect(c.warnings.join(' ')).not.toMatch(/VENDIDAS/i);
  });

  it('🔑 dividir por lo VENDIDO infla el costo unitario — por eso los datos son distintos', () => {
    // Mismo mes, mismo costo ($1.000.000). Producidas 1.000, vendidas 800.
    const porProducidas = comparePeriods(side('2026-05', 900000, 1000), side('2026-06', 1000000, 1000));
    const porVendidas = comparePeriods(
      side('2026-05', 900000, 800, true),
      side('2026-06', 1000000, 800, true),
    );

    expect(porProducidas.unit!.productionCost.b).toBe(1000); // el correcto
    expect(porVendidas.unit!.productionCost.b).toBe(1250); // inflado 25%
  });

  it('si el período no tiene la cantidad producida, usa la vendida pero AVISA', () => {
    const c = comparePeriods(side('2026-05', 900000, 800, true), side('2026-06', 1000000, 800, true));

    // No se rompe (los períodos viejos siguen andando)...
    expect(c.unit).not.toBeNull();
    // ...pero no miente sobre de dónde salió el número.
    expect(c.warnings.join(' ')).toMatch(/unidades VENDIDAS, no por las producidas/i);
    expect(c.warnings.join(' ')).toMatch(/inflado/i);
  });

  it('sin ninguna cantidad, no hay costo unitario: no divide por cero', () => {
    const c = comparePeriods(side('2026-05', 900000, null), side('2026-06', 1000000, 100));
    expect(c.unit).toBeNull();
    expect(c.units.comparable).toBe(false);
  });
});
