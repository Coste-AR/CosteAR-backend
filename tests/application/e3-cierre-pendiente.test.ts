import { describe, it, expect } from 'vitest';
import { runCalculation, type CalculationInput } from '@/domain/calculations/calculate.js';

/**
 * E3 — CAPACIDAD NORMAL, ACTIVIDAD REAL y CIP REAL.
 *
 * La actividad real y el CIP real son datos de CIERRE de mes: durante el mes
 * todavía no existen. El sistema los trataba como CERO, y eso producía dos
 * mentiras silenciosas:
 *
 *   1. CIF aplicado = cuota × 0 = 0  → el producto quedaba costeado SIN costos
 *      indirectos, sin ningún aviso.
 *   2. Variación de presupuesto = CIP real (0) − presupuesto → una variación
 *      enorme y "favorable" comparada contra la nada.
 *
 * Regla nueva: sin cierre, el CIF se aplica sobre la CAPACIDAD NORMAL (costo
 * predeterminado) y las variaciones NO se calculan (el centro queda marcado
 * como pendiente de cierre).
 */

// Mismo caso Dorado, con los datos de cierre como variable del test.
function buildInput(closing: {
  corte: { actualActivity: number; actualCip: number };
  ensam: { actualActivity: number; actualCip: number };
}): CalculationInput {
  return {
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
        uncertainRemunerative: [],
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
        { centerId: 'corte', normalCapacity: 160, ...closing.corte },
        { centerId: 'ensam', normalCapacity: 160, ...closing.ensam },
      ] as CalculationInput['indirectCosts']['productiveSettings'],
    },
    inventory: { initialWorkInProcess: 0, finalWorkInProcess: 0, initialFinishedGoods: 0, finalFinishedGoods: 0 },
    sales: { unitPrice: 25000, quantity: 100 },
  };
}

/** Mes en curso: todavía no hay cierre. */
const sinCierre = buildInput({
  corte: { actualActivity: 0, actualCip: 0 },
  ensam: { actualActivity: 0, actualCip: 0 },
});

/** Mes cerrado (caso Dorado original). */
const conCierre = buildInput({
  corte: { actualActivity: 150, actualCip: 350000 },
  ensam: { actualActivity: 160, actualCip: 260000 },
});

describe('E3 — sin datos de cierre, el CIF se aplica a capacidad normal', () => {
  it('el CIF ya NO entra en cero al costo del producto', () => {
    const r = runCalculation(sinCierre);
    // Antes: cuota × 0 = 0 en los dos centros → producto sin CIF y sin aviso.
    // Ahora: Corte 2.125 × 160 = 340.000 · Ensamblaje 1.625 × 160 = 260.000.
    expect(r.detail.indirectCosts.perDepartment.corte!.appliedCip).toBe(340000);
    expect(r.detail.indirectCosts.perDepartment.ensam!.appliedCip).toBe(260000);
    expect(r.indirectCostsApplied).toBe(600000);
  });

  it('marca el centro como PENDIENTE DE CIERRE y dice sobre qué nivel aplicó', () => {
    const r = runCalculation(sinCierre);
    const corte = r.detail.indirectCosts.perDepartment.corte!;
    expect(corte.pendingClosing).toBe(true);
    expect(corte.appliedOn).toBe('normalCapacity');
  });

  it('NO inventa variaciones: sin CIP real no hay contra qué comparar', () => {
    const r = runCalculation(sinCierre);
    const corte = r.detail.indirectCosts.perDepartment.corte!;
    // Antes: variación presupuesto = 0 − 340.000 = −340.000 "favorable" (fantasía).
    expect(corte.budgetVariance).toBe(0);
    expect(corte.volumeVariance).toBe(0);
    expect(corte.overUnderApplied).toBe(0);
  });

  it('la cuota SÍ se calcula (solo necesita la capacidad normal)', () => {
    const r = runCalculation(sinCierre);
    expect(r.detail.indirectCosts.perDepartment.corte!.quota).toBe(2125);
    expect(r.detail.indirectCosts.perDepartment.ensam!.quota).toBe(1625);
  });
});

describe('E3 — con el cierre cargado, nada cambia (el caso Dorado sigue igual)', () => {
  it('aplica sobre la actividad REAL y calcula las variaciones', () => {
    const r = runCalculation(conCierre);
    const corte = r.detail.indirectCosts.perDepartment.corte!;
    expect(corte.appliedCip).toBe(318750);          // 2.125 × 150
    expect(corte.pendingClosing).toBe(false);
    expect(corte.appliedOn).toBe('actualActivity');
    expect(corte.volumeVariance).not.toBe(0);
    expect(corte.budgetVariance).not.toBe(0);
  });

  it('regla de control: Var.Presupuesto + Var.Volumen = −(Sobre/Sub-aplicación)', () => {
    const r = runCalculation(conCierre);
    const corte = r.detail.indirectCosts.perDepartment.corte!;
    expect(corte.budgetVariance + corte.volumeVariance).toBeCloseTo(-corte.overUnderApplied, 6);
  });
});

describe('E3 — cierre a medias: hay actividad real pero falta el CIP real', () => {
  const aMedias = buildInput({
    corte: { actualActivity: 150, actualCip: 0 },
    ensam: { actualActivity: 160, actualCip: 260000 },
  });

  it('aplica sobre la actividad real, pero sigue pendiente y sin variaciones', () => {
    const r = runCalculation(aMedias);
    const corte = r.detail.indirectCosts.perDepartment.corte!;
    expect(corte.appliedCip).toBe(318750);          // 2.125 × 150 (la actividad sí está)
    expect(corte.appliedOn).toBe('actualActivity');
    expect(corte.pendingClosing).toBe(true);        // falta el CIP real
    expect(corte.budgetVariance).toBe(0);
  });

  it('el centro que SÍ cerró calcula sus variaciones con normalidad', () => {
    const r = runCalculation(aMedias);
    expect(r.detail.indirectCosts.perDepartment.ensam!.pendingClosing).toBe(false);
  });
});
