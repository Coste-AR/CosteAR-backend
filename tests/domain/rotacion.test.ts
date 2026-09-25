import { describe, expect, it } from 'vitest';
import { rankingRotacion } from '@/domain/calculations/rotacion.js';
import fixture from '../fixtures/analisis-marginal/AM-13.json';

describe('AM-13 — rotación y ranking de comercio (R32)', () => {
  const productos = fixture.input.map((fila) => ({ ...fila, rotacionOrigen: fila.rotacionOrigen as 'DECLARADA' }));

  it('ordena por cm/S = Vel × m: A le rinde el doble que B', () => {
    const ranking = rankingRotacion(productos);
    expect(ranking.map(({ producto, rendimiento }) => ({ producto, rendimiento }))).toEqual(fixture.expected);
  });

  it('permite ordenar por margen sólo como criterio explícito', () => {
    expect(rankingRotacion(productos, 'margen').map((fila) => fila.producto)).toEqual(['B', 'A']);
  });
});
