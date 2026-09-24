import { describe, expect, it } from 'vitest';
import { calcularEstadoResultadosVariable } from '@/domain/calculations/estado-resultados-variable.js';

describe('estado de resultados variable en cascada — M3-04', () => {
  it('AM-12: separa los tres niveles sin prorratear fijos indirectos en las líneas', () => {
    const resultado = calcularEstadoResultadosVariable({
      segmentos: [
        {
          id: 'a', etiqueta: 'Línea A', ventas: 100000,
          costoVariableProduccionVendido: 70000,
          costoVariableComercializacion: 14000,
          costosFijosDirectos: [{ id: 'afd', etiqueta: 'Fijo directo A', importe: 20000, evitable: false }],
        },
        {
          id: 'b', etiqueta: 'Línea B', ventas: 50000,
          costoVariableProduccionVendido: 30000,
          costoVariableComercializacion: 8000,
          costosFijosDirectos: [{ id: 'bfd', etiqueta: 'Fijo directo B', importe: 6000, evitable: true }],
        },
        {
          id: 'c', etiqueta: 'Línea C', ventas: 60000,
          costoVariableProduccionVendido: 40000,
          costoVariableComercializacion: 8000,
          costosFijosDirectos: [{ id: 'cfd', etiqueta: 'Fijo directo C', importe: 2000, evitable: true }],
        },
      ],
      costosFijosIndirectos: [
        { id: 'fie', etiqueta: 'Indirectos evitables', importe: 4000, evitable: true },
        { id: 'fii', etiqueta: 'Indirectos inevitables', importe: 8000, evitable: false },
      ],
    });

    expect(resultado.totales).toMatchObject({
      contribucionMarginalNivel1: 40000,
      costosFijosDirectos: 28000,
      contribucionMarginalNivel2: 12000,
      costosFijosIndirectosEvitables: 4000,
      contribucionMarginalNivel3: 8000,
      costosFijosIndirectosInevitables: 8000,
      resultado: 0,
    });
    expect(resultado.segmentos.map((segmento) => ({
      id: segmento.id,
      nivel1: segmento.contribucionMarginalNivel1,
      nivel2: segmento.contribucionDespuesDeFijosDirectos,
    }))).toEqual([
      { id: 'a', nivel1: 16000, nivel2: -4000 },
      { id: 'b', nivel1: 12000, nivel2: 6000 },
      { id: 'c', nivel1: 12000, nivel2: 10000 },
    ]);

    for (const fila of resultado.filasCostosFijosIndirectos) {
      expect(Object.values(fila.columnasSegmentos)).toEqual([null, null, null]);
      expect(fila.total).toBe(fila.id === 'fie' ? 4000 : 8000);
    }
    expect(resultado.segmentos.find((segmento) => segmento.id === 'a')?.decisionCierre).toMatchObject({
      cerrar: false,
      motivo: expect.stringMatching(/no significa que haya que cerrar/i),
    });
  });

  it('valúa la existencia final sólo al costo variable de producción', () => {
    const resultado = calcularEstadoResultadosVariable({
      segmentos: [{
        id: 'producto', etiqueta: 'Producto', ventas: 400000,
        costoVariableProduccionVendido: 171200,
        costoVariableComercializacion: 24000,
        existenciaFinal: {
          unidades: 200,
          costoVariableProduccionUnitario: 214,
        },
        costosFijosDirectos: [],
      }],
      costosFijosIndirectos: [],
    });

    expect(resultado.segmentos[0]?.existenciaFinal).toEqual({
      unidades: 200,
      costoVariableProduccionUnitario: 214,
      valor: 42800,
    });
    expect(resultado.segmentos[0]?.existenciaFinal?.valor).not.toBe(48800);
  });

  it('encadena N niveles: cada fijo directo se resta donde es directo, sin bajar a sus hijos', () => {
    const resultado = calcularEstadoResultadosVariable({
      segmentos: [
        {
          id: 'linea-a', etiqueta: 'Línea A', padreId: 'sector-1', ventas: 30000,
          costoVariableProduccionVendido: 10000, costoVariableComercializacion: 2000,
          costosFijosDirectos: [{ id: 'fa', etiqueta: 'Fijo A', importe: 3000, evitable: true }],
        },
        {
          id: 'linea-b', etiqueta: 'Línea B', padreId: 'sector-1', ventas: 20000,
          costoVariableProduccionVendido: 10000, costoVariableComercializacion: 1000,
          costosFijosDirectos: [],
        },
        {
          id: 'sector-1', etiqueta: 'Sector 1',
          ventas: 0, costoVariableProduccionVendido: 0, costoVariableComercializacion: 0,
          costosFijosDirectos: [{ id: 'fs', etiqueta: 'Fijo directo del sector', importe: 4000, evitable: false }],
        },
      ],
      costosFijosIndirectos: [],
    });

    const sector = resultado.segmentos.find((segmento) => segmento.id === 'sector-1');
    expect(sector).toMatchObject({
      profundidad: 0,
      contribucionMarginalNivel1: 27000,
      costosFijosDirectos: 4000,
      contribucionDespuesDeFijosDirectos: 20000,
    });
    expect(resultado.segmentos.find((segmento) => segmento.id === 'linea-a')).toMatchObject({
      profundidad: 1,
      contribucionMarginalNivel1: 18000,
      costosFijosDirectos: 3000,
      contribucionDespuesDeFijosDirectos: 15000,
    });
    expect(resultado.totales.contribucionMarginalNivel2).toBe(20000);
  });
});
