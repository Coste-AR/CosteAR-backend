import { describe, expect, it } from 'vitest';
import { separarTramoSemifijo } from '@/domain/calculations/tramo-semifijo.js';

describe('M1-02 — separación de un costo semifijo', () => {
  it('rojo antes que verde: rechaza una declaración cuyas porciones no suman el importe', () => {
    expect(() => separarTramoSemifijo({
      importe: 90000,
      metodo: 'DECLARADO',
      porcionFija: 54000,
      porcionVariable: 35000,
    })).toThrow(/no se ajusta en silencio/i);
  });

  it('acepta la declaración 54.000 fija + 36.000 variable sobre 90.000', () => {
    expect(separarTramoSemifijo({
      importe: 90000,
      metodo: 'DECLARADO',
      porcionFija: 54000,
      porcionVariable: 36000,
    })).toMatchObject({ porcionFija: 54000, porcionVariable: 36000 });
  });

  it('PUNTOS_EXTREMOS calcula pendiente, fijo y variable antes de guardar', () => {
    const resultado = separarTramoSemifijo({
      importe: 90000,
      metodo: 'PUNTOS_EXTREMOS',
      observacionesBase: [
        { volumen: 100, importe: 60000 },
        { volumen: 200, importe: 90000 },
      ],
    });
    expect(resultado).toMatchObject({
      porcionFija: 30000,
      porcionVariable: 60000,
      costoVariableUnitario: 300,
    });
  });

  it('CORRELACION conserva los pares y expone la confiabilidad del ajuste', () => {
    const resultado = separarTramoSemifijo({
      importe: 70000,
      metodo: 'CORRELACION',
      observacionesBase: [
        { volumen: 100, importe: 30000 },
        { volumen: 200, importe: 50000 },
        { volumen: 300, importe: 70000 },
      ],
    });
    expect(resultado).toMatchObject({
      porcionFija: 10000,
      porcionVariable: 60000,
      costoVariableUnitario: 200,
      coeficienteCorrelacion: 1,
    });
    expect(resultado.observacionesBase).toHaveLength(3);
  });

  it('DISPERSION_GRAFICA conserva observaciones y exige la separación elegida por la persona', () => {
    const observacionesBase = [{ volumen: 10, importe: 50 }, { volumen: 20, importe: 70 }];
    expect(separarTramoSemifijo({
      importe: 70,
      metodo: 'DISPERSION_GRAFICA',
      observacionesBase,
      porcionFija: 30,
      porcionVariable: 40,
    })).toMatchObject({ observacionesBase, porcionFija: 30, porcionVariable: 40 });
  });
});
