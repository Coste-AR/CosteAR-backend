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
