import { describe, it, expect } from 'vitest';
import { Money } from '@/domain/value-objects/money.js';
import { calcCostStatement } from '@/domain/calculations/cost-statement.js';
import { runCalculation, type CalculationInput } from '@/domain/calculations/calculate.js';
import { indirectCostConfigSchema } from '@/shared/schemas/cost.schema.js';

/**
 * #90 (segunda parte) — Los TRABAJOS DE TERCEROS del estado de costos.
 *
 * Procesos que se mandan a hacer afuera —un tratamiento térmico, un bordado, un
 * flete de proceso— y que son parte del costo de producción. El estado de
 * costos los omitía por completo: no existían en el modelo.
 *
 * Estructura de la cátedra:
 *
 *     MP consumida + MOD devengada + CIP aplicados
 *   = COSTO NORMAL DE PRODUCCIÓN DEL PERÍODO
 *   + Trabajos de terceros
 *   ± Variación presupuesto
 *   = COSTO REAL DE PRODUCCIÓN
 *
 * LA REGLA QUE MANDA (clase 20): *«los trabajos de terceros se registran por
 * SEPARADO de los CIP»*. No entran al prorrateo, no tienen cuota y no generan
 * variaciones. Se cargan al costo de la orden enteros —en el práctico de la
 * clase, la Orden 125 "incluye trabajos de terceros"—, y por eso van como
 * renglón propio y no como un concepto de CIF más.
 */
describe('#90 — trabajos de terceros en el estado de costos', () => {
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
    const NORMAL = 180000;

    it('suman al costo real como renglón propio', () => {
      const r = calcCostStatement({ ...base, thirdPartyWork: Money.of(25000) });

      expect(r.productionCost.toNumber()).toBe(NORMAL);
      expect(r.thirdPartyWork.toNumber()).toBe(25000);
      expect(r.realProductionCost.toNumber()).toBe(NORMAL + 25000);
    });

    it('llegan hasta el CPV: no se pierden en el camino', () => {
      const sin = calcCostStatement(base);
      const con = calcCostStatement({ ...base, thirdPartyWork: Money.of(25000) });
      expect(con.costOfGoodsSold.subtract(sin.costOfGoodsSold).toNumber()).toBe(25000);
    });

    it('conviven con la variación presupuesto, cada uno con su signo', () => {
      // Terceros SUMA siempre; la variación puede sumar o restar.
      const r = calcCostStatement({
        ...base,
        thirdPartyWork: Money.of(25000),
        budgetVariance: Money.of(-10000),
      });
      expect(r.realProductionCost.toNumber()).toBe(NORMAL + 25000 - 10000);
    });

    it('clave a mano con todos los renglones a la vez', () => {
      const r = calcCostStatement({
        ...base,
        thirdPartyWork: Money.of(25000),
        budgetVariance: Money.of(20000),
        wasteRecovery: Money.of(5000),
        extraordinaryLoss: Money.of(15000),
        initialWorkInProcess: Money.of(25000),
        finalWorkInProcess: Money.of(40000),
      });

      //   normal                             180.000
      // + terceros                            25.000
      // + variación presupuesto               20.000
      // = real                               225.000
      // − recupero 5.000 − extraordinaria 15.000 = 205.000  (neto de desperdicio)
      // + EI PP 25.000 − EF PP 40.000            = 190.000  (productos terminados)
      expect(r.realProductionCost.toNumber()).toBe(225000);
      expect(r.netProductionCost.toNumber()).toBe(205000);
      expect(r.finishedGoodsCost.toNumber()).toBe(190000);
    });

    it('sin trabajos de terceros, ningún número cambia', () => {
      const sinPasar = calcCostStatement(base);
      const enCero = calcCostStatement({ ...base, thirdPartyWork: Money.zero() });
      expect(sinPasar.thirdPartyWork.toNumber()).toBe(0);
      expect(sinPasar.realProductionCost.toNumber()).toBe(NORMAL);
      expect(sinPasar.costOfGoodsSold.toNumber()).toBe(enCero.costOfGoodsSold.toNumber());
    });
  });

  describe('enchufado al motor', () => {
    function caso(thirdPartyWork?: number): CalculationInput {
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
        indirectCosts: indirectCostConfigSchema.parse({
          centers: [{ id: 'unico', name: 'Único', type: 'productive' }],
          concepts: [{ name: 'CIF', amount: { fixed: 0, variable: 0 }, distribution: { unico: 1 } }],
          serviceDistributions: [],
          ...(thirdPartyWork !== undefined ? { thirdPartyWork } : {}),
          productiveSettings: [
            { centerId: 'unico', normalCapacity: 100, actualActivity: 100, actualCip: 0 },
          ],
        }),
        inventory: { initialWorkInProcess: 0, finalWorkInProcess: 0, initialFinishedGoods: 0, finalFinishedGoods: 0 },
        sales: { unitPrice: 3000, quantity: 100, productionQuantity: 100 },
      };
    }

    it('el costo real sube exactamente en lo que se mandó a hacer afuera', () => {
      const sin = runCalculation(caso());
      const con = runCalculation(caso(25000));

      expect(sin.thirdPartyWork).toBe(0);
      expect(con.thirdPartyWork).toBe(25000);
      expect(con.realProductionCost! - sin.realProductionCost!).toBeCloseTo(25000, 2);
    });

    it('el costo NORMAL no se toca: los terceros no son un CIP', () => {
      const con = runCalculation(caso(25000));
      // MP 100.000 + MOD 0 + CIP 0. Si los terceros se hubieran colado como
      // concepto de CIF, este número sería 125.000 y además estarían repartidos
      // entre los centros y diluidos en las cuotas.
      expect(con.productionCost).toBeCloseTo(100000, 2);
      expect(con.indirectCostsApplied).toBeCloseTo(0, 2);
    });

    it('mueven el costo unitario de lo terminado, que es con lo que se pone precio', () => {
      const sin = runCalculation(caso()).detail.unitCost.unitFinishedGoodsCost;
      const con = runCalculation(caso(25000)).detail.unitCost.unitFinishedGoodsCost;

      expect(sin).toBeCloseTo(1000, 6);
      expect(con).toBeCloseTo(1250, 6);
    });

    it('una estructura sin el campo se lee igual que antes (default 0)', () => {
      // Retrocompatibilidad: el JSON ya persistido no tiene `thirdPartyWork`, y
      // volverlo impasable convertiría un dato viejo en un error al leer.
      const cfg = indirectCostConfigSchema.parse({
        centers: [{ id: 'unico', name: 'Único', type: 'productive' }],
        concepts: [{ name: 'CIF', amount: { fixed: 0, variable: 0 }, distribution: { unico: 1 } }],
        serviceDistributions: [],
        productiveSettings: [{ centerId: 'unico', normalCapacity: 100, actualActivity: 100, actualCip: 0 }],
      });
      expect(cfg.thirdPartyWork).toBe(0);
    });

    it('el schema rechaza un importe negativo', () => {
      expect(() =>
        indirectCostConfigSchema.parse({
          centers: [{ id: 'unico', name: 'Único', type: 'productive' }],
          concepts: [{ name: 'CIF', amount: { fixed: 0, variable: 0 }, distribution: { unico: 1 } }],
          serviceDistributions: [],
          thirdPartyWork: -100,
          productiveSettings: [{ centerId: 'unico', normalCapacity: 100, actualActivity: 100, actualCip: 0 }],
        }),
      ).toThrow();
    });
  });
});
