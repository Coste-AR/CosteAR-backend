import { describe, it, expect } from 'vitest';
import { effectiveRhythm, companyRhythm } from '@/domain/periods/effective-rhythm.js';
import { IncompleteRhythmError, codeFromDate } from '@/domain/periods/period-calendar.js';

/**
 * Qué ritmo usa una estructura cuando la empresa dice una cosa y la estructura
 * otra. Es una decisión chiquita pero se toma en varios lugares del sistema: si
 * dos de ellos la resuelven distinto, la misma estructura termina con dos
 * calendarios de períodos.
 */
const sinOverride = { periodicity: null, periodLengthDays: null, periodAnchorDate: null };

describe('Ritmo efectivo de una estructura', () => {
  it('sin override, hereda el ritmo de la empresa', () => {
    expect(effectiveRhythm(sinOverride, 'MONTHLY')).toBe('MONTHLY');
    expect(effectiveRhythm(sinOverride, 'BIWEEKLY')).toBe('BIWEEKLY');
    expect(effectiveRhythm(sinOverride, 'QUARTERLY')).toBe('QUARTERLY');
  });

  it('el ritmo de la estructura le gana al de la empresa', () => {
    const estructura = { ...sinOverride, periodicity: 'BIWEEKLY' };
    expect(effectiveRhythm(estructura, 'MONTHLY')).toBe('BIWEEKLY');
  });

  it('con ciclos de días fijos devuelve largo y ancla, listos para el calendario', () => {
    const ancla = new Date('2026-08-05T00:00:00Z');
    const ritmo = effectiveRhythm(
      { periodicity: 'CUSTOM_DAYS', periodLengthDays: 10, periodAnchorDate: ancla },
      'MONTHLY',
    );

    expect(ritmo).toEqual({ kind: 'CUSTOM_DAYS', lengthDays: 10, anchorDate: ancla });
    // Y sirve tal cual contra el calendario, sin adaptadores en el medio.
    expect(codeFromDate(new Date('2026-08-17T00:00:00Z'), ritmo)).toBe('2026-08-15');
  });

  it('si dice "ciclos de días" pero le falta el largo o el ancla, avisa', () => {
    // No cae a mensual en silencio: eso le cambiaría los períodos al costista
    // sin que nadie se entere.
    expect(() =>
      effectiveRhythm(
        { periodicity: 'CUSTOM_DAYS', periodLengthDays: 10, periodAnchorDate: null },
        'MONTHLY',
      ),
    ).toThrow(IncompleteRhythmError);

    expect(() =>
      effectiveRhythm(
        {
          periodicity: 'CUSTOM_DAYS',
          periodLengthDays: null,
          periodAnchorDate: new Date('2026-08-05T00:00:00Z'),
        },
        'MONTHLY',
      ),
    ).toThrow(IncompleteRhythmError);
  });
});

describe('Ritmo de la empresa', () => {
  it('devuelve los tres ritmos de calendario tal cual', () => {
    expect(companyRhythm('MONTHLY')).toBe('MONTHLY');
    expect(companyRhythm('QUARTERLY')).toBe('QUARTERLY');
  });

  it('rechaza ciclos de días fijos a nivel empresa', () => {
    // El enum de Postgres es uno solo y los admite; largo y ancla, en cambio,
    // viven en la estructura. Una empresa marcada así no define ningún período.
    expect(() => companyRhythm('CUSTOM_DAYS')).toThrow(IncompleteRhythmError);
  });
});
