import { describe, it, expect } from 'vitest';
import { runCalculation, type CalculationInput } from '@/domain/calculations/calculate.js';

/**
 * #89 — La producción en proceso no movía ningún costo unitario.
 *
 * El estado de costos de la cátedra (clase 2, práctica resuelta) tiene DOS
 * renglones distintos, y el motor solo exponía el primero:
 *
 *     MP consumida + MOD devengada + CIP aplicados
 *   = COSTO DE PRODUCCIÓN DEL PERÍODO        → ÷ unidades = costo unitario de producción
 *   + Existencia inicial de producción en proceso
 *   − Existencia final de producción en proceso
 *   = COSTO DE PRODUCTOS TERMINADOS          → ÷ unidades = costo unitario de terminados
 *
 * `unitProductionCost` divide el primero: por definición NO se mueve con la
 * producción en proceso, y está bien que no se mueva. Lo que faltaba era el
 * segundo, `unitFinishedGoodsCost`, que es el costo de lo que efectivamente
 * salió terminado — el número que hay que mirar para poner precio en un período
 * donde no se terminó todo. Ver ADR 0006.
 */
describe('#89 — la producción en proceso mueve el costo unitario de terminados', () => {
  // Caso mínimo y redondo: sin CIP ni MOD, un solo movimiento de MP, para que
  // el numerador sea verificable a mano sin arrastrar el resto del motor.
  function caso(inventory: Partial<CalculationInput['inventory']>): CalculationInput {
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
        itcs: {
          derivationBase: 0,
          fixedArt: 0,
          uncertainRemunerative: [],
          uncertainNonRemunerative: [],
        },
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
        finalFinishedGoods: 0,
        ...inventory,
      },
      sales: { unitPrice: 2000, quantity: 100, productionQuantity: 100 },
    };
  }

  // MP consumida = 100 u × $1.000 = $100.000. Sin MOD ni CIP, el costo de
  // producción del período es exactamente $100.000 → $1.000 por unidad.
  const COSTO_PRODUCCION = 100000;
  const UNIDADES = 100;

  it('criterio 1: con existencia final en proceso, el unitario de terminados CAMBIA', () => {
    const sinProceso = runCalculation(caso({})).detail.unitCost;
    const conProceso = runCalculation(caso({ finalWorkInProcess: 40000 })).detail.unitCost;

    // Costo de productos terminados = 100.000 + 0 − 40.000 = 60.000 → $600/u.
    expect(conProceso.unitFinishedGoodsCost).toBeCloseTo(600, 6);
    expect(conProceso.unitFinishedGoodsCost).not.toBeCloseTo(sinProceso.unitFinishedGoodsCost, 6);
  });

  it('el costo unitario de PRODUCCIÓN no se mueve, y está bien que no se mueva', () => {
    // Es la definición de la cátedra: costo del período ÷ unidades, antes de
    // ajustar por producción en proceso. Si este número cambiara, la práctica
    // resuelta de la clase 2 dejaría de dar $500/kg.
    const sinProceso = runCalculation(caso({})).detail.unitCost;
    const conProceso = runCalculation(caso({ finalWorkInProcess: 40000 })).detail.unitCost;
    expect(sinProceso.unitProductionCost).toBeCloseTo(COSTO_PRODUCCION / UNIDADES, 6);
    expect(conProceso.unitProductionCost).toBeCloseTo(COSTO_PRODUCCION / UNIDADES, 6);
  });

  it('criterio 2: con las existencias en proceso en cero, los dos unitarios coinciden', () => {
    // Nada cambia respecto de antes: sin producción en proceso, el costo de
    // productos terminados ES el costo de producción del período.
    const u = runCalculation(caso({})).detail.unitCost;
    expect(u.unitFinishedGoodsCost).toBeCloseTo(u.unitProductionCost, 6);
    expect(u.unitFinishedGoodsCost).toBeCloseTo(1000, 6);
  });

  it('criterio 3: existencia inicial y final simultáneas, contra la clave a mano', () => {
    // Costo de productos terminados = 100.000 + 25.000 − 40.000 = 85.000.
    // 85.000 ÷ 100 = 850.
    const u = runCalculation(
      caso({ initialWorkInProcess: 25000, finalWorkInProcess: 40000 }),
    ).detail.unitCost;
    expect(u.unitFinishedGoodsCost).toBeCloseTo(850, 6);
    expect(u.unitProductionCost).toBeCloseTo(1000, 6);
  });

  it('la existencia INICIAL sola encarece lo terminado (se arrastra trabajo del período anterior)', () => {
    const u = runCalculation(caso({ initialWorkInProcess: 25000 })).detail.unitCost;
    // 100.000 + 25.000 = 125.000 → $1.250/u, más caro que los $1.000 del período.
    expect(u.unitFinishedGoodsCost).toBeCloseTo(1250, 6);
  });

  it('sin unidades cargadas no revienta: los dos unitarios quedan en 0', () => {
    const sinUnidades = { ...caso({ finalWorkInProcess: 40000 }) };
    sinUnidades.sales = { unitPrice: 2000, quantity: 0, productionQuantity: 0 };
    const u = runCalculation(sinUnidades).detail.unitCost;
    expect(u.unitProductionCost).toBe(0);
    expect(u.unitFinishedGoodsCost).toBe(0);
  });
});
