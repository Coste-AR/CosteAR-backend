import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  calcWorkingDays,
  calcITCS,
  calcDepartmentHourlyRate,
  calcDirectLabor,
} from '@/domain/calculations/direct-labor.js';
import { Percentage } from '@/domain/value-objects/percentage.js';

describe('Hoja 2 — Mano de Obra Directa', () => {
  describe('calcWorkingDays', () => {
    it('descuenta no-laborables, vacaciones y ausencias', () => {
      const days = calcWorkingDays({
        totalDaysPerYear: 365,
        nonWorkingDays: 113, // 52 domingos + ~13 feriados + sábados aprox
        vacationDays: 14,
        averageAbsenceDays: 8,
      });
      expect(days.toNumber()).toBe(230);
    });
  });

  describe('calcITCS', () => {
    it('suma los componentes de cargas sociales', () => {
      const itcs = calcITCS([
        { name: 'Jubilación', percent: 16 },
        { name: 'Obra social', percent: 6 },
        { name: 'ART', percent: 5 },
        { name: 'SAC s/cargas', percent: 9 },
        { name: 'Vacaciones', percent: 6 },
      ]);
      expect(itcs.toPercent()).toBe(42);
    });
  });

  describe('calcDepartmentHourlyRate', () => {
    it('calcula la tarifa horaria integral', () => {
      const workingDays = calcWorkingDays({
        totalDaysPerYear: 365,
        nonWorkingDays: 115,
        vacationDays: 14,
        averageAbsenceDays: 6,
      }); // 230 días

      const itcs = Percentage.fromPercent(50);

      const result = calcDepartmentHourlyRate(
        { departmentName: 'Armado', workers: 5, monthlyWage: 400000, hoursPerDay: 8 },
        workingDays,
        itcs,
      );

      // Nominal anual: 400000 × 13 × 5 = 26.000.000
      expect(result.annualNominalCost.toNumber()).toBe(26000000);
      // Integral: 26.000.000 × 1.5 = 39.000.000
      expect(result.annualIntegralCost.toNumber()).toBe(39000000);
      // Horas productivas: 230 × 8 × 5 = 9200
      expect(result.productiveHours.toNumber()).toBe(9200);
      // Tarifa: 39.000.000 / 9200 = 4239.13
      expect(result.hourlyRate.toFixed(2)).toBe('4239.13');
    });

    it('lanza error si las horas productivas son cero', () => {
      expect(() =>
        calcDepartmentHourlyRate(
          { departmentName: 'X', workers: 0, monthlyWage: 100, hoursPerDay: 8 },
          new Decimal(230),
          Percentage.fromPercent(50),
        ),
      ).toThrow(/división por cero/);
    });
  });

  describe('calcDirectLabor integral', () => {
    it('suma el costo integral de todos los departamentos', () => {
      const result = calcDirectLabor(
        { totalDaysPerYear: 365, nonWorkingDays: 115, vacationDays: 14, averageAbsenceDays: 6 },
        [{ name: 'Cargas', percent: 50 }],
        [
          { departmentName: 'Armado', workers: 5, monthlyWage: 400000, hoursPerDay: 8 },
          { departmentName: 'Pintura', workers: 3, monthlyWage: 350000, hoursPerDay: 8 },
        ],
      );

      // Armado integral: 39.000.000
      // Pintura nominal: 350000 × 13 × 3 = 13.650.000 × 1.5 = 20.475.000
      expect(result.totalIntegralCost.toNumber()).toBe(59475000);
      expect(result.workingDays.toNumber()).toBe(230);
      expect(result.itcs.toPercent()).toBe(50);
    });
  });
});
