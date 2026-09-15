import { describe, expect, it } from 'vitest';
import {
  calcularContribucionMarginal,
  CLAVES_COMPORTAMIENTO_CONTRIBUCION,
  type FilaComportamiento,
} from '@/domain/calculations/contribucion-marginal.js';

const contexto = { structureId: 'estructura-1', periodId: 'periodo-1' };
const componentes = [
  { clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima, etiqueta: 'Materia prima', importeAbsorcion: 36 },
  { clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta, etiqueta: 'Mano de obra directa', importeAbsorcion: 24 },
  { clave: CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos, etiqueta: 'Costos indirectos de producción', importeAbsorcion: 12 },
];

function clasificacion(
  clave: string,
  comportamientoVolumen: FilaComportamiento['comportamientoVolumen'],
): FilaComportamiento {
  return {
    id: `parametro-${clave}`,
    clave,
    comportamientoVolumen,
    structureId: 'estructura-1',
    periodId: null,
    clasificadoPorUserId: 'usuario-1',
    clasificadoEn: new Date('2026-09-02T10:00:00.000Z'),
  };
}

describe('contribución marginal por unidad', () => {
  it('usa sólo los importes que ya produjo absorción y deja su traza', () => {
    const resultado = calcularContribucionMarginal({
      precioUnitario: 15,
      unidadesVendidas: 6,
      componentes,
      clasificaciones: [
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima, 'VARIABLE'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta, 'FIJO'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos, 'VARIABLE'),
      ],
      contexto,
    });

    expect(resultado.incompleta).toBe(false);
    if (resultado.incompleta) return;
    expect(resultado.totalAbsorcion).toBe(72);
    expect(resultado.costoVariableTotal).toBe(48);
    expect(resultado.costoVariableUnitario).toBe(8);
    expect(resultado.contribucionMarginalUnitaria).toBe(7);
    expect(resultado.componentes.map((c) => c.importeAbsorcion)).toEqual([36, 24, 12]);
    expect(resultado.componentes[0]).toMatchObject({ origen: 'estructura', parametroId: expect.any(String) });
  });

  it('un cambio explícito de clasificación cambia la contribución, sin cambiar absorción', () => {
    const base = [
      clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima, 'VARIABLE'),
      clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta, 'FIJO'),
      clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos, 'FIJO'),
    ];
    const antes = calcularContribucionMarginal({ precioUnitario: 15, unidadesVendidas: 6, componentes, clasificaciones: base, contexto });
    const despues = calcularContribucionMarginal({
      precioUnitario: 15,
      unidadesVendidas: 6,
      componentes,
      clasificaciones: [
        ...base.slice(0, 2),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos, 'VARIABLE'),
      ],
      contexto,
    });

    expect(antes.incompleta).toBe(false);
    expect(despues.incompleta).toBe(false);
    if (antes.incompleta || despues.incompleta) return;
    expect(antes.totalAbsorcion).toBe(despues.totalAbsorcion);
    expect(antes.contribucionMarginalUnitaria).not.toBe(despues.contribucionMarginalUnitaria);
  });

  it('sin clasificación no inventa un costo variable', () => {
    const resultado = calcularContribucionMarginal({
      precioUnitario: 15,
      unidadesVendidas: 6,
      componentes,
      clasificaciones: [
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima, 'VARIABLE'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta, 'FIJO'),
      ],
      contexto,
    });

    expect(resultado).toMatchObject({
      incompleta: true,
      costoVariableUnitario: null,
      contribucionMarginalUnitaria: null,
    });
    if (!resultado.incompleta) return;
    expect(resultado.motivos.join(' ')).toMatch(/costos indirectos/i);
  });

  /**
   * M0-01: sin este caso, sumar los cuatro componentes nuevos (variación
   * presupuesto, terceros, amortización, desperdicio) dejaba incompleta
   * CUALQUIER contribución marginal cuyo período no tuviera ninguno de los
   * cuatro —el caso común—, porque llegaban sin clasificar. Un rubro en $0
   * aporta lo mismo al costo variable sea cual sea su clasificación.
   */
  it('un rubro sin clasificar en $0 no exige clasificación ni aparece en los motivos', () => {
    const conUnComponenteEnCero = [
      ...componentes,
      { clave: 'comportamiento_trabajos_de_terceros', etiqueta: 'Trabajos de terceros', importeAbsorcion: 0 },
    ];
    const resultado = calcularContribucionMarginal({
      precioUnitario: 15,
      unidadesVendidas: 6,
      componentes: conUnComponenteEnCero,
      clasificaciones: [
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima, 'VARIABLE'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta, 'FIJO'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos, 'VARIABLE'),
        // 'comportamiento_trabajos_de_terceros' NO tiene fila: sigue sin clasificar.
      ],
      contexto,
    });

    expect(resultado.incompleta).toBe(false);
    if (resultado.incompleta) return;
    expect(resultado.totalAbsorcion).toBe(72); // el componente en $0 no cambia nada
  });

  /**
   * M2-01 (plan de análisis marginal v2). Los gastos de no fabricación
   * (comercialización, administración) son fijos/variables por DEFINICIÓN —
   * a diferencia de MP/MOD/CIP, no hay una decisión humana que tomar sobre
   * si un "gasto variable de comercialización por unidad vendida" es fijo o
   * variable: lo dice el propio nombre. `comportamientoVolumenForzado` deja
   * que un componente llegue YA clasificado, sin pasar por la cascada de
   * `ParametroCosteo` — ni siquiera necesita que exista una fila.
   */
  it('un componente forzado no pasa por la cascada de clasificación', () => {
    const resultado = calcularContribucionMarginal({
      precioUnitario: 15,
      unidadesVendidas: 6,
      componentes: [
        ...componentes,
        { clave: 'gastos_comercializacion', etiqueta: 'Gastos de comercialización', importeAbsorcion: 18, comportamientoVolumenForzado: 'VARIABLE' },
      ],
      clasificaciones: [
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima, 'VARIABLE'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta, 'FIJO'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos, 'VARIABLE'),
        // 'gastos_comercializacion' NO tiene fila — ninguna clasificación la respalda.
      ],
      contexto,
    });

    expect(resultado.incompleta).toBe(false);
    if (resultado.incompleta) return;
    expect(resultado.componentes.find((c) => c.clave === 'gastos_comercializacion')).toMatchObject({
      comportamientoVolumen: 'VARIABLE',
      origen: null, // no lo respalda ninguna fila real — es forzado, no elegido
      parametroId: null,
    });
    // 48 (variable de siempre) + 18 (forzado variable) = 66
    expect(resultado.costoVariableTotal).toBe(66);
  });

  it('una fila real de clasificación NO puede pisar lo forzado', () => {
    const resultado = calcularContribucionMarginal({
      precioUnitario: 15,
      unidadesVendidas: 6,
      componentes: [
        { clave: 'gastos_administracion', etiqueta: 'Gastos de administración', importeAbsorcion: 20, comportamientoVolumenForzado: 'FIJO' },
      ],
      // Alguien clasificó (por error, o por intentar anularlo) esta clave como VARIABLE.
      clasificaciones: [clasificacion('gastos_administracion', 'VARIABLE')],
      contexto,
    });

    expect(resultado.incompleta).toBe(false);
    if (resultado.incompleta) return;
    expect(resultado.componentes[0]).toMatchObject({ comportamientoVolumen: 'FIJO' });
    expect(resultado.costoVariableTotal).toBe(0); // no entró al variable pese a la fila
  });

  it('un semifijo queda pendiente hasta que se declare su tramo variable', () => {
    const resultado = calcularContribucionMarginal({
      precioUnitario: 15,
      unidadesVendidas: 6,
      componentes,
      clasificaciones: componentes.map((c) =>
        clasificacion(c.clave, c.clave === CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos ? 'SEMIFIJO' : 'VARIABLE'),
      ),
      contexto,
    });

    expect(resultado.incompleta).toBe(true);
    if (!resultado.incompleta) return;
    expect(resultado.motivos.join(' ')).toMatch(/semifijo/i);
  });
});

