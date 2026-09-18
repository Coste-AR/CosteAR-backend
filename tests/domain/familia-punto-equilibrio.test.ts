import { describe, expect, it } from 'vitest';
import { calcularFormulaPuntoEquilibrio, type FormulaPuntoEquilibrio } from '@/domain/calculations/punto-equilibrio.js';
import { calcularContribucionMarginal } from '@/domain/calculations/contribucion-marginal.js';
import { calcularPuntoEquilibrio } from '@/domain/calculations/punto-equilibrio.js';

const contexto = { basadoEn: [{ clave: 'mp', etiqueta: 'Materia prima' }, { clave: 'cif', etiqueta: 'Costos fijos' }] };
const casos: [FormulaPuntoEquilibrio, number][] = [
  [{ tipo: 'fisico', costosFijos: 192000, cm: 256 }, 750],
  [{ tipo: 'razonContribucion', cm: 256, precio: 500 }, 0.512],
  [{ tipo: 'razonPorMarcacion', marcacion: 0.6 }, 0.375],
  [{ tipo: 'monetarioPorRazon', costosFijos: 192000, razon: 0.512 }, 375000],
  [{ tipo: 'monetarioPorMarcacion', costosFijos: 192000, marcacion: 0.6 }, 512000],
  [{ tipo: 'utilidadFisica', costosFijos: 192000, resultado: 64000, cm: 256 }, 1000],
  [{ tipo: 'utilidadMonetaria', costosFijos: 192000, resultado: 64000, marcacion: 0.6 }, 256000 * 1.6 / 0.6],
  [{ tipo: 'multiproducto', costosFijos: 192000, productos: [{ participacion: 0.5, cm: 200 }, { participacion: 0.5, cm: 312 }] }, 750],
  [{ tipo: 'costoFijoMaximo', unidades: 800, cm: 256 }, 204800],
  [{ tipo: 'precioNecesario', costosFijos: 192000, unidades: 600, costoVariable: 244 }, 564],
  [{ tipo: 'costoVariableMaximo', costosFijos: 192000, unidades: 600, precio: 500 }, 180],
  [{ tipo: 'resultadoActual', unidades: 800, cm: 256, costosFijos: 192000 }, 12800],
  [{ tipo: 'costoFijoConResultado', unidades: 1000, cm: 256, resultado: 64000 }, 192000],
  [{ tipo: 'margenNecesario', costosFijos: 192000, resultado: 64000, ventas: 512000 }, 1],
];

