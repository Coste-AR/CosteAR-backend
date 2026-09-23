import { describe, expect, it } from 'vitest';
import { calcularPlaneamientoResultados } from '@/domain/calculations/planeamiento-resultados.js';

describe('M3-02 — planeamiento de resultados', () => {
  it('calcula el objetivo relativo sobre capital en unidades con el ejemplo de Yardín', () => {
    const resultado = calcularPlaneamientoResultados({
      modalidad: 'fisica', costosFijos: 8_000, costoVariableUnitario: 30, precioUnitario: 100, unidadCantidad: 'unidades', moneda: 'ARS',
      objetivo: { tipo: 'porcentaje_sobre_capital', tasa: 0.10, capitalFijo: 30_000, capitalPorPesoCostoVariable: 0.25 },
    });

    expect(resultado.cantidadNecesaria).toBeCloseTo(170.3971119, 7);
    expect(resultado.ventasNecesarias).toBeCloseTo(17_039.7111913, 6);
    expect(resultado.resultadoLogrado).toBeCloseTo(3_927.7978339, 6);
    expect(resultado.basadoEn).toBe('porcentaje_sobre_capital');
  });

  it('calcula el objetivo relativo sobre capital en pesos con el ejemplo de Yardín', () => {
    const resultado = calcularPlaneamientoResultados({
      modalidad: 'monetaria', costosFijos: 8_000, margenMarcacion: 0.40, moneda: 'ARS',
      objetivo: { tipo: 'porcentaje_sobre_capital', tasa: 0.10, capitalFijo: 30_000, capitalPorPesoCostoVariable: 0.25 },
    });

    expect(resultado.cantidadNecesaria).toBeNull();
    expect(resultado.ventasNecesarias).toBeCloseTo(44_053.33333, 5);
    expect(resultado.resultadoLogrado).toBeCloseTo(4_586.66667, 5);
  });

  it('mantiene el objetivo absoluto de M3-01 en las dos modalidades', () => {
    expect(calcularPlaneamientoResultados({
      modalidad: 'fisica', costosFijos: 8_000, costoVariableUnitario: 30, precioUnitario: 100, unidadCantidad: 'unidades', moneda: 'ARS',
      objetivo: { tipo: 'resultado_absoluto', importe: 3_900 },
    })).toMatchObject({ cantidadNecesaria: 170, ventasNecesarias: 17_000, resultadoLogrado: 3_900, basadoEn: 'resultado_absoluto' });
    expect(calcularPlaneamientoResultados({
      modalidad: 'monetaria', costosFijos: 8_000, margenMarcacion: 0.40, moneda: 'ARS',
      objetivo: { tipo: 'resultado_absoluto', importe: 4_000 },
    })).toMatchObject({ cantidadNecesaria: null, ventasNecesarias: 42_000, resultadoLogrado: 4_000, basadoEn: 'resultado_absoluto' });
  });

  it('declara ausencia cuando la contribución marginal no es positiva', () => {
    expect(calcularPlaneamientoResultados({
      modalidad: 'fisica', costosFijos: 8_000, costoVariableUnitario: 100, precioUnitario: 100, unidadCantidad: 'unidades', moneda: 'ARS',
      objetivo: { tipo: 'resultado_absoluto', importe: 1_000 },
    })).toMatchObject({ cantidadNecesaria: null, ventasNecesarias: null, resultadoLogrado: null, motivo: expect.stringMatching(/contribuci.n marginal/i) });
  });
});
