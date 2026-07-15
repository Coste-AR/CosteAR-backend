import { describe, it, expect } from 'vitest';
import {
  periodBounds,
  nextPeriodCode,
  codeFromDate,
  normalizeLegacyCode,
  InvalidPeriodCodeError,
} from '@/domain/periods/period-calendar.js';

/**
 * C — Fase 1. El calendario de períodos: qué mes viene después de cuál, entre
 * qué fechas vive cada período, y a qué período pertenece un documento según su
 * fecha. Es lógica pura, y de acá cuelga todo el modelo de períodos.
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('Períodos MENSUALES', () => {
  it('sabe entre qué fechas vive cada mes (incluye el largo real del mes)', () => {
    const julio = periodBounds('2026-07', 'MONTHLY');
    expect(julio.label).toBe('Julio 2026');
    expect(iso(julio.startDate)).toBe('2026-07-01');
    expect(iso(julio.endDate)).toBe('2026-07-31');

    // Febrero de un año bisiesto: 29 días, no 28.
    expect(iso(periodBounds('2028-02', 'MONTHLY').endDate)).toBe('2028-02-29');
    expect(iso(periodBounds('2026-02', 'MONTHLY').endDate)).toBe('2026-02-28');
  });

  it('el mes que sigue a diciembre es enero del año siguiente', () => {
    expect(nextPeriodCode('2026-07', 'MONTHLY')).toBe('2026-08');
    expect(nextPeriodCode('2026-12', 'MONTHLY')).toBe('2027-01');
  });

  it('un documento cae en el mes de su fecha', () => {
    expect(codeFromDate(new Date('2026-07-23T00:00:00Z'), 'MONTHLY')).toBe('2026-07');
  });
});

describe('Períodos QUINCENALES', () => {
  it('parte el mes en dos: del 1 al 15, y del 16 al último día', () => {
    const q1 = periodBounds('2026-07-Q1', 'BIWEEKLY');
    expect(q1.label).toBe('1ª quincena de Julio 2026');
    expect(iso(q1.startDate)).toBe('2026-07-01');
    expect(iso(q1.endDate)).toBe('2026-07-15');

    const q2 = periodBounds('2026-07-Q2', 'BIWEEKLY');
    expect(iso(q2.startDate)).toBe('2026-07-16');
    expect(iso(q2.endDate)).toBe('2026-07-31');

    // Febrero: la segunda quincena termina el 28 (o 29).
    expect(iso(periodBounds('2026-02-Q2', 'BIWEEKLY').endDate)).toBe('2026-02-28');
  });

  it('después de la 2ª quincena viene la 1ª del mes siguiente', () => {
    expect(nextPeriodCode('2026-07-Q1', 'BIWEEKLY')).toBe('2026-07-Q2');
    expect(nextPeriodCode('2026-07-Q2', 'BIWEEKLY')).toBe('2026-08-Q1');
    expect(nextPeriodCode('2026-12-Q2', 'BIWEEKLY')).toBe('2027-01-Q1');
  });

  it('un documento del 15 cae en la 1ª quincena; uno del 16, en la 2ª', () => {
    expect(codeFromDate(new Date('2026-07-15T00:00:00Z'), 'BIWEEKLY')).toBe('2026-07-Q1');
    expect(codeFromDate(new Date('2026-07-16T00:00:00Z'), 'BIWEEKLY')).toBe('2026-07-Q2');
  });
});

describe('Períodos TRIMESTRALES', () => {
  it('el 3er trimestre va de julio a septiembre', () => {
    const t3 = periodBounds('2026-T3', 'QUARTERLY');
    expect(t3.label).toBe('3º trimestre 2026');
    expect(iso(t3.startDate)).toBe('2026-07-01');
    expect(iso(t3.endDate)).toBe('2026-09-30');
  });

  it('después del 4º trimestre viene el 1º del año siguiente', () => {
    expect(nextPeriodCode('2026-T3', 'QUARTERLY')).toBe('2026-T4');
    expect(nextPeriodCode('2026-T4', 'QUARTERLY')).toBe('2027-T1');
  });

  it('un documento de agosto cae en el 3er trimestre', () => {
    expect(codeFromDate(new Date('2026-08-05T00:00:00Z'), 'QUARTERLY')).toBe('2026-T3');
  });
});

describe('Los códigos se ordenan solos (el último período es el mayor)', () => {
  it('orden alfabético = orden cronológico', () => {
    const mensual = ['2026-12', '2026-07', '2027-01', '2026-08'];
    expect([...mensual].sort()).toEqual(['2026-07', '2026-08', '2026-12', '2027-01']);

    const quincenal = ['2026-07-Q2', '2026-07-Q1', '2026-08-Q1'];
    expect([...quincenal].sort()).toEqual(['2026-07-Q1', '2026-07-Q2', '2026-08-Q1']);
  });
});

describe('Estructuras que vienen del modelo viejo', () => {
  it('convierte el período viejo ("2026-07") al ritmo de la empresa', () => {
    expect(normalizeLegacyCode('2026-07', 'MONTHLY')).toBe('2026-07');
    expect(normalizeLegacyCode('2026-07', 'BIWEEKLY')).toBe('2026-07-Q1');
    expect(normalizeLegacyCode('2026-08', 'QUARTERLY')).toBe('2026-T3');
  });

  it('un código que ya está en el formato nuevo no se toca', () => {
    expect(normalizeLegacyCode('2026-07-Q2', 'BIWEEKLY')).toBe('2026-07-Q2');
  });
});

describe('Códigos inválidos', () => {
  it('avisa en vez de inventar un período', () => {
    expect(() => periodBounds('julio', 'MONTHLY')).toThrow(InvalidPeriodCodeError);
    expect(() => periodBounds('2026-13', 'MONTHLY')).toThrow(InvalidPeriodCodeError);
    // Un código mensual no sirve para una empresa que costea por quincena.
    expect(() => periodBounds('2026-07', 'BIWEEKLY')).toThrow(InvalidPeriodCodeError);
  });
});
