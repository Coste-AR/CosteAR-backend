import { Decimal } from 'decimal.js';

/**
 * DESPERDICIO — S-04 (T-04).
 *
 * La doctrina ya estaba codificada en el sistema; el modelo de dominio no tenía
 * dónde ponerla:
 *
 *   · `corpus-clasificador/ground-truth.md` regla R5 — la merma normal la absorben
 *     las unidades buenas, con el recupero restado; la extraordinaria es pérdida
 *     del período y NUNCA costo.
 *   · `industry-profile.ts:310-322` — mortandad, huevo roto y merma de postura
 *     están en `lossKeywords` con el motivo escrito: **el umbral que separa lo
 *     normal de lo extraordinario no está en el texto del documento**, así que el
 *     sistema no puede decidirlo sin preguntar.
 *
 * De ahí sale la regla dura de este módulo:
 *
 * > Un desperdicio SIN naturaleza declarada no entra al cálculo. Queda pendiente.
 *
 * Elegir por el costista sería peor que no calcular: mandar una merma
 * extraordinaria al costo infla el costo unitario de todo el mes, y no se ve.
 */

export type NaturalezaDesperdicio = 'normal' | 'extraordinaria';

export interface DesperdicioRegistrado {
  /** Qué se perdió: "mortandad", "huevo roto", "maíz húmedo". */
  concepto: string;
  /** Valor del desperdicio, en pesos. */
  valor: number;
  /**
   * Naturaleza DECLARADA. `null` significa que nadie la declaró — no significa
   * "normal". Es la diferencia entre no saber y suponer.
   */
  naturaleza: NaturalezaDesperdicio | null;
  /** Lo que se recupera vendiendo el desperdicio. Se resta de la merma normal (R5). */
  valorRecupero?: number;
}

export interface ImputacionDesperdicio {
  /** Merma normal neta de recupero: la absorben las unidades buenas. */
  alCosto: number;
  /** Merma extraordinaria: va a resultado del período, nunca a costo. */
  alResultado: number;
  /** Recupero total restado del costo. */
  recuperoAplicado: number;
  /**
   * Lo que no se pudo imputar y por qué. Mismo patrón que los datos sin decisión
   * de imputación: se muestra, no se resuelve solo.
   */
  pendientes: { concepto: string; valor: number; motivo: string }[];
}

/**
 * Sugiere una naturaleza a partir del umbral configurado, sin decidir.
 *
 * El umbral viene de `ParametroCosteo` (`umbral_merma_normal_pct`). Si no está
 * configurado —que es el estado inicial a propósito— devuelve `null`: el sistema
 * no inventa el criterio que el cliente no dio.
 */
export function sugerirNaturaleza(
  porcentajeSobreBase: number,
  umbralNormalPct: number | null,
): NaturalezaDesperdicio | null {
  if (umbralNormalPct === null || !Number.isFinite(umbralNormalPct) || umbralNormalPct <= 0) {
    return null;
  }
  return porcentajeSobreBase <= umbralNormalPct ? 'normal' : 'extraordinaria';
}

/**
 * Reparte los desperdicios del período entre costo y resultado, siguiendo R5.
 */
export function imputarDesperdicios(
  registros: DesperdicioRegistrado[],
): ImputacionDesperdicio {
  let alCosto = new Decimal(0);
  let alResultado = new Decimal(0);
  let recuperoAplicado = new Decimal(0);
  const pendientes: ImputacionDesperdicio['pendientes'] = [];

  for (const r of registros) {
    if (r.naturaleza === null) {
      pendientes.push({
        concepto: r.concepto,
        valor: r.valor,
        motivo:
          'Falta declarar si la merma es normal o extraordinaria. ' +
          'El umbral no surge del comprobante y el sistema no lo elige por vos.',
      });
      continue;
    }

    if (r.naturaleza === 'normal') {
      // R5: la absorben las unidades buenas, con el recupero restado.
      const recupero = new Decimal(r.valorRecupero ?? 0);
      recuperoAplicado = recuperoAplicado.plus(recupero);
      alCosto = alCosto.plus(new Decimal(r.valor).minus(recupero));
      continue;
    }

    // Extraordinaria: resultado del período. El recupero de una merma
    // extraordinaria tampoco baja el costo, porque la merma nunca fue costo.
    alResultado = alResultado.plus(new Decimal(r.valor).minus(r.valorRecupero ?? 0));
  }

  return {
    alCosto: alCosto.toNumber(),
    alResultado: alResultado.toNumber(),
    recuperoAplicado: recuperoAplicado.toNumber(),
    pendientes,
  };
}
