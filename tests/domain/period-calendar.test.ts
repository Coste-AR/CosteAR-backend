import { describe, it, expect } from 'vitest';
import {
  periodBounds,
  nextPeriodCode,
  codeFromDate,
  normalizeLegacyCode,
  InvalidPeriodCodeError,
  IncompleteRhythmError,
  type CustomDaysRhythm,
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

describe('Períodos de CICLOS DE DÍAS FIJOS (cada 10 o 15 días)', () => {
  // Ancla: la empresa arrancó a costear el 5 de agosto de 2026.
  const cada10: CustomDaysRhythm = {
    kind: 'CUSTOM_DAYS',
    lengthDays: 10,
    anchorDate: new Date('2026-08-05T00:00:00Z'),
  };
  const cada15: CustomDaysRhythm = {
    kind: 'CUSTOM_DAYS',
    lengthDays: 15,
    anchorDate: new Date('2026-08-05T00:00:00Z'),
  };

  it('un ciclo de 10 días arranca en el ancla y dura 10 días (no 11)', () => {
    const c = periodBounds('2026-08-05', cada10);
    expect(iso(c.startDate)).toBe('2026-08-05');
    expect(iso(c.endDate)).toBe('2026-08-14');
    expect(c.label).toBe('5 al 14 de agosto de 2026');
  });

  it('los ciclos son contiguos: no se reinician con el mes ni dejan huecos', () => {
    expect(nextPeriodCode('2026-08-05', cada10)).toBe('2026-08-15');
    expect(nextPeriodCode('2026-08-15', cada10)).toBe('2026-08-25');
    // Acá se cruza el fin de mes: el ciclo sigue de largo, no corta el 31.
    expect(nextPeriodCode('2026-08-25', cada10)).toBe('2026-09-04');

    const cruzaMes = periodBounds('2026-08-25', cada10);
    expect(iso(cruzaMes.endDate)).toBe('2026-09-03');
    expect(cruzaMes.label).toBe('25 de agosto al 3 de septiembre de 2026');
  });

  it('cruza el fin de año sin romperse', () => {
    // 5/8 + 15×10 días = 2/1/2027.
    expect(periodBounds('2026-12-23', cada10).code).toBe('2026-12-23');
    expect(nextPeriodCode('2026-12-23', cada10)).toBe('2027-01-02');
    expect(periodBounds('2026-12-23', cada10).label).toBe(
      '23 de diciembre de 2026 al 1 de enero de 2027',
    );
  });

  it('un ciclo de 15 días no es lo mismo que una quincena de calendario', () => {
    const c = periodBounds('2026-08-05', cada15);
    expect(iso(c.endDate)).toBe('2026-08-19');
    expect(nextPeriodCode('2026-08-05', cada15)).toBe('2026-08-20');
  });

  it('un documento cae en el ciclo que contiene su fecha', () => {
    expect(codeFromDate(new Date('2026-08-05T00:00:00Z'), cada10)).toBe('2026-08-05');
    expect(codeFromDate(new Date('2026-08-14T23:59:59Z'), cada10)).toBe('2026-08-05');
    expect(codeFromDate(new Date('2026-08-15T00:00:00Z'), cada10)).toBe('2026-08-15');
  });

  it('un documento ANTERIOR al ancla cae en el ciclo previo, no en el primero', () => {
    // Una factura atrasada de antes de que la empresa empezara a costear así.
    expect(codeFromDate(new Date('2026-08-04T00:00:00Z'), cada10)).toBe('2026-07-26');
    expect(codeFromDate(new Date('2026-07-26T00:00:00Z'), cada10)).toBe('2026-07-26');
    expect(codeFromDate(new Date('2026-07-25T00:00:00Z'), cada10)).toBe('2026-07-16');
  });

  it('el orden alfabético sigue siendo el orden cronológico', () => {
    const ciclos = ['2026-09-04', '2026-08-05', '2027-01-02', '2026-08-25'];
    expect([...ciclos].sort()).toEqual([
      '2026-08-05',
      '2026-08-25',
      '2026-09-04',
      '2027-01-02',
    ]);
  });

  it('el mes viejo se traduce al ciclo que contiene su primer día', () => {
    expect(normalizeLegacyCode('2026-09', cada10)).toBe('2026-08-25');
    expect(normalizeLegacyCode('2026-08-15', cada10)).toBe('2026-08-15');
  });

  it('un día suelto que no arranca un ciclo NO es un período', () => {
    // El 6/8 cae dentro del ciclo del 5/8, pero no lo empieza.
    expect(() => periodBounds('2026-08-06', cada10)).toThrow(InvalidPeriodCodeError);
    expect(() => periodBounds('2026-08-32', cada10)).toThrow(InvalidPeriodCodeError);
    expect(() => periodBounds('2026-02-30', cada10)).toThrow(InvalidPeriodCodeError);
    // Un código mensual no sirve para una empresa que costea por ciclos.
    expect(() => periodBounds('2026-08', cada10)).toThrow(InvalidPeriodCodeError);
  });

  it('avisa si la estructura dice "ciclos de días" pero no dice de cuántos', () => {
    expect(() => periodBounds('2026-08-05', 'CUSTOM_DAYS')).toThrow(IncompleteRhythmError);
    expect(() => codeFromDate(new Date(), 'CUSTOM_DAYS')).toThrow(IncompleteRhythmError);
    expect(() =>
      periodBounds('2026-08-05', { ...cada10, lengthDays: 0 }),
    ).toThrow(IncompleteRhythmError);
    expect(() =>
      periodBounds('2026-08-05', { ...cada10, lengthDays: 7.5 }),
    ).toThrow(IncompleteRhythmError);
    expect(() =>
      periodBounds('2026-08-05', { ...cada10, anchorDate: new Date('no es fecha') }),
    ).toThrow(IncompleteRhythmError);
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
