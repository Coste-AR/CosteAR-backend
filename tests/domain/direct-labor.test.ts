import { describe, it, expect } from 'vitest';
import {
  calcWorkingDays,
  calcITCS,
  calcDirectLabor,
  type DirectLaborConfig,
} from '@/domain/calculations/direct-labor.js';

/**
 * Ground truth: hoja "2-MOD Ejemplo" del Excel v3.0.
 * Verifica la metodología completa de la cátedra (días → IAP → ITCS → tarifa).
 */

// Configuración idéntica al ejemplo del Excel.
const example: DirectLaborConfig = {
  workingDays: {
    totalDaysPerYear: 365,
    unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 3, holidaysOnWeekend: 4 },
    paidAbsence: { holidays: 19, vacations: 14, sickness: 5, specialLeaves: 2, workAccidents: 1 },
  },
  itcs: {
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
  departments: [
    { name: 'Departamento Productivo 1', basicRemuneration: 4500000, hoursWorked: 12000 },
    { name: 'Departamento Productivo 2', basicRemuneration: 3200000, hoursWorked: 9000 },
    { name: 'Departamento Productivo 3', basicRemuneration: 2800000, hoursWorked: 8000 },
  ],
};

describe('Hoja 2 — Mano de Obra Directa', () => {
  describe('A) Distribución de días', () => {
    const r = calcWorkingDays(example.workingDays);

    it('Total ausentismo no pago = (52+52+3)−4 = 103', () => {
      expect(r.totalUnpaidAbsence.toNumber()).toBe(103);
    });

    it('Días totales a pagar = 365 − 103 = 262', () => {
      expect(r.daysToPayFor.toNumber()).toBe(262);
    });

    it('Total ausentismo pago = 19+14+5+2+1 = 41', () => {
      expect(r.totalPaidAbsence.toNumber()).toBe(41);
    });

    it('Días de trabajo efectivo = 262 − 41 = 221', () => {
      expect(r.effectiveWorkDays.toNumber()).toBe(221);
    });

    it('IAP = 41/221 ≈ 18,55 %', () => {
      expect(r.iap.toPercent()).toBeCloseTo(18.552, 2);
    });
  });

  describe('C) ITCS', () => {
    const days = calcWorkingDays(example.workingDays);
    const itcs = calcITCS(example.itcs, days.iap);

    it('Cargas ciertas = 0.27 + 0.015 + 1/12 + 0.0225 ≈ 39,08 %', () => {
      expect(itcs.certainCharges.toPercent()).toBeCloseTo(39.083, 2);
    });

    it('Inciertas no remunerativas = 1+1.5+0.5 = 3 %', () => {
      expect(itcs.uncertainNonRemunerative.toPercent()).toBeCloseTo(3, 3);
    });

    it('ITCS total ≈ 79,99 % (valor del Excel)', () => {
      expect(itcs.itcs.toPercent()).toBeCloseTo(79.99, 1);
    });
  });

  describe('D) Costo y tarifa por departamento', () => {
    const r = calcDirectLabor(example);

    it('aplica el ITCS sobre las remuneraciones básicas', () => {
      const d1 = r.departments[0]!;
      // 4.500.000 × (1 + 0.7999) ≈ 8.099.600
      expect(d1.totalMod.toNumber()).toBeCloseTo(8099600, -2);
      // Tarifa = total / 12000 HH
      expect(d1.hourlyRate.toNumber()).toBeCloseTo(674.97, 0);
    });

    it('costo total MOD = Σ de los tres departamentos', () => {
      // 10.500.000 (básicas) × (1 + ITCS 79,99 %) con precisión decimal exacta.
      expect(r.totalMod.toNumber()).toBeCloseTo(18898986.03, 1);
    });

    it('expone el detalle de días e ITCS', () => {
      expect(r.workingDays.effectiveWorkDays.toNumber()).toBe(221);
      expect(r.itcs.itcs.toPercent()).toBeCloseTo(79.99, 1);
    });
  });
});
