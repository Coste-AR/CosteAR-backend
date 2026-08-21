import { describe, it, expect } from 'vitest';
import { runCalculation, type CalculationInput } from '@/domain/calculations/calculate.js';

/**
 * #88 — El CPV unitario se dividía por las unidades producidas.
 *
 * El costo de productos terminados y vendidos es el costo de las unidades que
 * se VENDIERON. Dividirlo por las producidas da el costo unitario escalado por
 * la proporción de venta: producir 100 y vender 60 lo dejaba 40 % subvaluado.
 *
 * Es una regresión de `3b9e8ae`, que arregló el costo unitario de PRODUCCIÓN
 * —arreglo correcto— cambiando la única variable que alimentaba a los dos
 * números. El CPV unitario heredó el error que el otro dejó de tener.
 *
 * Por qué la suite no lo agarraba: `tests/domain/unidades-producidas.test.ts`
 * pone las cuatro existencias en cero. Con `finalFinishedGoods: 0` el CPV queda
 * igual al costo de producción y los dos divisores dan lo mismo, así que la
 * diferencia es invisible. Ese fixture además declaraba "producir 100 y vender
 * 60" con cero existencia final de productos terminados — un escenario que no
 * puede existir. Por eso el caso de acá tiene las existencias EN VALORES REALES
 * (criterio de reverificación 4 del issue).
 */
describe('#88 — el CPV unitario se divide por las unidades vendidas', () => {
  /**
   * Se producen 100 unidades a $1.000 y se venden 60. Las 40 que no se
   * vendieron quedan valuadas en existencia final de productos terminados
   * ($40.000), que es lo que hace al escenario coherente: si se produjo 100 y
   * se vendió 60, las otras 40 tienen que estar en algún lado.
   *
   *   costo de producción = 100 u × $1.000            = $100.000
   *   CPV = producción + EI PT − EF PT = 100.000 − 40.000 = $60.000
   *   CPV unitario = 60.000 ÷ 60 vendidas             = $1.000  ← igual al de producción
   */
  function caso(over: {
    quantity: number;
    productionQuantity?: number | null;
    finalFinishedGoods?: number;
  }): CalculationInput {
    return {
      rawMaterial: {
        materials: [
          {
            name: 'Insumo', code: 'MP-01', unit: 'u',
            wilson: { annualDemand: 1200, orderCost: 1000, holdingRate: 0.2, unitCost: 100 },
            stockPolicy: { minConsumption: 1, maxConsumption: 2, minLeadTime: 1, maxLeadTime: 2, safetyStock: 0 },
            initialStock: { quantity: 0, unitCost: 0 },
            movements: [
              { date: '01/01/2026', type: 'purchase', detail: 'Compra', quantity: 100, unitCost: 1000 },
              { date: '20/01/2026', type: 'consumption', detail: 'Consumo', quantity: 100 },
            ],
          },
        ],
      },
      directLabor: {
        workingDays: {
          totalDaysPerYear: 365,
          unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 0, holidaysOnWeekend: 0 },
          paidAbsence: { holidays: 15, vacations: 14, sickness: 0, specialLeaves: 0, workAccidents: 0 },
        },
        itcs: { derivationBase: 0, fixedArt: 0, uncertainRemunerative: [], uncertainNonRemunerative: [] },
        departments: [{ name: 'Único', basicRemuneration: 0, hoursWorked: 100 }],
      },
      indirectCosts: {
        centers: [{ id: 'unico', name: 'Único', type: 'productive' }],
        concepts: [{ name: 'CIF', amount: { fixed: 0, variable: 0 }, distribution: { unico: 1 } }],
        serviceDistributions: [],
        productiveSettings: [
          { centerId: 'unico', normalCapacity: 100, actualActivity: 100, actualCip: 0 },
        ] as CalculationInput['indirectCosts']['productiveSettings'],
      },
      inventory: {
        initialWorkInProcess: 0,
        finalWorkInProcess: 0,
        initialFinishedGoods: 0,
        finalFinishedGoods: over.finalFinishedGoods ?? 0,
      },
      sales: {
        unitPrice: 2000,
        quantity: over.quantity,
        productionQuantity: over.productionQuantity,
      },
    };
  }

  it('criterio 1: con las no vendidas valuadas en existencia final, CPV unitario == unitario de producción', () => {
    const r = runCalculation(
      caso({ quantity: 60, productionQuantity: 100, finalFinishedGoods: 40000 }),
    ).detail.unitCost;

    // Una unidad no cambia de costo por haberse vendido.
    expect(r.unitProductionCost).toBeCloseTo(1000, 6);
    expect(r.unitCostOfGoodsSold).toBeCloseTo(1000, 6);
  });

  it('el defecto medido: dividir el CPV por las producidas lo subvaluaba un 40 %', () => {
    const r = runCalculation(
      caso({ quantity: 60, productionQuantity: 100, finalFinishedGoods: 40000 }),
    );
    // Lo que devolvía antes: 60.000 ÷ 100 = 600, contra los 1.000 correctos.
    // La subvaluación era exactamente la proporción vendidas/producidas.
    expect(r.costOfGoodsSold / 100).toBeCloseTo(600, 6);
    expect(r.detail.unitCost.unitCostOfGoodsSold).not.toBeCloseTo(600, 6);
  });

  it('criterio 2: con producidas == vendidas, ningún número cambia', () => {
    const r = runCalculation(caso({ quantity: 100, productionQuantity: 100 })).detail.unitCost;
    expect(r.unitProductionCost).toBeCloseTo(1000, 6);
    expect(r.unitCostOfGoodsSold).toBeCloseTo(1000, 6);
  });

  it('criterio 3: sin cantidad producida cargada, se mantiene el comportamiento anterior', () => {
    const r = runCalculation(caso({ quantity: 60, productionQuantity: null })).detail.unitCost;
    // Sin producidas, el unitario de producción se calcula sobre las vendidas y
    // queda dicho en `basadoEn`. El CPV unitario siempre fue por vendidas.
    expect(r.basadoEn).toBe('vendidas');
    expect(r.unitsProduced).toBe(60);
    expect(r.unitCostOfGoodsSold).toBeCloseTo(r.unitProductionCost, 6);
  });

  it('sin ventas cargadas no revienta: el CPV unitario queda en 0', () => {
    const r = runCalculation(caso({ quantity: 0, productionQuantity: 100 })).detail.unitCost;
    expect(r.unitCostOfGoodsSold).toBe(0);
    // Y el de producción sigue calculándose, que para eso tiene su propio divisor.
    expect(r.unitProductionCost).toBeCloseTo(1000, 6);
  });
});
