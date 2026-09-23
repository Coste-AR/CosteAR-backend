import { describe, expect, it } from 'vitest';
import { calcularRelacionReemplazo } from '@/domain/calculations/relacion-reemplazo.js';

describe('M5-01 — relaciones de reemplazo', () => {
  it('AM-03 devuelve la relación, la compensación y ambos horizontes', () => {
    const resultado = calcularRelacionReemplazo({
      contribucionMarginalOrigen: 40,
      contribucionMarginalDestino: 20,
      cantidadOrigen: 50,
      costoFijoDirectoOrigen: 20_000,
      costoFijoDirectoDestino: 6_000,
      costosFijosIndirectos: 12_000,
      resultadoObjetivo: 0,
      unidadCantidad: 'unidades',
    });

    expect(resultado).toEqual({
      relacionReemplazo: 2,
      cantidadOrigen: 50,
      cantidadDestino: 100,
      resultadoCortoPlazo: 1_900,
      resultadoLargoPlazo: 900,
      unidades: {
        cantidadOrigen: 'unidades',
        cantidadDestino: 'unidades',
        resultadoCortoPlazo: 'unidades',
        resultadoLargoPlazo: 'unidades',
      },
    });
  });

  it('declara ausencia cuando la contribución del destino no es positiva', () => {
    const resultado = calcularRelacionReemplazo({
      contribucionMarginalOrigen: 40,
      contribucionMarginalDestino: 0,
      cantidadOrigen: 50,
      costoFijoDirectoOrigen: 20_000,
      costoFijoDirectoDestino: 6_000,
      costosFijosIndirectos: 12_000,
      resultadoObjetivo: 0,
      unidadCantidad: 'unidades',
    });

    expect(resultado).toMatchObject({
      relacionReemplazo: null,
      cantidadDestino: null,
      resultadoCortoPlazo: null,
      resultadoLargoPlazo: null,
      motivo: expect.stringMatching(/destino.*positiva/i),
    });
    expect(JSON.stringify(resultado)).not.toMatch(/Infinity|NaN/);
  });
});
