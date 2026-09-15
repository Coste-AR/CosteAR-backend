import { describe, it, expect } from 'vitest';
import {
  resolverConceptoCosteo,
  resolverConceptosDeElemento,
  violaCausalidadDeVolumen,
  type FilaConceptoCosteo,
} from '@/domain/parametros/concepto-costeo.js';

/**
 * M1-01 (plan de análisis marginal v2) — la clasificación de costos por
 * concepto, por debajo de los tres baldes de `ParametroCosteo`.
 */

const PERIODO = 'per-1';
const ESTRUCTURA = 'str-1';

const fila = (o: Partial<FilaConceptoCosteo> & { id: string; clave: string }): FilaConceptoCosteo => ({
  descripcion: null,
  elemento: 'CIP',
  comportamientoVolumen: null,
  causaVariabilidad: null,
  erogable: null,
  horizonteErogableMeses: null,
  evitable: null,
  nivelSegmentacion: null,
  segmentoId: null,
  rangoActividadDesde: null,
  rangoActividadHasta: null,
  periodId: null,
  structureId: null,
  confirmado: false,
  clasificadoPorUserId: null,
  clasificadoEn: null,
  ...o,
});

describe('M1-01 — resolverConceptoCosteo: cascada período → estructura → empresa', () => {
  it('el período le gana a la estructura y a la empresa', () => {
    const r = resolverConceptoCosteo(
      'energia_planta',
      [
        fila({ id: 'a', clave: 'energia_planta', comportamientoVolumen: 'VARIABLE' }),
        fila({ id: 'b', clave: 'energia_planta', comportamientoVolumen: 'FIJO', structureId: ESTRUCTURA }),
        fila({
          id: 'c',
          clave: 'energia_planta',
          comportamientoVolumen: 'SEMIFIJO',
          structureId: ESTRUCTURA,
          periodId: PERIODO,
        }),
      ],
      { periodId: PERIODO, structureId: ESTRUCTURA },
    );

    expect(r?.comportamientoVolumen).toBe('SEMIFIJO');
    expect(r?.origen).toBe('periodo');
  });

  it('sin fila de período, cae a la estructura', () => {
    const r = resolverConceptoCosteo(
      'energia_planta',
      [
        fila({ id: 'a', clave: 'energia_planta', comportamientoVolumen: 'VARIABLE' }),
        fila({ id: 'b', clave: 'energia_planta', comportamientoVolumen: 'FIJO', structureId: ESTRUCTURA }),
      ],
      { periodId: PERIODO, structureId: ESTRUCTURA },
    );

    expect(r?.comportamientoVolumen).toBe('FIJO');
    expect(r?.origen).toBe('estructura');
  });

  it('sin filas cargadas para esa clave, devuelve null — no hay catálogo de defaults', () => {
    const r = resolverConceptoCosteo('energia_planta', [], { periodId: PERIODO, structureId: ESTRUCTURA });
    expect(r).toBeNull();
  });

  it('una fila de otra clave no contamina la resolución', () => {
    const r = resolverConceptoCosteo(
      'energia_planta',
      [fila({ id: 'a', clave: 'amortizacion_plantel', comportamientoVolumen: 'FIJO' })],
      {},
    );
    expect(r).toBeNull();
  });

  it('conserva los cuatro campos nuevos que la v1 no tenía', () => {
    const r = resolverConceptoCosteo(
      'amortizacion_plantel',
      [
        fila({
          id: 'a',
          clave: 'amortizacion_plantel',
          elemento: 'CIP',
          comportamientoVolumen: 'FIJO',
          causaVariabilidad: 'tiempo',
          erogable: false,
          horizonteErogableMeses: null,
          evitable: false,
          rangoActividadDesde: 0,
          rangoActividadHasta: 5000,
        }),
      ],
      {},
    );
    expect(r).toMatchObject({
      causaVariabilidad: 'tiempo',
      erogable: false,
      evitable: false,
      rangoActividadDesde: 0,
      rangoActividadHasta: 5000,
    });
  });
});

describe('M1-01 — resolverConceptosDeElemento', () => {
  it('devuelve un concepto resuelto por cada clave distinta del elemento pedido', () => {
    const filas = [
      fila({ id: 'a', clave: 'energia_planta', elemento: 'CIP', comportamientoVolumen: 'VARIABLE' }),
      fila({ id: 'b', clave: 'amortizacion_plantel', elemento: 'CIP', comportamientoVolumen: 'FIJO' }),
      fila({ id: 'c', clave: 'flete_venta', elemento: 'VENTA', comportamientoVolumen: 'VARIABLE' }),
    ];
    const r = resolverConceptosDeElemento('CIP', filas, {});
    expect(r).toHaveLength(2);
    expect(r.map((c) => c.clave).sort()).toEqual(['amortizacion_plantel', 'energia_planta']);
  });

  it('sin conceptos del elemento, devuelve vacío', () => {
    expect(resolverConceptosDeElemento('MOD', [], {})).toEqual([]);
  });
});

describe('M1-01 — violaCausalidadDeVolumen (R4/R8)', () => {
  it('VARIABLE con causa distinta de volumen viola la regla', () => {
    expect(violaCausalidadDeVolumen('VARIABLE', 'tiempo')).toBe(true);
    expect(violaCausalidadDeVolumen('VARIABLE', 'intensidad_de_uso')).toBe(true);
    expect(violaCausalidadDeVolumen('VARIABLE', 'contrato')).toBe(true);
  });

  it('VARIABLE con causa volumen no viola nada', () => {
    expect(violaCausalidadDeVolumen('VARIABLE', 'volumen')).toBe(false);
  });

  it('VARIABLE sin causa declarada no viola nada — la causa es opcional al cargar', () => {
    expect(violaCausalidadDeVolumen('VARIABLE', null)).toBe(false);
    expect(violaCausalidadDeVolumen('VARIABLE', undefined)).toBe(false);
  });

  it('FIJO o SEMIFIJO nunca violan la regla, sea cual sea la causa', () => {
    expect(violaCausalidadDeVolumen('FIJO', 'tiempo')).toBe(false);
    expect(violaCausalidadDeVolumen('SEMIFIJO', 'intensidad_de_uso')).toBe(false);
  });
});
