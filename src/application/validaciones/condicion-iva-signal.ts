// src/application/validaciones/condicion-iva-signal.ts

/**
 * LA SEÑAL FISCAL DE LA IA DEJA DE MORIR EN TEXTO LIBRE
 * =====================================================
 *
 * El prompt de Groq le pide a la IA que, si un comprobante muestra indicios de
 * que la empresa NO es Responsable Inscripto ("Factura C", "Consumidor Final",
 * "Monotributista", "Responsable No Inscripto"), lo marque "para revisión en
 * qualityNote". Eso se venía cumpliendo: la IA lo escribía. Y ahí terminaba
 * todo. `qualityNote` es una cadena suelta dentro del JSON del análisis, que se
 * guarda en `DataEntry.reviewNote` y no la lee nadie. No cambiaba ninguna
 * decisión de costeo, no llegaba a ninguna pantalla y no dejaba ningún rastro
 * accionable.
 *
 * El problema es concreto: si la empresa es monotributista, el IVA de cada
 * comprobante ES costo (cátedra, Clase 4, línea 27) y el sistema la está
 * costeando sobre el neto — subvaluando cada línea entre un 10,5 % y un 21 %.
 * La IA lo VIO y lo DIJO. Nadie se enteró.
 *
 * Este módulo convierte esa cadena en un dato: qué condición sugiere el
 * documento y con qué texto exacto. Si contradice la condición declarada de la
 * empresa, `validaciones-service` levanta la bandera `condicionIvaRevisar` en
 * `Company` (más una `DailySignal` para el pipeline). El costista ve el cartel
 * en la ficha de la empresa y decide; el sistema no cambia la condición solo,
 * porque la condición fiscal de un cliente es un hecho registral, no algo que
 * se infiera de un ticket.
 *
 * Es una función pura y sin dependencias: se testea sin base y sin red.
 */

import type { CondicionIva } from './ledger-builder.js';

export interface CondicionIvaSignal {
  /** Qué condición sugiere el documento. */
  sugerida: CondicionIva;
  /** El indicio literal que disparó la detección ("factura c", "monotributo", …). */
  indicio: string;
  /** Dónde apareció: la nota de calidad de la IA o el texto crudo del documento. */
  origen: 'qualityNote' | 'documento';
}

/**
 * Indicios ordenados por especificidad: gana el primero que aparezca.
 *
 * "Factura C" y "Responsable No Inscripto" apuntan a la misma consecuencia de
 * costeo que Monotributo (el IVA no se recupera). Se mapean al valor del enum
 * que mejor los representa: la Factura C la emite un monotributista o un
 * exento; el "responsable no inscripto" que nombra la cátedra es una figura
 * derogada que hoy cae bajo EXENTO. En los dos casos la decisión de costeo es
 * idéntica, así que un mapeo aproximado no cambia ningún importe: solo cambia
 * qué texto se le muestra al humano que va a confirmar.
 */
