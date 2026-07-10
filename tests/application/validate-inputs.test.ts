import { describe, it, expect } from 'vitest';
import { validateCalculationInputs, toMissingInputError } from '@/application/cost-structures/validate-inputs.js';
import { MissingInputError } from '@/domain/errors/calculation-errors.js';
import type { CalculationInput } from '@/application/cost-structures/calculate.js';

/**
 * Fix crítico de la spec: el cierre del prorrateo secundario a veces no corría
 * al guardar CIF y `calculate` reventaba con un 500 crudo cuando faltaba un
 * insumo (capacidad normal en 0, sin conceptos de CIF, horas en 0). Estos
 * tests verifican que esos casos SIEMPRE se traducen a 422 MISSING_INPUT
 * accionable, nunca a una excepción cruda.
 */

function baseInput(): CalculationInput {
  return {
    rawMaterial: {
      wilson: { annualDemand: 100, orderCost: 100, holdingRate: 0.3, unitCost: 10 },
      stockPolicy: { minConsumption: 1, maxConsumption: 2, minLeadTime: 1, maxLeadTime: 2, safetyStock: 1 },
      initialStock: { quantity: 10, unitCost: 10 },
      movements: [],
    },
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
      productiveSettings: [
        { centerId: 'c1', normalCapacity: 100, actualActivity: 100, actualCip: 100 },
      ] as CalculationInput['indirectCosts']['productiveSettings'],
    },
    inventory: { initialWorkInProcess: 0, finalWorkInProcess: 0, initialFinishedGoods: 0, finalFinishedGoods: 0 },
    sales: { unitPrice: 10, quantity: 10 },
  };
}

describe('validateCalculationInputs — 500 → 422 accionable', () => {
  it('input completo no tira nada', () => {
    expect(() => validateCalculationInputs(baseInput())).not.toThrow();
  });

  it('horas trabajadas en 0 → MissingInputError con field del departamento', () => {
    const input = baseInput();
    input.directLabor.departments[0]!.hoursWorked = 0;
    try {
      validateCalculationInputs(input);
      expect.fail('debía tirar MissingInputError');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingInputError);
      expect((err as MissingInputError).statusCode).toBe(422);
      expect((err as MissingInputError).code).toBe('MISSING_INPUT');
      expect((err as MissingInputError).details).toMatchObject({ field: expect.stringContaining('hoursWorked') });
    }
  });

  it('capacidad normal en 0 → MissingInputError, no un crash del motor', () => {
    const input = baseInput();
    input.indirectCosts.productiveSettings[0]!.normalCapacity = 0;
    expect(() => validateCalculationInputs(input)).toThrow(MissingInputError);
  });

  it('centro productivo referenciado que no existe en `centers` → MissingInputError', () => {
    const input = baseInput();
    input.indirectCosts.productiveSettings[0]!.centerId = 'fantasma';
    expect(() => validateCalculationInputs(input)).toThrow(MissingInputError);
  });

  it('sin conceptos de CIF pero con centros productivos activos → MissingInputError (presupuesto no derivable)', () => {
    const input = baseInput();
    input.indirectCosts.concepts = [];
    expect(() => validateCalculationInputs(input)).toThrow(MissingInputError);
  });

  it('toMissingInputError envuelve cualquier Error crudo del motor en un 422', () => {
    const raw = new Error('Concepto "X": base de distribución total = 0');
    const wrapped = toMissingInputError(raw);
    expect(wrapped).toBeInstanceOf(MissingInputError);
    expect(wrapped.statusCode).toBe(422);
    expect(wrapped.message).toContain('base de distribución total = 0');
  });
});