/**
 * M0-01 (plan de análisis marginal v2, `CosteAR-admin`). Hasta acá la
 * contribución marginal se armaba con los tres componentes de absorción
 * (MP/MOD/CIP) SIN ningún control contra el costo real del Estado de Costos:
 * si a `enrichCalculationResult` se le olvidaba pasar un componente, o lo
 * pasaba con el importe equivocado, `totalAbsorcion` daba cualquier número y
 * nada lo delataba.
 *
 * `totalEsperado` es opcional (`netProductionCost`, renglón 7f, expuesto
 * desde #363) — sin él el comportamiento es exactamente el de antes. Con él,
 * si la suma no cierra, el motivo nombra el faltante EN PESOS, no un
 * "incompleto" genérico (así lo pide el criterio de aceptación del plan).
 */
describe('control de suma contra el costo neto de producción (renglón 7f)', () => {
  it('sin totalEsperado, el comportamiento es exactamente el de antes', () => {
    const resultado = calcularContribucionMarginal({
      precioUnitario: 15,
      unidadesVendidas: 6,
      componentes,
      clasificaciones: [
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima, 'VARIABLE'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta, 'FIJO'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos, 'VARIABLE'),
      ],
      contexto,
    });
    expect(resultado.incompleta).toBe(false);
  });

  it('cuando la suma coincide con el renglón 7f, no agrega ningún motivo', () => {
    const resultado = calcularContribucionMarginal({
      precioUnitario: 15,
      unidadesVendidas: 6,
      componentes, // 36 + 24 + 12 = 72
      clasificaciones: [
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima, 'VARIABLE'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta, 'FIJO'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos, 'VARIABLE'),
      ],
      contexto,
      totalEsperado: 72,
    });
    expect(resultado.incompleta).toBe(false);
  });

  it('cuando la suma NO cierra, sale incompleta con el faltante nombrado en pesos', () => {
    const resultado = calcularContribucionMarginal({
      precioUnitario: 15,
      unidadesVendidas: 6,
      componentes, // suman 72
      clasificaciones: [
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima, 'VARIABLE'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta, 'FIJO'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos, 'VARIABLE'),
      ],
      contexto,
      totalEsperado: 100, // faltan 28 — p.ej. un componente que no se pasó
    });

    expect(resultado.incompleta).toBe(true);
    if (!resultado.incompleta) return;
    expect(resultado.motivos.join(' ')).toMatch(/28/);
    expect(resultado.motivos.join(' ')).toMatch(/no cierra|control de suma/i);
  });

  it('una diferencia de redondeo (centavos) no dispara el control', () => {
    const resultado = calcularContribucionMarginal({
      precioUnitario: 15,
      unidadesVendidas: 6,
      componentes,
      clasificaciones: [
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima, 'VARIABLE'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta, 'FIJO'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos, 'VARIABLE'),
      ],
      contexto,
      totalEsperado: 72.001,
    });
    expect(resultado.incompleta).toBe(false);
  });
});

