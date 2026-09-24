import { describe, expect, it } from 'vitest';
import { puntoIndiferencia } from '@/domain/calculations/punto-indiferencia.js';

describe('M6-01 — punto de indiferencia', () => {
  it('AM-04 compara dos estructuras con la misma función y ubica el cruce en 4.000 unidades', () => {
    const resultado = puntoIndiferencia({
      tipoDecision: 'comparar_estructuras',
      estructuraA: { nombre: 'alta tecnología', costosFijos: 300_000, costoVariableUnitario: 100 },
      estructuraB: { nombre: 'baja tecnología', costosFijos: 100_000, costoVariableUnitario: 150 },
      unidadCantidad: 'unidades',
      moneda: 'ARS',
    });

    expect(resultado).toEqual({
      cantidadIndiferencia: 4_000,
      costoEnElPunto: 700_000,
      convieneA: { desde: 4_000, hasta: null },
      convieneB: { desde: 0, hasta: 4_000 },
      motivoSinPunto: null,
      criterio: 'costos_totales',
      unidades: { cantidad: 'unidades', costo: 'ARS' },
    });
  });

  it('AM-04b aplica R25 con fijo evitable y materiales a precio de liquidación', () => {
    const resultado = puntoIndiferencia({
      tipoDecision: 'dejar_de_fabricar',
      estructuraA: {
        nombre: 'fabricar', costosFijos: 300_000, costosFijosEvitables: 180_000,
        costoVariableUnitario: 125, costoVariableUnitarioLiquidacion: 100,
      },
      estructuraB: { nombre: 'comprar', costosFijos: 100_000, costoVariableUnitario: 150 },
      unidadCantidad: 'unidades',
      moneda: 'ARS',
    });

    expect(resultado.cantidadIndiferencia).toBe(1_600);
    expect(resultado.costoEnElPunto).toBe(340_000);
    expect(resultado.criterio).toBe('r25_fijo_evitable_y_liquidacion');
  });

  it('declara ausencia cuando los costos variables son iguales, sin infinito ni división por cero', () => {
    const resultado = puntoIndiferencia({
      tipoDecision: 'comparar_estructuras',
      estructuraA: { nombre: 'A', costosFijos: 300_000, costoVariableUnitario: 100 },
      estructuraB: { nombre: 'B', costosFijos: 100_000, costoVariableUnitario: 100 },
      unidadCantidad: 'unidades',
      moneda: 'ARS',
    });

    expect(resultado).toMatchObject({
      cantidadIndiferencia: null,
      costoEnElPunto: null,
      convieneA: null,
      convieneB: { desde: 0, hasta: null },
      motivoSinPunto: expect.stringMatching(/mismo costo variable.*B conviene/i),
    });
    expect(JSON.stringify(resultado)).not.toMatch(/Infinity|NaN/);
  });
});
