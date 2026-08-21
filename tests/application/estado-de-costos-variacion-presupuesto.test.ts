import { describe, it, expect } from 'vitest';
import { Money } from '@/domain/value-objects/money.js';
import { calcCostStatement } from '@/domain/calculations/cost-statement.js';
import { runCalculation, type CalculationInput } from '@/domain/calculations/calculate.js';

/**
 * #90 — El estado de costos se cortaba en el costo NORMAL y lo trataba como real.
 *
 * Estructura de la cátedra (clase 28: «normal = MP + MO + CIF aplicados; real =
 * normal + variación presupuesto»):
 *
 *     MP consumida + MOD devengada + CIP aplicados
 *   = COSTO NORMAL DE PRODUCCIÓN DEL PERÍODO
 *   ± Variación presupuesto        (+ pérdida / − ahorro)
 *   = COSTO REAL DE PRODUCCIÓN
 *   + Ex. inicial PP − Ex. final PP
 *   = COSTO DE PRODUCTOS TERMINADOS
 *   + Ex. inicial PT − Ex. final PT
 *   = COSTO DE PRODUCTOS TERMINADOS Y VENDIDOS
 *
 * Faltaba el renglón de la variación presupuesto, así que el estado nunca
 * llegaba al costo real y todo lo que seguía arrastraba la diferencia.
 *
 * LO QUE NO HAY QUE ROMPER: la variación VOLUMEN no va acá. Va al estado de
 * resultados, como pérdida del período: la capacidad ociosa es una pérdida de la
 * empresa, no un costo del producto. La cátedra lo marca como «el punto que más
 * se olvida» (clase 26), y hoy correctamente no está.
 */
