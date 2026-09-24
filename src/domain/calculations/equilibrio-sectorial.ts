import { Decimal } from 'decimal.js';

export interface CoproductoSectorial {
  nombre: string;
  precio: number;
  rendimiento: number;
}

export interface SegmentoSectorialInput {
  id: string;
  nombre: string;
  participacion: number;
  precioUnitario: number | null;
  costoVariableUnitario: number | null;
  costoFijoDirecto: number;
  prorrateoIndirectos: number;
  produccionConjunta?: boolean;
  coproductos?: readonly CoproductoSectorial[];
}

const n = (valor: Decimal): number => valor.toNumber();

export function contribucionMarginalSegmento(segmento: SegmentoSectorialInput): number {
  if (segmento.produccionConjunta) {
    return n((segmento.coproductos ?? []).reduce(
      (total, coproducto) => total.plus(new Decimal(coproducto.precio).times(coproducto.rendimiento)),
      new Decimal(0),
    ));
  }
  return n(new Decimal(segmento.precioUnitario ?? 0).minus(segmento.costoVariableUnitario ?? 0));
}

/**
 * R15/R16: la producción conjunta obtiene su ingreso unitario de los
 * coproductos ponderados por rendimiento; nunca de un costo variable propio.
 * Un desecho con costo de eliminación se expresa con precio negativo.
 */
export function calcularEquilibrioSectorial(segmentos: readonly SegmentoSectorialInput[]) {
  if (segmentos.length === 0) {
    return { equilibrioGeneral: null, segmentos: [], controlIndirectos: { indirectos: 0, contribucionesNetas: 0, diferencia: 0 } };
  }
  const participacionTotal = segmentos.reduce((a, s) => a.plus(s.participacion), new Decimal(0));
  if (!participacionTotal.eq(1)) throw new Error('Las participaciones de los segmentos deben sumar uno.');

  const cm = (s: SegmentoSectorialInput): Decimal => new Decimal(contribucionMarginalSegmento(s));
  const cmPonderada = segmentos.reduce(
    (total, s) => total.plus(cm(s).times(s.participacion)), new Decimal(0),
  );
  const fijosDirectos = segmentos.reduce((a, s) => a.plus(s.costoFijoDirecto), new Decimal(0));
  const indirectos = segmentos.reduce((a, s) => a.plus(s.prorrateoIndirectos), new Decimal(0));
  const equilibrioGeneral = cmPonderada.gt(0) ? fijosDirectos.plus(indirectos).div(cmPonderada) : null;

  const resultados = segmentos.map((s) => {
    const contribucion = cm(s);
    const equilibrioEspecifico = contribucion.gt(0) ? new Decimal(s.costoFijoDirecto).div(contribucion) : null;
    const equilibrioSectorial = equilibrioGeneral?.times(s.participacion) ?? null;
    const contribucionNeta = equilibrioSectorial
      ? equilibrioSectorial.times(contribucion).minus(s.costoFijoDirecto)
      : null;
    const sinProrrateo = contribucionNeta === null ? null : n(contribucionNeta);
    const conProrrateo = contribucionNeta === null
      ? null
      : n(contribucionNeta.minus(s.prorrateoIndirectos));
    return {
      id: s.id,
      nombre: s.nombre,
      contribucionMarginalUnitaria: n(contribucion),
      contribucionNeta: sinProrrateo,
      equilibrioEspecifico: equilibrioEspecifico ? n(equilibrioEspecifico) : null,
      equilibrioSectorial: equilibrioSectorial ? n(equilibrioSectorial) : null,
      excedente: equilibrioSectorial && equilibrioEspecifico ? n(equilibrioSectorial.minus(equilibrioEspecifico)) : null,
      vistaSinProrrateo: { resultado: sinProrrateo },
      vistaConProrrateo: {
        resultado: conProrrateo,
        doctrinaria: false as const,
        motivo: 'El déficit puede ser un artefacto del prorrateo de costos fijos indirectos; se muestra junto a la vista sin prorrateo.',
      },
      basadoEn: {
        participacion: s.participacion,
        costoFijoDirecto: s.costoFijoDirecto,
        prorrateoIndirectos: s.prorrateoIndirectos,
        produccionConjunta: Boolean(s.produccionConjunta),
      },
    };
  });
  const contribucionesNetas = resultados.reduce((a, s) => a.plus(s.contribucionNeta ?? 0), new Decimal(0));
  return {
    equilibrioGeneral: equilibrioGeneral ? n(equilibrioGeneral) : null,
    segmentos: resultados,
    controlIndirectos: {
      indirectos: n(indirectos),
      contribucionesNetas: n(contribucionesNetas),
      diferencia: n(contribucionesNetas.minus(indirectos)),
    },
  };
}
