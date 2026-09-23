import { describe, expect, it } from 'vitest';
import { calcularCapacidadOciosa } from '../../src/domain/calculations/capacidad-ociosa.js';

describe('AM-05 — capacidad ociosa', () => {
  it('R22 informa 25.600 y las dos vías cierran sin sumar MOD con CIP', () => {
    const resultado = calcularCapacidadOciosa({
      capacidadNormal: 1_000, actividadReal: 900, contribucionMarginalUnitaria: 256,
      centrosCip: [{ budgetVariance: 1_200, volumeVariance: 4_800, overUnderApplied: -6_000 }],
    });
    expect(resultado.ociosidadR22.valor).toBe(25_600);
    expect(resultado.cip.variacionVolumen).toBe(4_800);
    expect(resultado.cip.controlDosVias).toMatchObject({ cierra: true, diferencia: 0 });
    expect(resultado).not.toHaveProperty('ociosidadTotal');
  });

  it('camino rojo: las tres vías quedan bloqueadas y explican la base estándar faltante', () => {
    const resultado = calcularCapacidadOciosa({
      capacidadNormal: 1_000, actividadReal: 900, contribucionMarginalUnitaria: 256, centrosCip: [],
    });
    expect(resultado.tresVias.bloqueada).toBe(true);
    expect(resultado.tresVias.motivo).toMatch(/base estándar.*O1-02/i);
    expect(resultado.tresVias).not.toHaveProperty('eficiencia');
  });
});
