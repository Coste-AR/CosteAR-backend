import { describe, expect, it } from 'vitest';
import { calcularMezclaOptima } from '@/domain/calculations/mezcla-optima.js';

describe('M8-01 — mezcla óptima con un recurso escaso', () => {
  it('AM-06 prioriza la contribución por unidad del recurso y obtiene 140.000', () => {
    const resultado = calcularMezclaOptima({
      disponible: 1_000,
      unidadRecurso: 'horas máquina',
      productos: [
        { id: 'x', producto: 'X', cm: 300, consumoPorUnidad: 3, demandaMaxima: 200 },
        { id: 'y', producto: 'Y', cm: 200, consumoPorUnidad: 1, demandaMaxima: 400 },
        { id: 'z', producto: 'Z', cm: 400, consumoPorUnidad: 8, demandaMaxima: 100 },
      ],
    });

    expect(resultado.contribucionMarginalTotal).toBe(140_000);
    expect(resultado.ranking.map(({ producto, cme, cantidadAsignada }) => ({ producto, cme, cantidadAsignada }))).toEqual([
      { producto: 'Y', cme: 200, cantidadAsignada: 400 },
      { producto: 'X', cme: 100, cantidadAsignada: 200 },
      { producto: 'Z', cme: 50, cantidadAsignada: 0 },
    ]);
    expect(resultado.recursoRestante).toBe(0);
  });

  it('elimina en cascada productos sin consumo o demanda aprovechable', () => {
    const resultado = calcularMezclaOptima({
      disponible: 10,
      unidadRecurso: 'kg',
      productos: [
        { id: 'a', producto: 'A', cm: 10, consumoPorUnidad: 0, demandaMaxima: 5 },
        { id: 'b', producto: 'B', cm: -2, consumoPorUnidad: 1, demandaMaxima: 5 },
      ],
    });

    expect(resultado.ranking).toEqual([]);
    expect(resultado.contribucionMarginalTotal).toBe(0);
    expect(resultado.recursoRestante).toBe(10);
  });
});
