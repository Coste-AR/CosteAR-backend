import { describe, it, expect } from 'vitest';
import { Money } from '@/domain/value-objects/money.js';
import { calcStockLedgerPPP } from '@/domain/calculations/raw-material.js';
import { calcWorkingDays, calcITCS, calcDirectLabor } from '@/domain/calculations/direct-labor.js';
import { calcPredeterminedQuota, calcVarianceAnalysis } from '@/domain/calculations/indirect-costs.js';
import { calcCostStatement, calcGrossMargin } from '@/domain/calculations/cost-statement.js';

/**
 * R5 — REGRESIÓN CERO en la matemática (spec "Trazabilidad Total v1").
 *
 * Estos fixtures están verificados a mano en la especificación y se corren
 * ANTES de tocar el motor y DESPUÉS de cada fase. Si algo acá se rompe, el
 * motor de cálculo cambió su matemática y hay que revertir, no "ajustar" el
 * test.
 */

describe('R5 — Caso "Piezas mecánicas" (fixture de aceptación completo)', () => {
  describe('Materia Prima — PPP', () => {
    // EI 300u × 2.400 + compra 1000u × 2.600, consumo 800u
    const ledger = calcStockLedgerPPP(300, 2400, [
      { date: '01', type: 'purchase', detail: 'Compra', quantity: 1000, unitCost: 2600 },
      { date: '02', type: 'consumption', detail: 'Consumo', quantity: 800 },
    ]);

    it('PPP tras la compra = (300×2400 + 1000×2600) / 1300 = 2.553,846154', () => {
      const afterPurchase = ledger.rows[0]!;
      expect(afterPurchase.balanceUnitCost.toDecimal().toNumber()).toBeCloseTo(2553.846154, 4);
    });

    it('MP consumida = 800 × PPP = 2.043.076,92', () => {
      expect(ledger.rawMaterialConsumed.toNumber()).toBeCloseTo(2043076.92, 2);
    });
  });

  describe('Mano de Obra Directa — días, IAP, ITCS, MOD total', () => {
    const workingDaysConfig = {
      totalDaysPerYear: 365,
      unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 2, holidaysOnWeekend: 3 },
      paidAbsence: { holidays: 12, vacations: 14, sickness: 6, specialLeaves: 2, workAccidents: 6 },
    };

    it('días efectivos = 365 − (52+52+2−3) − (12+14+6+2+6) = 222', () => {
      const r = calcWorkingDays(workingDaysConfig);
      expect(r.effectiveWorkDays.toNumber()).toBe(222);
    });

    it('IAP = 40 pagos / 222 efectivos ≈ 18,02 % — SIEMPRE derivado, nunca input manual', () => {
      const r = calcWorkingDays(workingDaysConfig);
      expect(r.iap.toPercent()).toBeCloseTo(18.018, 2);
    });

    const direct = calcDirectLabor({
      workingDays: workingDaysConfig,
      itcs: {
        derivationBase: 0.27,
        fixedArt: 0.015,
        uncertainRemunerative: [{ name: 'Premio', coefficient: 0.15 }],
        uncertainNonRemunerative: [],
      },
      departments: [
        { name: 'Mecanizado', basicRemuneration: 1500000, hoursWorked: 400 },
        { name: 'Terminado', basicRemuneration: 1200000, hoursWorked: 350 },
      ],
    });

    it('ITCS ≈ 84,51 %', () => {
      expect(direct.itcs.itcs.toPercent()).toBeCloseTo(84.5106, 2);
    });

    it('MOD total (Mecanizado 1.500.000 + Terminado 1.200.000) × 1,845106 ≈ 4.981.786,82', () => {
      expect(direct.totalMod.toNumber()).toBeCloseTo(4981786.82, 1);
    });
  });

  describe('ITCS cátedra (fórmula aditiva) — 3 casos', () => {
    // Caso 1: idéntico al ejemplo del Excel de cátedra (ver tests/domain/direct-labor.test.ts).
    it('caso1 = 0,799903', () => {
      const days = calcWorkingDays({
        totalDaysPerYear: 365,
        unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 3, holidaysOnWeekend: 4 },
        paidAbsence: { holidays: 19, vacations: 14, sickness: 5, specialLeaves: 2, workAccidents: 1 },
      });
      const itcs = calcITCS(
        {
          derivationBase: 0.27,
          fixedArt: 0.015,
          uncertainRemunerative: [
            { name: 'Premio por Productividad', coefficient: 0.03 },
            { name: 'Antigüedad', coefficient: 0.04 },
            { name: 'Premio por Asistencia Perfecta', coefficient: 0.02 },
          ],
          uncertainNonRemunerative: [
            { name: 'Ropa de trabajo', coefficient: 0.01 },
            { name: 'Viandas / comedor', coefficient: 0.015 },
            { name: 'Medicamentos', coefficient: 0.005 },
          ],
        },
        days.iap,
      );
      expect(itcs.itcs.toFraction().toNumber()).toBeCloseTo(0.799903, 5);
    });

    it('caso2 = 0,676078 (solo IAP, sin premios ni antigüedad)', () => {
      const days = calcWorkingDays({
        totalDaysPerYear: 365,
        unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 3, holidaysOnWeekend: 4 },
        paidAbsence: { holidays: 19, vacations: 14, sickness: 5, specialLeaves: 2, workAccidents: 1 },
      });
      const itcs = calcITCS(
        {
          derivationBase: 0.27,
          fixedArt: 0.015,
          uncertainRemunerative: [],
          uncertainNonRemunerative: [
            { name: 'Ropa de trabajo', coefficient: 0.01 },
            { name: 'Viandas / comedor', coefficient: 0.015 },
            { name: 'Medicamentos', coefficient: 0.005 },
          ],
        },
        days.iap,
      );
      expect(itcs.itcs.toFraction().toNumber()).toBeCloseTo(0.676078, 5);
    });

    it('caso3 = 0,390833 (mínimo: sin ausentismo pago, sin inciertas)', () => {
      const days = calcWorkingDays({
        totalDaysPerYear: 365,
        unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 3, holidaysOnWeekend: 4 },
        paidAbsence: { holidays: 0, vacations: 0, sickness: 0, specialLeaves: 0, workAccidents: 0 },
      });
      const itcs = calcITCS(
        { derivationBase: 0.27, fixedArt: 0.015, uncertainRemunerative: [], uncertainNonRemunerative: [] },
        days.iap,
      );
      expect(itcs.itcs.toFraction().toNumber()).toBeCloseTo(0.390833, 5);
    });
  });

  describe('CIP — cuotas, aplicado y variaciones', () => {
    const mecBudget = { fixed: Money.of(345000), variable: Money.of(184500) };
    const terBudget = { fixed: Money.of(255000), variable: Money.of(115500) };
    const mecQuota = calcPredeterminedQuota(mecBudget, 400);
    const terQuota = calcPredeterminedQuota(terBudget, 350);

    it('cuota Mecanizado = 1.323,75 y cuota Terminado ≈ 1.058,57', () => {
      expect(mecQuota.totalQuota.toNumber()).toBe(1323.75);
      expect(terQuota.totalQuota.toNumber()).toBeCloseTo(1058.57, 2);
    });

    it('CIP aplicado total = 900.000 (Mec 529.500 + Ter 370.500) a actividad real 400/350 hs', () => {
      const mecVar = calcVarianceAnalysis(mecQuota, mecBudget, 400, 400, Money.of(400000));
      const terVar = calcVarianceAnalysis(terQuota, terBudget, 350, 350, Money.of(400000));
      expect(mecVar.cipApplied.toNumber()).toBe(529500);
      expect(terVar.cipApplied.toNumber()).toBe(370500);
      expect(mecVar.cipApplied.add(terVar.cipApplied).toNumber()).toBe(900000);
    });

    it('Var. presupuesto = −129.500 (Mecanizado) y +29.500 (Terminado)', () => {
      const mecVar = calcVarianceAnalysis(mecQuota, mecBudget, 400, 400, Money.of(400000));
      const terVar = calcVarianceAnalysis(terQuota, terBudget, 350, 350, Money.of(400000));
      expect(mecVar.budgetVariance.toNumber()).toBe(-129500);
      expect(terVar.budgetVariance.toNumber()).toBe(29500);
    });
  });

  describe('Estado de costos y margen — consolidación final', () => {
    // MP consumida + MOD + CIP aplicado, sin inventarios de proceso/terminados (todos en 0).
    const statement = calcCostStatement({
      initialRawMaterial: Money.of(300).multiply(2400),
      rawMaterialPurchases: Money.of(1000).multiply(2600),
      finalRawMaterial: Money.of(500).multiply(2553.846153846154), // 1300 − 800 = 500 u restantes
      directLabor: Money.of(4981786.82),
      indirectCostsApplied: Money.of(900000),
      initialWorkInProcess: Money.zero(),
      finalWorkInProcess: Money.zero(),
      initialFinishedGoods: Money.zero(),
      finalFinishedGoods: Money.zero(),
    });

    it('Costo de producción ≈ 7.924.863,75 (MP + MOD + CIP)', () => {
      // Nota: 1 centavo de diferencia con el valor de la spec por modo de
      // redondeo intermedio (Decimal.js ROUND_HALF_EVEN vs Excel); no es una
      // regresión de fórmula. Ver DECISIONES.md.
      expect(statement.productionCost.toNumber()).toBeCloseTo(7924863.75, 1);
    });

    it('Margen = 2.675.136,25 (25,24% de ingreso 13.250 × 800)', () => {
      const revenue = Money.of(13250).multiply(800);
      const margin = calcGrossMargin(revenue, statement.costOfGoodsSold);
      expect(revenue.toNumber()).toBe(10600000);
      expect(margin.grossMargin.toNumber()).toBeCloseTo(2675136.25, 1);
      expect(margin.grossMarginPct.toPercent()).toBeCloseTo(25.24, 1);
    });
  });
});
