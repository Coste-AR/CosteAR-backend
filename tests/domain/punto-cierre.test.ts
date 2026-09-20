import { describe, expect, it } from 'vitest';
import {
  calcularFormulaPuntoCierre,
  calcularPuntosCierre,
  resolverPerfilErogable,
  TEXTO_RESULTADO_NEGATIVO,
} from '@/domain/calculations/punto-cierre.js';
import type { FormulaPuntoEquilibrio } from '@/domain/calculations/punto-equilibrio.js';

const conceptosAm01 = [
  { clave: 'mp', etiqueta: 'Materia prima', comportamientoVolumen: 'VARIABLE' as const, importeUnitario: 150, erogable: true, horizonteErogableMeses: 1 },
  { clave: 'mod', etiqueta: 'Mano de obra', comportamientoVolumen: 'FIJO' as const, importe: 60000, erogable: true, horizonteErogableMeses: 1 },
  { clave: 'cip-variable', etiqueta: 'CIP variable', comportamientoVolumen: 'VARIABLE' as const, importeUnitario: 54, erogable: true, horizonteErogableMeses: 1 },
  { clave: 'cip-fijo', etiqueta: 'CIP fijo', comportamientoVolumen: 'FIJO' as const, importe: 36000, erogable: true, horizonteErogableMeses: 1 },
  { clave: 'amortizacion', etiqueta: 'Amortización', comportamientoVolumen: 'FIJO' as const, importe: 40000, erogable: false, horizonteErogableMeses: null },
  { clave: 'terceros', etiqueta: 'Trabajos de terceros', comportamientoVolumen: 'VARIABLE' as const, importeUnitario: 10, erogable: true, horizonteErogableMeses: 1 },
  { clave: 'admin', etiqueta: 'Administración', comportamientoVolumen: 'FIJO' as const, importe: 56000, erogable: true, horizonteErogableMeses: 12 },
  { clave: 'venta', etiqueta: 'Venta variable', comportamientoVolumen: 'VARIABLE' as const, importeUnitario: 30, erogable: true, horizonteErogableMeses: 1 },
];

const contexto = { basadoEn: conceptosAm01.map(({ clave, etiqueta }) => ({ clave, etiqueta })) };

describe('punto de cierre con horizonte — M3-03', () => {
  it('queda rojo antes de implementar: AM-01 expone 1 y 12 meses y da 593,75 a doce meses', () => {
    const puntos = calcularPuntosCierre({
      precioUnitario: 500,
      horizontesMeses: [1, 12],
      conceptos: conceptosAm01,
      contexto,
      puntoEquilibrioEconomico: 750,
      unidadesActuales: 650,
    });

    expect(puntos.map((punto) => [punto.horizonteMeses, punto.valor])).toEqual([[1, 375], [12, 593.75]]);
    expect(puntos[1]).toMatchObject({
      costosFijosErogables: 152000,
      costoVariableUnitarioErogable: 244,
      contribucionMarginalFinanciera: 256,
      situacion: 'pierde económicamente y sostiene la caja',
      advertencia: TEXTO_RESULTADO_NEGATIVO,
    });
  });

  it('aplica CF→CFE y cv→cve a toda la familia de M3-01', () => {
    const perfil = resolverPerfilErogable({ precioUnitario: 500, horizonteMeses: 12, conceptos: conceptosAm01 });
    if (perfil.incompleto) throw new Error(perfil.motivos.join(', '));
    const casos: Array<[FormulaPuntoEquilibrio, number]> = [
      [{ tipo: 'fisico', costosFijos: 999, cm: 999 }, 593.75],
      [{ tipo: 'razonContribucion', cm: 999, precio: 999 }, 0.512],
      [{ tipo: 'razonPorMarcacion', marcacion: 999 }, 0.512],
      [{ tipo: 'monetarioPorRazon', costosFijos: 999, razon: 999 }, 296875],
      [{ tipo: 'monetarioPorMarcacion', costosFijos: 999, marcacion: 999 }, 152000 * 500 / 256],
      [{ tipo: 'utilidadFisica', costosFijos: 999, resultado: 64000, cm: 999 }, 843.75],
      [{ tipo: 'utilidadMonetaria', costosFijos: 999, resultado: 64000, marcacion: 999 }, 216000 * 500 / 256],
      [{ tipo: 'costoFijoMaximo', unidades: 800, cm: 999 }, 204800],
      [{ tipo: 'precioNecesario', costosFijos: 999, unidades: 600, costoVariable: 999 }, 497.3333333333333],
      [{ tipo: 'costoVariableMaximo', costosFijos: 999, unidades: 600, precio: 999 }, 246.66666666666666],
      [{ tipo: 'resultadoActual', unidades: 800, cm: 999, costosFijos: 999 }, 52800],
      [{ tipo: 'costoFijoConResultado', unidades: 1000, cm: 999, resultado: 64000 }, 192000],
      [{ tipo: 'margenNecesario', costosFijos: 999, resultado: 64000, ventas: 512000 }, 216000 / 296000],
    ];

    for (const [formula, esperado] of casos) {
      expect(calcularFormulaPuntoCierre(formula, perfil, contexto).valor).toBeCloseTo(esperado, 8);
    }
    expect(calcularFormulaPuntoCierre(
      { tipo: 'multiproducto', costosFijos: 999, productos: [{ participacion: 1, cm: 999 }] },
      perfil,
      contexto,
      [{ participacion: 0.5, cm: 200 }, { participacion: 0.5, cm: 312 }],
    ).valor).toBe(593.75);
  });

  it('declara ausencia si un concepto valorizado no declara erogabilidad u horizonte', () => {
    expect(resolverPerfilErogable({
      precioUnitario: 500,
      horizonteMeses: 1,
      conceptos: [{ clave: 'energia', etiqueta: 'Energía', comportamientoVolumen: 'VARIABLE', importeUnitario: 10, erogable: null, horizonteErogableMeses: null }],
    })).toMatchObject({ incompleto: true, motivos: [expect.stringContaining('Energía')] });
  });
});
