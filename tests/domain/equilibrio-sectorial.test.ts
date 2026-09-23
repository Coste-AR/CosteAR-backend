import { describe, expect, it } from 'vitest';
import { calcularEquilibrioSectorial } from '../../src/domain/calculations/equilibrio-sectorial.js';

describe('equilibrio sectorial y específico', () => {
  it('reproduce AM-02 y las contribuciones netas cubren los indirectos', () => {
    const resultado = calcularEquilibrioSectorial([
      { id: 'a', nombre: 'A', participacion: 0.2, precioUnitario: 100, costoVariableUnitario: 60, costoFijoDirecto: 20_000, prorrateoIndirectos: 2_400 },
      { id: 'b', nombre: 'B', participacion: 0.3, precioUnitario: 60, costoVariableUnitario: 40, costoFijoDirecto: 6_000, prorrateoIndirectos: 3_600 },
      { id: 'c', nombre: 'C', participacion: 0.5, precioUnitario: 40, costoVariableUnitario: 28, costoFijoDirecto: 2_000, prorrateoIndirectos: 6_000 },
    ]);

    expect(resultado.equilibrioGeneral).toBe(2_000);
    expect(resultado.segmentos.map((s) => s.equilibrioEspecifico)).toEqual([500, 300, 166.66666666666666]);
    expect(resultado.segmentos.map((s) => s.contribucionNeta)).toEqual([-4_000, 6_000, 10_000]);
    expect(resultado.controlIndirectos).toEqual({ indirectos: 12_000, contribucionesNetas: 12_000, diferencia: 0 });
    expect(resultado.segmentos.every((s) => s.vistaConProrrateo.doctrinaria === false)).toBe(true);
  });

  it('pondera coproductos, incluido un desecho con precio negativo', () => {
    const resultado = calcularEquilibrioSectorial([
      {
        id: 'conjunta', nombre: 'Producción conjunta', participacion: 1,
        precioUnitario: null, costoVariableUnitario: null, costoFijoDirecto: 90,
        prorrateoIndirectos: 0, produccionConjunta: true,
        coproductos: [
          { nombre: 'Principal', precio: 120, rendimiento: 0.9 },
          { nombre: 'Desecho', precio: -20, rendimiento: 0.1 },
        ],
      },
    ]);
    expect(resultado.segmentos[0]?.contribucionMarginalUnitaria).toBe(106);
  });
});
