import { describe, it, expect } from 'vitest';
import { runCalculation, type CalculationInput } from '@/domain/calculations/calculate.js';

/**
 * S-02 (a) — el costo unitario se divide por las unidades PRODUCIDAS.
 *
 * El defecto
 * ----------
 * `productionQuantity` existía de punta a punta —schema, ruta, servicio y
 * trazabilidad— y el motor de Procesos ya la consumía. Pero `CalculationInput.sales`
 * no la tenía en su tipo, así que el motor de Órdenes hacía:
 *
 *     const unitsProduced = input.sales.quantity ?? 0;   // ← unidades VENDIDAS
 *
 * Producir 100 y vender 60 daba un costo unitario **66 % más alto** que el real.
 * Y no se veía mal: se veía como un costo unitario.
 *
 * Con un cliente real en producción, ese número es el que se usa para poner precio.
 */

/**
 * Estructura mínima que corre el motor sin ruido: una MP, sin MOD ni CIF.
 * Lo único que varía entre casos es el bloque `sales`.
 */
function input(sales: CalculationInput['sales']): CalculationInput {
  return {
    rawMaterial: {
      materials: [
        {
          name: 'Chapa',
          code: 'MP-001',
          unit: 'u',
          wilson: { annualDemand: 6000, orderCost: 5000, holdingRate: 0.3, unitCost: 100 },
          stockPolicy: {
            minConsumption: 20,
            maxConsumption: 40,
            minLeadTime: 5,
            maxLeadTime: 12,
            safetyStock: 0,
          },
          initialStock: { quantity: 0, unitCost: 0 },
          movements: [
            { date: '01/08/2026', type: 'purchase', detail: 'Compra', quantity: 1000, unitCost: 100 },
            { date: '15/08/2026', type: 'consumption', detail: 'Consumo', quantity: 1000 },
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
      itcs: {
        derivationBase: 0.27,
        fixedArt: 0.015,
        uncertainRemunerative: [],
        uncertainNonRemunerative: [],
      },
      departments: [{ name: 'Corte', basicRemuneration: 800000, hoursWorked: 160 }],
    },
    indirectCosts: {
      centers: [{ id: 'corte', name: 'Corte', type: 'productive' }],
      concepts: [
        {
          name: 'Alquiler',
          amount: { fixed: 300000, variable: 0 },
          distribution: { corte: 100 },
        },
      ],
      serviceDistributions: [],
      productiveSettings: [
        { centerId: 'corte', normalCapacity: 160, actualActivity: 160, actualCip: 300000 },
      ],
    },
    inventory: {
      initialWorkInProcess: 0,
      finalWorkInProcess: 0,
      initialFinishedGoods: 0,
      finalFinishedGoods: 0,
    },
    sales,
  } as unknown as CalculationInput;
}

describe('S-02(a) — unidades producidas vs. vendidas en el costo unitario', () => {
  it('con cantidad producida cargada, divide por ESA y lo dice', () => {
    const r = runCalculation(input({ unitPrice: 2000, quantity: 60, productionQuantity: 100 }));

    expect(r.detail.unitCost.unitsProduced).toBe(100);
    expect(r.detail.unitCost.basadoEn).toBe('producidas');
  });

  it('sin cantidad producida, mantiene el comportamiento viejo pero lo AVISA', () => {
    const r = runCalculation(input({ unitPrice: 2000, quantity: 60 }));

    expect(r.detail.unitCost.unitsProduced).toBe(60);
    // Lo importante: no se calla. La pantalla puede avisar que ese costo unitario
    // solo es correcto si se vendió todo lo que se produjo.
    expect(r.detail.unitCost.basadoEn).toBe('vendidas');
  });

  it('el defecto medido: producir 100 y vender 60 inflaba el unitario un 66 %', () => {
    const producidas = runCalculation(
      input({ unitPrice: 2000, quantity: 60, productionQuantity: 100 }),
    );
    const vendidas = runCalculation(input({ unitPrice: 2000, quantity: 60 }));

    const correcto = producidas.detail.unitCost.unitProductionCost;
    const inflado = vendidas.detail.unitCost.unitProductionCost;

    expect(correcto).toBeGreaterThan(0);
    expect(inflado).toBeGreaterThan(correcto);
    // 100/60 − 1 = 66,7 %
    expect(inflado / correcto - 1).toBeCloseTo(0.667, 2);
  });

  it('producir y vender lo mismo da idéntico resultado por los dos caminos', () => {
    const conProducidas = runCalculation(
      input({ unitPrice: 2000, quantity: 80, productionQuantity: 80 }),
    );
    const sinProducidas = runCalculation(input({ unitPrice: 2000, quantity: 80 }));

    expect(conProducidas.detail.unitCost.unitProductionCost).toBeCloseTo(
      sinProducidas.detail.unitCost.unitProductionCost,
      6,
    );
    // Pero el origen del divisor NO es el mismo, y eso se informa.
    expect(conProducidas.detail.unitCost.basadoEn).toBe('producidas');
    expect(sinProducidas.detail.unitCost.basadoEn).toBe('vendidas');
  });

  it('cantidad producida en 0 o null no se toma como válida: cae a vendidas', () => {
    for (const pq of [0, null]) {
      const r = runCalculation(
        input({ unitPrice: 2000, quantity: 60, productionQuantity: pq }),
      );
      expect(r.detail.unitCost.unitsProduced).toBe(60);
      expect(r.detail.unitCost.basadoEn).toBe('vendidas');
    }
  });

  it('cada unitario usa SU divisor: producción por las producidas, CPV por las vendidas', () => {
    // Este test afirmaba lo contrario —que los dos usan el mismo divisor— y por
    // eso el defecto de #88 quedó consagrado en la suite: cuando `3b9e8ae`
    // cambió la variable compartida a las producidas, el CPV unitario heredó el
    // error que el otro número dejó de tener, y el test lo bendijo.
    //
    // El CPV es el costo de las unidades VENDIDAS. Dividirlo por las producidas
    // da el costo unitario escalado por la proporción de venta, que no es el
    // costo de nada.
    const r = runCalculation(input({ unitPrice: 2000, quantity: 60, productionQuantity: 100 }));
    const { unitProductionCost, unitCostOfGoodsSold } = r.detail.unitCost;

    expect(r.productionCost / 100).toBeCloseTo(unitProductionCost, 6);
    // A 2 decimales y no a 6: `costOfGoodsSold` ya sale redondeado a centavos,
    // y dividirlo DESPUÉS por 60 no da lo mismo que dividir con los 28 dígitos
    // del motor y redondear al final. La diferencia es de tres milésimas.
    expect(r.costOfGoodsSold / 60).toBeCloseTo(unitCostOfGoodsSold, 2);
  });
});
