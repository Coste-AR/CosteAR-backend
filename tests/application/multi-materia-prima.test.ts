import { describe, it, expect } from 'vitest';
import { runCalculation, type CalculationInput } from '@/domain/calculations/calculate.js';
import { rawMaterialSectionSchema } from '@/shared/schemas/cost.schema.js';

/**
 * Parte 3.1 — N materias primas por estructura.
 *
 * Regresión: con UNA sola materia prima el número no cambia (misma matemática
 * que FX1). Con VARIAS, la MP consumida es la suma de cada ficha PPP.
 * Retrocompat: el schema acepta la forma legada (MP única plana) y la normaliza.
 */

function inputWith(materials: CalculationInput['rawMaterial']['materials']): CalculationInput {
  return {
    rawMaterial: { materials },
    directLabor: {
      workingDays: {
        totalDaysPerYear: 365,
        unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 0, holidaysOnWeekend: 0 },
        paidAbsence: { holidays: 0, vacations: 0, sickness: 0, specialLeaves: 0, workAccidents: 0 },
      },
      itcs: { derivationBase: 0.27, fixedArt: 0.015, uncertainRemunerative: [], uncertainNonRemunerative: [] },
      departments: [{ name: 'Depto', basicRemuneration: 1000, hoursWorked: 100 }],
    },
    indirectCosts: {
      centers: [{ id: 'c1', name: 'Centro 1', type: 'productive' }],
      concepts: [{ name: 'X', amount: { fixed: 100, variable: 0 }, distribution: { c1: 1 } }],
      serviceDistributions: [],
      productiveSettings: [{ centerId: 'c1', budget: { fixed: 0, variable: 0 }, normalCapacity: 100, actualActivity: 100, actualCip: 100 }],
      closureOrder: [],
    },
    inventory: { initialWorkInProcess: 0, finalWorkInProcess: 0, initialFinishedGoods: 0, finalFinishedGoods: 0 },
    sales: { unitPrice: 10, quantity: 10 },
  };
}

// Material A (caso "Piezas mecánicas" de FX1): consumo = 2.043.076,92.
const materialA = {
  name: 'Acero', code: 'MP-100', unit: 'u',
  wilson: { annualDemand: 6000, orderCost: 5000, holdingRate: 0.3, unitCost: 1200 },
  stockPolicy: { minConsumption: 20, maxConsumption: 40, minLeadTime: 5, maxLeadTime: 12, safetyStock: 200 },
  initialStock: { quantity: 300, unitCost: 2400 },
  movements: [
    { date: '01', type: 'purchase' as const, detail: 'Compra', quantity: 1000, unitCost: 2600 },
    { date: '02', type: 'consumption' as const, detail: 'Consumo', quantity: 800 },
  ],
};

// Material B (caso "Dorado"): consumo = 348.000.
const materialB = {
  name: 'Madera', code: 'MP-200', unit: 'u',
  wilson: { annualDemand: 6000, orderCost: 5000, holdingRate: 0.3, unitCost: 1200 },
  stockPolicy: { minConsumption: 20, maxConsumption: 40, minLeadTime: 5, maxLeadTime: 12, safetyStock: 200 },
  initialStock: { quantity: 100, unitCost: 1000 },
  movements: [
    { date: '01', type: 'purchase' as const, detail: 'Compra', quantity: 400, unitCost: 1200 },
    { date: '02', type: 'consumption' as const, detail: 'Consumo', quantity: 300 },
  ],
};

describe('Parte 3.1 — N materias primas', () => {
  it('una sola MP: consumo = 2.043.076,92 (idéntico a FX1)', () => {
    const r = runCalculation(inputWith([materialA]));
    expect(r.rawMaterialConsumed).toBeCloseTo(2043076.92, 2);
    expect(r.detail.rawMaterial.materials).toHaveLength(1);
  });

  it('dos MP: la consumida total es la suma (2.043.076,92 + 348.000 = 2.391.076,92)', () => {
    const r = runCalculation(inputWith([materialA, materialB]));
    expect(r.rawMaterialConsumed).toBeCloseTo(2391076.92, 2);
    expect(r.detail.rawMaterial.materials).toHaveLength(2);
    expect(r.detail.rawMaterial.materials[1]!.consumed).toBe(348000);
    expect(r.detail.rawMaterial.materials[0]!.name).toBe('Acero');
  });

  it('el schema normaliza la MP única legada (plana) a { materials: [...] }', () => {
    const legacy = {
      wilson: { annualDemand: 6000, orderCost: 5000, holdingRate: 0.3, unitCost: 1200 },
      stockPolicy: { minConsumption: 20, maxConsumption: 40, minLeadTime: 5, maxLeadTime: 12, safetyStock: 200 },
      initialStock: { quantity: 300, unitCost: 2400 },
      movements: [
        { date: '01', type: 'purchase', detail: 'Compra', quantity: 1000, unitCost: 2600 },
        { date: '02', type: 'consumption', detail: 'Consumo', quantity: 800 },
      ],
    };
    const parsed = rawMaterialSectionSchema.parse(legacy);
    expect(parsed.materials).toHaveLength(1);
    expect(parsed.materials[0]!.wilson.unitCost).toBe(1200);
  });
});