describe('familia de punto de equilibrio — M3-01', () => {
  it.each<FormulaPuntoEquilibrio>([
    { tipo: 'fisico', costosFijos: 192000, cm: 0 },
    { tipo: 'monetarioPorRazon', costosFijos: 192000, razon: -0.1 },
    { tipo: 'monetarioPorMarcacion', costosFijos: 192000, marcacion: 0 },
    { tipo: 'razonContribucion', cm: 0, precio: 500 },
    { tipo: 'razonContribucion', cm: 256, precio: 0 },
    { tipo: 'razonPorMarcacion', marcacion: -1 },
    { tipo: 'utilidadFisica', costosFijos: 192000, resultado: 64000, cm: -1 },
    { tipo: 'utilidadMonetaria', costosFijos: 192000, resultado: 64000, marcacion: 0 },
    { tipo: 'precioNecesario', costosFijos: 192000, unidades: 0, costoVariable: 244 },
    { tipo: 'costoVariableMaximo', costosFijos: 192000, unidades: -1, precio: 500 },
    { tipo: 'margenNecesario', costosFijos: 192000, resultado: 64000, ventas: 256000 },
    { tipo: 'multiproducto', costosFijos: 192000, productos: [{ participacion: 1, cm: 0 }] },
    { tipo: 'costoFijoMaximo', unidades: 800, cm: 0 },
    { tipo: 'costoFijoConResultado', unidades: 1000, cm: -1, resultado: 64000 },
  ])('declara ausencia con denominador inválido: $tipo', (formula) => {
    expect(calcularFormulaPuntoEquilibrio(formula, contexto)).toMatchObject({ valor: null, motivoSinEquilibrio: expect.any(String), ...contexto });
  });

  it.each(casos)('resuelve AM-01: %j', (formula, esperado) => {
    const respuesta = calcularFormulaPuntoEquilibrio(formula, contexto);
    expect(respuesta.valor).toBeCloseTo(esperado, 8);
    expect(respuesta.basadoEn).toEqual(contexto.basadoEn);
    expect(respuesta.tramoValidez).toBeNull();
    expect(respuesta.motivoSinEquilibrio).toBeUndefined();
  });

  it('rechaza mezclas que no suman uno sin normalizar participaciones inventadas', () => {
    expect(calcularFormulaPuntoEquilibrio({ tipo: 'multiproducto', costosFijos: 100, productos: [{ participacion: 0.5, cm: 10 }] }, contexto).valor).toBeNull();
    expect(calcularFormulaPuntoEquilibrio({ tipo: 'multiproducto', costosFijos: 100, productos: [{ participacion: -1, cm: 10 }, { participacion: 2, cm: 10 }] }, contexto).valor).toBeNull();
  });

  it('conserva pérdidas reales en el despeje del resultado', () => {
    expect(calcularFormulaPuntoEquilibrio({ tipo: 'resultadoActual', unidades: 100, cm: -10, costosFijos: 200 }, contexto).valor).toBe(-1200);
  });

  it.each([NaN, Infinity, -Infinity])('no publica resultados no finitos con entrada %s', (cm) => {
    expect(calcularFormulaPuntoEquilibrio({ tipo: 'fisico', costosFijos: 100, cm }, contexto).valor).toBeNull();
  });

  it('no modifica los conceptos ni fabrica un tramo aún no cargado', () => {
    const copia = structuredClone(contexto);
    calcularFormulaPuntoEquilibrio(casos[0]![0], contexto);
    expect(contexto).toEqual(copia);
  });

  it('reconcilia las quince cifras AM-01 y excluye comercialización del stock final', () => {
    const cm = calcularContribucionMarginal({
      precioUnitario: 500, unidadesProducidas: 1000, unidadesVendidas: 800,
      componentes: [
        { clave: 'mp', etiqueta: 'Materia prima', importeAbsorcion: 150000, comportamientoVolumenForzado: 'VARIABLE' },
        { clave: 'mod', etiqueta: 'Mano de obra fija', importeAbsorcion: 60000, comportamientoVolumenForzado: 'FIJO' },
        { clave: 'cip-variable', etiqueta: 'CIP variable declarado', importeAbsorcion: 54000, comportamientoVolumenForzado: 'VARIABLE' },
        { clave: 'cip-fijo', etiqueta: 'CIP fijo declarado', importeAbsorcion: 36000, comportamientoVolumenForzado: 'FIJO' },
        { clave: 'amortizacion', etiqueta: 'Amortización fija', importeAbsorcion: 40000, comportamientoVolumenForzado: 'FIJO' },
        { clave: 'terceros', etiqueta: 'Trabajos de terceros', importeAbsorcion: 10000, comportamientoVolumenForzado: 'VARIABLE' },
        { clave: 'admin', etiqueta: 'Administración fija', importeAbsorcion: 56000, comportamientoVolumenForzado: 'FIJO', elemento: 'venta' },
        { clave: 'venta', etiqueta: 'Venta variable', importeAbsorcion: 24000, comportamientoVolumenForzado: 'VARIABLE', elemento: 'venta' },
      ], clasificaciones: [], contexto: { structureId: 's', periodId: null },
    });
    if (cm.incompleta) throw new Error('AM-01 debe ser completo');
    const pe = calcularPuntoEquilibrio(cm, new Date('2026-01-01'));
    expect(pe.basadoEn).toEqual(cm.componentes.map(({ clave, etiqueta }) => ({ clave, etiqueta })));
    const traza = { basadoEn: cm.componentes };
    const fijos = cm.componentes.filter((c) => c.comportamientoVolumen === 'FIJO').reduce((total, c) => total + c.importeAbsorcion, 0);
    const resolver = (formula: FormulaPuntoEquilibrio) => calcularFormulaPuntoEquilibrio(formula, traza).valor;
    expect([
      1000 * cm.costoVariableUnitarioProduccion, cm.costoVariableUnitarioProduccion,
      cm.costoVariableUnitario, cm.contribucionMarginalUnitaria, fijos, pe.unidadesEquilibrio,
      resolver({ tipo: 'monetarioPorRazon', costosFijos: fijos, razon: 0.512 }),
      resolver({ tipo: 'razonContribucion', cm: cm.contribucionMarginalUnitaria, precio: cm.precioUnitario }),
      resolver({ tipo: 'fisico', costosFijos: fijos - 40000, cm: cm.contribucionMarginalUnitaria }),
      resolver({ tipo: 'resultadoActual', unidades: 800, cm: cm.contribucionMarginalUnitaria, costosFijos: fijos }),
      200 * cm.costoVariableUnitarioProduccion,
      resolver({ tipo: 'utilidadFisica', costosFijos: fijos, resultado: 64000, cm: cm.contribucionMarginalUnitaria }),
      resolver({ tipo: 'costoFijoMaximo', unidades: 800, cm: cm.contribucionMarginalUnitaria }),
      resolver({ tipo: 'precioNecesario', costosFijos: fijos, unidades: 600, costoVariable: cm.costoVariableUnitario }),
      resolver({ tipo: 'costoVariableMaximo', costosFijos: fijos, unidades: 600, precio: cm.precioUnitario }),
    ]).toEqual([214000, 214, 244, 256, 192000, 750, 375000, 0.512, 593.75, 12800, 42800, 1000, 204800, 564, 180]);
    expect(cm.totalAbsorcion).toBe(430000);
    expect(cm.costoVariableTotal).toBe(238000);
  });
});
