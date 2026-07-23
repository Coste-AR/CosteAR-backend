import { describe, it, expect } from 'vitest';
import { runCalculation, type CalculationInput } from '@/domain/calculations/calculate.js';

/**
 * CASO DE PRUEBA DORADO (test de aceptación — costeo Por Órdenes).
 *
 * Inputs y outputs verificados a mano en la especificación de correcciones.
 * Cubre el núcleo de la entrega:
 *   - BUG-01: el prorrateo secundario se cierra solo y auto-completa el
 *             presupuesto → CIP aplicado ≠ 0 (sin tipear presupuestos a mano).
 *   - BUG-03: la variación de presupuesto usa el CIP REAL ingresado por el
 *             usuario, no el valor presupuestado del prorrateo.
 *
 * Nota: la validación exacta del ITCS/MOD (BUG-04) está diferida; por eso el
 * total de MOD no se hardcodea: se verifica la coherencia de la suma final.
 */
describe('Caso Dorado — costeo Por Órdenes', () => {
  // Presupuesto OMITIDO a propósito: debe derivarse del prorrateo, no tipearse.
  const input: CalculationInput = {
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
        { name: 'Alquiler',    amount: { fixed: 300000, variable: 0 },      distribution: { corte: 40, ensam: 40, mant: 20 } },
        { name: 'Energía',     amount: { fixed: 0, variable: 200000 },      distribution: { corte: 50, ensam: 30, mant: 20 } },
        { name: 'Lubricantes', amount: { fixed: 0, variable: 100000 },      distribution: { corte: 0,  ensam: 0,  mant: 100 } },
      ],
      serviceDistributions: [
        {
          serviceCenterId: 'mant',
          toProductiveFixed: { corte: 60, ensam: 40 },
          toProductiveVariable: { corte: 60, ensam: 40 },
        },
      ],
      productiveSettings: [
        // Sin "budget": se auto-deriva del prorrateo. CIP real = dato de fin de mes.
        { centerId: 'corte', normalCapacity: 160, actualActivity: 150, actualCip: 350000 },
        { centerId: 'ensam', normalCapacity: 160, actualActivity: 160, actualCip: 260000 },
      ] as CalculationInput['indirectCosts']['productiveSettings'],
    },
    inventory: { initialWorkInProcess: 0, finalWorkInProcess: 0, initialFinishedGoods: 0, finalFinishedGoods: 0 },
    sales: { unitPrice: 25000, quantity: 100 },
  };

  // ── Materia Prima ──────────────────────────────────────────────────────────
  it('MP consumida = 300 × PPP 1.160 = 348.000', () => {
    const r = runCalculation(input);
    expect(r.rawMaterialConsumed).toBe(348000);
  });

  it('stock final = 200 u × 1.160 = 232.000 y lote óptimo ≈ 408', () => {
    const r = runCalculation(input);
    expect(r.detail.rawMaterial.finalStockValue).toBe(232000);
    expect(r.detail.rawMaterial.optimalLot).toBeCloseTo(408, 0);
  });

  // ── BUG-01: prorrateo secundario auto-cerrado → cuotas y CIP aplicado ───────
  it('Corte: cuota 2.125 y CIP aplicado 318.750 (presupuesto 156.000/184.000 auto-derivado)', () => {
    const r = runCalculation(input);
    const corte = r.detail.indirectCosts.perDepartment.corte!;
    expect(corte.quota).toBe(2125);
    expect(corte.appliedCip).toBe(318750);
  });

  it('Ensamblaje: cuota 1.625 y CIP aplicado 260.000 (presupuesto 144.000/116.000)', () => {
    const r = runCalculation(input);
    const ensam = r.detail.indirectCosts.perDepartment.ensam!;
    expect(ensam.quota).toBe(1625);
    expect(ensam.appliedCip).toBe(260000);
  });

  it('CIP aplicado TOTAL = 578.750 sin cargar presupuestos a mano', () => {
    const r = runCalculation(input);
    expect(r.indirectCostsApplied).toBe(578750);
  });

  // ── BUG-03: la variación usa el CIP REAL ingresado, no el presupuesto ───────
  it('Corte: CIP real = 350.000 (ingresado), Var. Presupuesto = 21.500, Var. Volumen = 9.750', () => {
    const r = runCalculation(input);
    const corte = r.detail.indirectCosts.perDepartment.corte!;
    expect(corte.actualCip).toBe(350000);
    expect(corte.budgetVariance).toBe(21500);
    expect(corte.volumeVariance).toBe(9750);
  });

  it('Ensamblaje: Var. Presupuesto = 0 y Var. Volumen = 0 (actividad = capacidad normal)', () => {
    const r = runCalculation(input);
    const ensam = r.detail.indirectCosts.perDepartment.ensam!;
    expect(ensam.actualCip).toBe(260000);
    expect(ensam.budgetVariance).toBe(0);
    expect(ensam.volumeVariance).toBe(0);
  });

  // ── Resultado: suma siempre los tres elementos ─────────────────────────────
  it('Costo de producción = MP consumida + MOD + CIP aplicado (ninguno en cero)', () => {
    const r = runCalculation(input);
    expect(r.productionCost).toBeCloseTo(
      r.rawMaterialConsumed + r.directLaborTotal + r.indirectCostsApplied,
      2,
    );
    expect(r.rawMaterialConsumed).toBeGreaterThan(0);
    expect(r.directLaborTotal).toBeGreaterThan(0);
    expect(r.indirectCostsApplied).toBe(578750);
  });

  // ── Costo unitario: el número final del sistema ────────────────────────────
  it('costo unitario de producción = costo de producción ÷ unidades producidas', () => {
    const r = runCalculation(input);
    expect(r.detail.unitCost.unitsProduced).toBe(100); // sales.quantity
    expect(r.detail.unitCost.unitProductionCost).toBeCloseTo(r.productionCost / 100, 2);
    expect(r.detail.unitCost.unitCostOfGoodsSold).toBeCloseTo(r.costOfGoodsSold / 100, 2);
    expect(r.detail.unitCost.unitProductionCost).toBeGreaterThan(0);
  });

  it('costo unitario = 0 (no revienta) cuando aún no se cargó la cantidad producida', () => {
    const r = runCalculation({ ...input, sales: { unitPrice: 0, quantity: 0 } });
    expect(r.detail.unitCost.unitsProduced).toBe(0);
    expect(r.detail.unitCost.unitProductionCost).toBe(0);
  });

  it('días hábiles efectivos = 232 e itcsPercent expuesto como porcentaje (>1)', () => {
    const r = runCalculation(input);
    expect(r.detail.directLabor.workingDays).toBe(232);
    expect(r.detail.directLabor.itcsPercent).toBeGreaterThan(1);
  });
});
