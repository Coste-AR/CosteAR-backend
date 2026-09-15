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
