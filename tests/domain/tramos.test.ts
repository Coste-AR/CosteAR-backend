import { describe, expect, it } from 'vitest';
import { calcularEquilibrioPorTramos } from '@/domain/calculations/tramos.js';

describe('M10-01 — equilibrio por tramos (AM-09)', () => {
  it('declara inexistente el PE actual y encuentra el equilibrio operativo siguiente', () => {
    const resultado = calcularEquilibrioPorTramos([
      { id: 'actual', desde: 0, hasta: 475.7, tipo: 'REEMPLAZA', importeFijo: 1_780_000, cmUnitaria: 2_974, techoFisico: 475.7 },
      { id: 'nuevo', desde: 475.7, hasta: 950.9, tipo: 'REEMPLAZA', importeFijo: 2_600_000, cmUnitaria: 2_974, techoFisico: 950.9 },
    ]);

    expect(resultado.tramos[0]).toMatchObject({ q: null, resultadoMaximo: -365268.2 });
    expect(resultado.tramos[0]?.qAritmetico).toBeCloseTo(598.52, 2);
    expect(resultado.tramos[0]?.motivoFueraDeTramo).toContain('techo');
    expect(resultado.tramos[1]?.q).toBeCloseTo(874.24, 2);
    expect(resultado.tramos[1]?.resultadoMaximo).toBe(227976.6);
    expect(resultado.transiciones[0]?.qIndiferencia).toBeCloseTo(751.42, 2);
    expect(resultado.transiciones[0]?.binding).toBeCloseTo(874.24, 2);
    expect(resultado.transiciones[0]?.alertaPegadoAlTecho).toBe(true);
    expect(resultado.transiciones[0]?.margenHastaTecho).toBeCloseTo(76.66, 2);
    expect(resultado.transiciones[0]?.porcentajeMargen).toBeCloseTo(8.1, 1);
  });

  it('ACUMULA conserva la contribución lograda en escalones anteriores', () => {
    const resultado = calcularEquilibrioPorTramos([
      { id: 'uno', desde: 0, hasta: 100, tipo: 'ACUMULA', importeFijo: 1_000, cmUnitaria: 5, techoFisico: 100 },
      { id: 'dos', desde: 100, hasta: 300, tipo: 'ACUMULA', importeFijo: 1_500, cmUnitaria: 10, techoFisico: 300 },
    ]);
    expect(resultado.tramos[1]?.qAritmetico).toBe(200);
  });

  it('sin techo declarado conserva un rango infinito', () => {
    const resultado = calcularEquilibrioPorTramos([
      { id: 'legacy', desde: 0, hasta: null, tipo: 'REEMPLAZA', importeFijo: 192_000, cmUnitaria: 256, techoFisico: null },
    ]);
    expect(resultado.tramos[0]).toMatchObject({ q: 750, qAritmetico: 750, techo: null });
  });
});