const INDICIOS: { patron: RegExp; etiqueta: string; sugerida: CondicionIva }[] = [
  { patron: /\bmonotribut\w*/i, etiqueta: 'Monotributista', sugerida: 'MONOTRIBUTO' },
  { patron: /\bresponsable\s+no\s+inscript\w*/i, etiqueta: 'Responsable No Inscripto', sugerida: 'EXENTO' },
  { patron: /\bfactura\s*"?\s*c\b/i, etiqueta: 'Factura C', sugerida: 'MONOTRIBUTO' },
  { patron: /\bcomprobante\s*"?\s*c\b/i, etiqueta: 'Comprobante C', sugerida: 'MONOTRIBUTO' },
  { patron: /\bconsumidor\s+final\b/i, etiqueta: 'Consumidor Final', sugerida: 'MONOTRIBUTO' },
  { patron: /\b(iva\s+)?exent[oa]s?\b/i, etiqueta: 'Exento', sugerida: 'EXENTO' },
];

/**
 * Cuidado con los falsos positivos: un comprobante de un RI puede decir
 * "Responsable Inscripto" y, si además nombra un ítem "exento", no queremos
 * marcarlo. Cuando el texto declara explícitamente "Responsable Inscripto",
 * solo los indicios FUERTES (los que nombran otra condición del emisor/receptor
 * de frente) siguen valiendo.
 */
const DECLARA_RI = /\bresponsable\s+inscript\w*/i;
const INDICIOS_FUERTES = new Set(['Monotributista', 'Responsable No Inscripto', 'Factura C', 'Comprobante C']);

function buscar(texto: string | null | undefined, origen: CondicionIvaSignal['origen']): CondicionIvaSignal | null {
  if (!texto || !texto.trim()) return null;
  // "Responsable No Inscripto" también matchea /responsable\s+inscript/? No:
  // el "no" del medio lo impide. El chequeo es literal y seguro.
  const declaraRi = DECLARA_RI.test(texto);
  for (const { patron, etiqueta, sugerida } of INDICIOS) {
    if (!patron.test(texto)) continue;
    if (declaraRi && !INDICIOS_FUERTES.has(etiqueta)) continue;
    return { sugerida, indicio: etiqueta, origen };
  }
  return null;
}

interface AnalisisConNotaDeCalidad {
  qualityNote?: string | null;
}

/**
 * Extrae la señal de condición fiscal del análisis de la IA.
 *
 * `aiReviewNote` es el JSON crudo guardado en `DataEntry.reviewNote`. Se mira
 * primero `qualityNote` (es donde el prompt pide que se marque) y, si ahí no
 * hay nada, el texto crudo del documento — porque la IA no siempre cumple el
 * pedido del prompt y "FACTURA C" impreso en el comprobante es la misma señal.
 * Devuelve `null` si no hay indicio alguno.
 */
export function detectarSenalCondicionIva(params: {
  aiReviewNote: string | null;
  rawContent?: string | null;
}): CondicionIvaSignal | null {
  let qualityNote: string | null = null;
  if (params.aiReviewNote) {
    try {
      const parsed = JSON.parse(params.aiReviewNote) as AnalisisConNotaDeCalidad;
      if (parsed && typeof parsed === 'object' && typeof parsed.qualityNote === 'string') {
        qualityNote = parsed.qualityNote;
      }
    } catch {
      qualityNote = null;
    }
  }

  return buscar(qualityNote, 'qualityNote') ?? buscar(params.rawContent, 'documento');
}

/**
 * ¿Esta señal CONTRADICE lo que la empresa tiene declarado?
 *
 * Solo contradice si cambia la decisión de costeo. Un documento con indicios de
 * Monotributo en una empresa ya marcada como EXENTO no amerita cartel: las dos
 * condiciones cuentan el IVA como costo, el importe que entra al libro mayor es
 * el mismo, y molestar al costista con eso es entrenarlo para ignorar la
 * bandera.
 */
export function contradiceLaCondicionDeclarada(
  senal: CondicionIvaSignal,
  declarada: CondicionIva,
): boolean {
  const declaradaRecuperaIva = declarada === 'RESPONSABLE_INSCRIPTO';
  const sugeridaRecuperaIva = senal.sugerida === 'RESPONSABLE_INSCRIPTO';
  return declaradaRecuperaIva !== sugeridaRecuperaIva;
}

/** Texto que queda guardado en `Company.condicionIvaRevisarNota`. */
export function notaDeRevision(senal: CondicionIvaSignal, params: { documento: string }): string {
  const donde = senal.origen === 'qualityNote' ? 'la nota de calidad de la IA' : 'el texto del comprobante';
  return (
    `Indicio de "${senal.indicio}" detectado en ${donde} del documento "${params.documento}". ` +
    `La empresa está declarada como Responsable Inscripto, así que el sistema costea sobre el NETO. ` +
    `Si en realidad es ${senal.sugerida === 'MONOTRIBUTO' ? 'monotributista' : 'exenta'}, el IVA SÍ es parte ` +
    `del costo (Clase 4 de la cátedra, línea 27) y los costos se están subvaluando. ` +
    `Confirmá la condición frente al IVA en la ficha de la empresa.`
  );
}