/**
 * M0-02 (plan de análisis marginal v2, `CosteAR-admin`). `costoVariableUnitario`
 * dividía TODO por `unidadesVendidas` — issue #88 reaparecido en la capa nueva.
 * Ese bug ya se había corregido en `detail.unitCost` (producción divide por
 * PRODUCIDAS, no por vendidas); esta capa no había heredado la corrección.
 *
 * Fixture canónico del plan (`AM-01`): 1.000 producidas, 800 vendidas, costo
 * variable de producción 214.000, gasto variable de comercialización 30 por
 * unidad vendida (elemento VENTA, M2-01).
 */
describe('costo variable de producción (÷producidas) vs. comercialización (÷vendidas) — M0-02', () => {
  const componentesAM01 = [
    { clave: 'mp', etiqueta: 'Materia prima', importeAbsorcion: 214000 }, // elemento 'produccion' por default
    { clave: 'gastos_comercializacion', etiqueta: 'Gastos de comercialización', importeAbsorcion: 24000, comportamientoVolumenForzado: 'VARIABLE' as const, elemento: 'venta' as const },
  ];
  const clasificacionesAM01 = [clasificacion('mp', 'VARIABLE')];

  it('cv_producción divide por PRODUCIDAS, cv_comercialización por VENDIDAS', () => {
    const resultado = calcularContribucionMarginal({
      precioUnitario: 500,
      unidadesVendidas: 800,
      unidadesProducidas: 1000,
      componentes: componentesAM01,
      clasificaciones: clasificacionesAM01,
      contexto,
    });

    expect(resultado.incompleta).toBe(false);
    if (resultado.incompleta) return;
    expect(resultado.costoVariableUnitarioProduccion).toBe(214); // 214.000 / 1.000
    expect(resultado.costoVariableUnitarioComercializacion).toBe(30); // 24.000 / 800
    expect(resultado.costoVariableUnitario).toBe(244); // 214 + 30, no 297,50 (=238.000/800)
    expect(resultado.basadoEn).toBe('producidas');
    expect(resultado.unidadesProducidas).toBe(1000);
  });

  it('sin cantidad producida, cae a vendidas y lo dice en basadoEn — no falla', () => {
    const resultado = calcularContribucionMarginal({
      precioUnitario: 500,
      unidadesVendidas: 800,
      // unidadesProducidas ausente.
      componentes: componentesAM01,
      clasificaciones: clasificacionesAM01,
      contexto,
    });

    expect(resultado.incompleta).toBe(false);
    if (resultado.incompleta) return;
    expect(resultado.basadoEn).toBe('vendidas');
    expect(resultado.unidadesProducidas).toBe(800);
    // Con producidas = vendidas (el fallback), cv_producción = 214.000/800 = 267,50
    expect(resultado.costoVariableUnitarioProduccion).toBe(267.5);
  });

  it('el error frecuente que el criterio del plan pide atrapar: comercialización no se cuela en cv_producción', () => {
    const resultado = calcularContribucionMarginal({
      precioUnitario: 500,
      unidadesVendidas: 800,
      unidadesProducidas: 1000,
      componentes: componentesAM01,
      clasificaciones: clasificacionesAM01,
      contexto,
    });

    if (resultado.incompleta) throw new Error('no debería estar incompleta');
    // Existencia final de 200 unidades valuada a cv de PRODUCCIÓN: 200 x 214 =
    // 42.800. Si cv_producción incluyera comercialización (300,26), daría 60.052.
    expect(200 * resultado.costoVariableUnitarioProduccion).toBe(42800);
  });

  it('sin unidadesProducidas ni elemento explícito, el comportamiento es exactamente el de antes de M0-02', () => {
    // Los tests de arriba (sin elemento/unidadesProducidas) siguen dando lo
    // mismo: elemento default 'produccion' + fallback a vendidas reproduce
    // exactamente costoVariableTotal.divide(unidadesVendidas) de siempre.
    const resultado = calcularContribucionMarginal({
      precioUnitario: 15,
      unidadesVendidas: 6,
      componentes,
      clasificaciones: [
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.materiaPrima, 'VARIABLE'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.manoObraDirecta, 'FIJO'),
        clasificacion(CLAVES_COMPORTAMIENTO_CONTRIBUCION.costosIndirectos, 'VARIABLE'),
      ],
      contexto,
    });
    expect(resultado.incompleta).toBe(false);
    if (resultado.incompleta) return;
    expect(resultado.costoVariableUnitario).toBe(8); // idéntico al primer test del archivo
  });
});
