import { describe, it, expect } from 'vitest';
import { runCalculation, type CalculationInput } from '@/application/cost-structures/calculate.js';

/**
 * Test end-to-end del orquestador: configura una estructura completa (los 4
 * elementos) y verifica que el resultado consolidado sea coherente con los
 * cálculos por hoja ya verificados individualmente.
 */
describe('runCalculation — orquestación completa del motor', () => {
  const input: CalculationInput = {
    rawMaterial: {
      wilson: { annualDemand: 24000, orderCost: 3500, holdingRate: 0.3, unitCost: 800 },
      stockPolicy: { minConsumption: 40, maxConsumption: 90, minLeadTime: 8, maxLeadTime: 12, safetyStock: 200 },
      initialStock: { quantity: 300, unitCost: 800 },
      movements: [
        { date: '02/05', type: 'purchase', detail: 'A-101', quantity: 500, unitCost: 850 },
        { date: '08/05', type: 'consumption', detail: 'OP-01', quantity: 400 },
        { date: '15/05', type: 'purchase', detail: 'A-118', quantity: 600, unitCost: 900 },
        { date: '24/05', type: 'consumption', detail: 'OP-02', quantity: 700 },
      ],
    },
    directLabor: {
      workingDays: { totalDaysPerYear: 365, nonWorkingDays: 115, vacationDays: 14, averageAbsenceDays: 6 },
      socialCharges: [{ name: 'Cargas', percent: 50 }],
      departments: [{ departmentName: 'Armado', workers: 5, monthlyWage: 400000, hoursPerDay: 8 }],
    },
    indirectCosts: {
      centers: [
        { id: 'prod1', name: 'Productivo 1', type: 'productive' },
        { id: 'serv1', name: 'Mantenimiento', type: 'service' },
      ],
      concepts: [
        {
          name: 'Alquiler',
          amount: { fixed: 100000, variable: 0 },
          distribution: { prod1: 70, serv1: 30 },
        },
      ],
      serviceDistributions: [{ serviceCenterId: 'serv1', toProductive: { prod1: 100 } }],
      productiveSettings: [
        { centerId: 'prod1', budget: { fixed: 120000, variable: 80000 }, normalCapacity: 1000, actualActivity: 900, actualCip: 195000 },
      ],
    },
    inventory: { initialWorkInProcess: 0, finalWorkInProcess: 0, initialFinishedGoods: 0, finalFinishedGoods: 0 },
    sales: { unitPrice: 3000, quantity: 1000 },
  };

  it('produce MP consumida = 943.250 (de la ficha PPP)', () => {
    const r = runCalculation(input);
    expect(r.rawMaterialConsumed).toBe(943250);
  });

  it('produce MOD integral = 39.000.000 (Armado)', () => {
    const r = runCalculation(input);
    expect(r.directLaborTotal).toBe(39000000);
  });

  it('aplica CIP = 200 × 900 = 180.000', () => {
    const r = runCalculation(input);
    expect(r.indirectCostsApplied).toBe(180000);
  });

  it('consolida el costo de producción coherentemente', () => {
    const r = runCalculation(input);
    // Producción = MP 943250 + MOD 39.000.000 + CIP 180.000 = 40.123.250
    expect(r.productionCost).toBe(40123250);
    expect(r.costOfGoodsSold).toBe(40123250); // sin inventarios
  });

  it('calcula el margen (ventas 3.000.000 − CPV)', () => {
    const r = runCalculation(input);
    // Ventas = 3000 × 1000 = 3.000.000; CPV enorme → margen negativo
    expect(r.grossMargin).toBe(3000000 - 40123250);
    expect(r.grossMarginPct).toBeLessThan(0);
  });

  it('expone el detalle por hoja', () => {
    const r = runCalculation(input);
    expect(r.detail.rawMaterial.optimalLot).toBeCloseTo(836.66, 1);
    expect(r.detail.directLabor.workingDays).toBe(230);
    expect(r.detail.directLabor.itcsPercent).toBe(50);
    expect(r.detail.indirectCosts.perDepartment.prod1!.appliedCip).toBe(180000);
  });
});
