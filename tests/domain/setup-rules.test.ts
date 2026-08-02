import { describe, it, expect } from 'vitest';
import { validateSetup, setupWarnings } from '@/domain/periods/setup-rules.js';

/**
 * El setup previo es la única barrera entre "la IA adivina a qué departamento va
 * cada factura" y "la IA lo sabe". Estas reglas definen qué se acepta como mapa
 * productivo válido, y —tan importante como eso— qué se avisa sin bloquear.
 */

const dep = (name: string, sequence: number) => ({ name, sequence });
const base = { departments: [dep('Molienda', 1), dep('Cocción', 2)], hasJointProducts: false };

describe('Qué impide sellar el setup', () => {
  it('un mapa correcto no tiene problemas', () => {
    expect(validateSetup(base)).toEqual([]);
  });

  it('sin departamentos no se puede: la IA no tendría a dónde adjudicar', () => {
    const problems = validateSetup({ ...base, departments: [] });
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toMatch(/adjudicar los costos/);
  });

  it('dos departamentos con el mismo nombre son ambiguos', () => {
    const problems = validateSetup({
      ...base,
      departments: [dep('Molienda', 1), dep('molienda', 2)],
    });
    // Sin distinguir mayúsculas: para el que carga un documento son el mismo.
    expect(problems.some((p) => /mismo nombre/.test(p.message))).toBe(true);
  });

  it('un departamento sin nombre no se puede identificar después', () => {
    const problems = validateSetup({ ...base, departments: [dep('  ', 1)] });
    expect(problems.some((p) => /sin nombre/.test(p.message))).toBe(true);
  });

  it('la secuencia con huecos rompe el "recibidas del departamento anterior"', () => {
    const problems = validateSetup({
      ...base,
      departments: [dep('Molienda', 1), dep('Cocción', 3)],
    });
    expect(problems.some((p) => /sin saltos/.test(p.message))).toBe(true);
  });

  it('la secuencia repetida también', () => {
    const problems = validateSetup({
      ...base,
      departments: [dep('Molienda', 1), dep('Cocción', 1)],
    });
    expect(problems.some((p) => /sin saltos/.test(p.message))).toBe(true);
  });

  it('la secuencia tiene que arrancar en 1', () => {
    const problems = validateSetup({
      ...base,
      departments: [dep('Molienda', 2), dep('Cocción', 3)],
    });
    expect(problems.some((p) => /desde 1/.test(p.message))).toBe(true);
  });

  it('una frecuencia de recuento absurda se rechaza', () => {
    expect(validateSetup({ ...base, wipCountFrequencyDays: 0 })).toHaveLength(1);
    expect(validateSetup({ ...base, wipCountFrequencyDays: 400 })).toHaveLength(1);
    expect(validateSetup({ ...base, wipCountFrequencyDays: 7.5 })).toHaveLength(1);
    // No declararla es válido: no todo el mundo lo sabe al momento del setup.
    expect(validateSetup({ ...base, wipCountFrequencyDays: null })).toEqual([]);
  });
});

describe('Lo que se avisa pero NO se bloquea', () => {
  it('costear más seguido de lo que la planta cuenta', () => {
    // El caso del ingenio al revés: ciclos de 3 días con recuento cada 15.
    const warnings = setupWarnings({ ...base, periodLengthDays: 3, wipCountFrequencyDays: 15 });

    const aviso = warnings.find((w) => w.field === 'wipCountFrequencyDays');
    expect(aviso).toBeDefined();
    expect(aviso!.message).toMatch(/provisorios/);
    // No bloquea: puede haber razones que no previmos, y dejar al costista sin
    // salida es peor que avisarle.
    expect(validateSetup({ ...base, periodLengthDays: 3, wipCountFrequencyDays: 15 })).toEqual([]);
  });

  it('no avisa cuando el recuento acompaña al ritmo de costeo', () => {
    const warnings = setupWarnings({ ...base, periodLengthDays: 30, wipCountFrequencyDays: 15 });
    expect(warnings.some((w) => w.field === 'wipCountFrequencyDays')).toBe(false);
  });

  it('un solo departamento se avisa: agregarlos después es caro', () => {
    const warnings = setupWarnings({ ...base, departments: [dep('Único', 1)] });
    expect(warnings.some((w) => /recargar los cuadros/.test(w.message))).toBe(true);
  });

  it('con coproductos avisa lo que va a tener que definir después', () => {
    const warnings = setupWarnings({ ...base, hasJointProducts: true });
    expect(warnings.some((w) => /punto de separación/.test(w.message))).toBe(true);
  });

  it('un setup común y corriente no genera ruido', () => {
    expect(setupWarnings({ ...base, periodLengthDays: null, wipCountFrequencyDays: null })).toEqual([]);
  });
});