describe('#90 — la variación presupuesto entra al estado de costos', () => {
  describe('el estado de costos, aislado', () => {
    const base = {
      initialRawMaterial: Money.of(0),
      rawMaterialPurchases: Money.of(100000),
      finalRawMaterial: Money.of(0),
      directLabor: Money.of(50000),
      indirectCostsApplied: Money.of(30000),
      initialWorkInProcess: Money.of(0),
      finalWorkInProcess: Money.of(0),
      initialFinishedGoods: Money.of(0),
      finalFinishedGoods: Money.of(0),
    };
    // Normal = 100.000 + 50.000 + 30.000 = 180.000.
    const NORMAL = 180000;

    it('criterio 1: el costo real es una línea propia, distinta del normal', () => {
      const r = calcCostStatement({ ...base, budgetVariance: Money.of(20000) });

      expect(r.productionCost.toNumber()).toBe(NORMAL);
      expect(r.budgetVariance.toNumber()).toBe(20000);
      expect(r.realProductionCost.toNumber()).toBe(NORMAL + 20000);
    });

    it('una variación positiva es PÉRDIDA y encarece el costo del producto', () => {
      // `budgetVariance = actualCip − budgetAtActual`: positiva significa que el
      // CIP real superó al presupuesto ajustado a la actividad real.
      const r = calcCostStatement({ ...base, budgetVariance: Money.of(20000) });
      expect(r.costOfGoodsSold.toNumber()).toBe(NORMAL + 20000);
    });

    it('una variación negativa es AHORRO y lo abarata', () => {
      const r = calcCostStatement({ ...base, budgetVariance: Money.of(-15000) });
      expect(r.realProductionCost.toNumber()).toBe(NORMAL - 15000);
      expect(r.costOfGoodsSold.toNumber()).toBe(NORMAL - 15000);
    });

    it('criterio 3: con la variación en cero —o sin pasarla— ningún número cambia', () => {
      const enCero = calcCostStatement({ ...base, budgetVariance: Money.zero() });
      const sinPasar = calcCostStatement(base);

      expect(sinPasar.realProductionCost.toNumber()).toBe(NORMAL);
      expect(sinPasar.costOfGoodsSold.toNumber()).toBe(enCero.costOfGoodsSold.toNumber());
      expect(sinPasar.productionCost.toNumber()).toBe(enCero.productionCost.toNumber());
    });

    it('criterio 4: clave a mano con las cuatro existencias y variación distinta de cero', () => {
      const r = calcCostStatement({
        ...base,
        budgetVariance: Money.of(20000),
        initialWorkInProcess: Money.of(25000),
        finalWorkInProcess: Money.of(40000),
        initialFinishedGoods: Money.of(10000),
        finalFinishedGoods: Money.of(30000),
      });

      //   normal                      180.000
      // + variación presupuesto        20.000
      // = real                        200.000
      // + EI PP 25.000 − EF PP 40.000 = 185.000  (productos terminados)
      // + EI PT 10.000 − EF PT 30.000 = 165.000  (CPV)
      expect(r.realProductionCost.toNumber()).toBe(200000);
      expect(r.finishedGoodsCost.toNumber()).toBe(185000);
      expect(r.costOfGoodsSold.toNumber()).toBe(165000);
    });

    it('la variación llega hasta el CPV: no se pierde en el camino', () => {
      const sin = calcCostStatement(base);
      const con = calcCostStatement({ ...base, budgetVariance: Money.of(20000) });
      expect(con.costOfGoodsSold.subtract(sin.costOfGoodsSold).toNumber()).toBe(20000);
    });
  });

  describe('enchufado al motor completo', () => {
    // Caso Dorado, el mismo fixture de `calculate.test.ts`. Corte cierra con una
    // variación presupuesto de 21.500 y Ensamblaje con 0 (su actividad real es
    // igual a la capacidad normal), así que el total del período es 21.500.
    const dorado: CalculationInput = {
      rawMaterial: {
        materials: [
          {
            name: 'Chapa', code: 'MP-001', unit: 'u',
            wilson: { annualDemand: 6000, orderCost: 5000, holdingRate: 0.3, unitCost: 1200 },
            stockPolicy: { minConsumption: 20, maxConsumption: 40, minLeadTime: 5, maxLeadTime: 12, safetyStock: 200 },
            initialStock: { quantity: 100, unitCost: 1000 },
            movements: [
              { date: '05/01/2026', type: 'purchase', detail: 'Compra', quantity: 400, unitCost: 1200 },
              { date: '15/01/2026', type: 'consumption', detail: 'Consumo', quantity: 300 },
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
          uncertainRemunerative: [
            { name: 'PAP', coefficient: 0.05 },
            { name: 'PPP', coefficient: 0.05 },
          ],
          uncertainNonRemunerative: [],
        },
        departments: [
          { name: 'Corte', basicRemuneration: 800000, hoursWorked: 160 },
          { name: 'Ensamblaje', basicRemuneration: 600000, hoursWorked: 160 },
        ],
      },
      indirectCosts: {
        centers: [
          { id: 'corte', name: 'Corte', type: 'productive' },
          { id: 'ensam', name: 'Ensamblaje', type: 'productive' },
          { id: 'mant', name: 'Mantenimiento', type: 'service' },
        ],
        concepts: [
          { name: 'Alquiler',    amount: { fixed: 300000, variable: 0 }, distribution: { corte: 40, ensam: 40, mant: 20 } },
          { name: 'Energía',     amount: { fixed: 0, variable: 200000 }, distribution: { corte: 50, ensam: 30, mant: 20 } },
          { name: 'Lubricantes', amount: { fixed: 0, variable: 100000 }, distribution: { corte: 0,  ensam: 0,  mant: 100 } },
        ],
        serviceDistributions: [
          {
            serviceCenterId: 'mant',
            toProductiveFixed: { corte: 60, ensam: 40 },
            toProductiveVariable: { corte: 60, ensam: 40 },
          },
        ],
        productiveSettings: [
          { centerId: 'corte', normalCapacity: 160, actualActivity: 150, actualCip: 350000 },
          { centerId: 'ensam', normalCapacity: 160, actualActivity: 160, actualCip: 260000 },
        ] as CalculationInput['indirectCosts']['productiveSettings'],
      },
      inventory: { initialWorkInProcess: 0, finalWorkInProcess: 0, initialFinishedGoods: 0, finalFinishedGoods: 0 },
      sales: { unitPrice: 25000, quantity: 100 },
    };

    it('la variación del período es la suma de la de cada centro que cerró', () => {
      const r = runCalculation(dorado);
      const corte = r.detail.indirectCosts.perDepartment.corte!;
      const ensam = r.detail.indirectCosts.perDepartment.ensam!;

      expect(corte.budgetVariance).toBeCloseTo(21500, 6);
      expect(ensam.budgetVariance).toBeCloseTo(0, 6);
      expect(r.budgetVariance).toBeCloseTo(21500, 6);
    });

    it('el costo REAL del caso Dorado supera al normal exactamente en esa variación', () => {
      const r = runCalculation(dorado);
      expect(r.realProductionCost).toBeCloseTo(r.productionCost + 21500, 2);
      // Y llega al CPV, que es el número que va al estado de resultados.
      expect(r.costOfGoodsSold).toBeCloseTo(r.realProductionCost!, 2);
    });

    it('el costo NORMAL no se movió: sigue siendo MP + MOD + CIP aplicados', () => {
      const r = runCalculation(dorado);
      expect(r.productionCost).toBeCloseTo(
        r.rawMaterialConsumed + r.directLaborTotal + r.indirectCostsApplied,
        2,
      );
    });

    it('criterio 2: la variación VOLUMEN sigue fuera del estado de costos', () => {
      const r = runCalculation(dorado);
      const corte = r.detail.indirectCosts.perDepartment.corte!;

      // Corte tiene variación volumen distinta de cero (actividad real 150 sobre
      // capacidad normal 160): es capacidad ociosa, y va al estado de resultados.
      expect(corte.volumeVariance).not.toBeCloseTo(0, 2);
      // El costo real solo incorporó la variación presupuesto. Si la volumen se
      // hubiera colado, la diferencia contra el normal no daría 21.500 exactos.
      expect(r.realProductionCost! - r.productionCost).toBeCloseTo(21500, 2);
    });

    it('un centro pendiente de cierre aporta cero, no una variación fantasma', () => {
      // Sin CIP real no hay contra qué comparar: el centro queda pendiente y su
      // variación es cero, así que el costo real es igual al normal.
      const sinCierre: CalculationInput = {
        ...dorado,
        indirectCosts: {
          ...dorado.indirectCosts,
          productiveSettings: [
            { centerId: 'corte', normalCapacity: 160, actualActivity: 150, actualCip: 0 },
            { centerId: 'ensam', normalCapacity: 160, actualActivity: 160, actualCip: 0 },
          ] as CalculationInput['indirectCosts']['productiveSettings'],
        },
      };
      const r = runCalculation(sinCierre);
      expect(r.detail.indirectCosts.perDepartment.corte!.pendingClosing).toBe(true);
      expect(r.budgetVariance).toBe(0);
      expect(r.realProductionCost).toBeCloseTo(r.productionCost, 6);
    });
  });
});
