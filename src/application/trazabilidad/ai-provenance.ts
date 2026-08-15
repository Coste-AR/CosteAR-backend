import type { PrismaClient, Prisma } from '@prisma/client';

/**
 * PROCEDENCIA DE LA CLASIFICACIÓN IA DE UN DATO (T-06).
 *
 * Responde una sola pregunta, que es la que se hace cualquiera parado frente a
 * un número que no cargó: "¿esto lo puso una persona o lo sugirió la máquina, y
 * quién se hace cargo?".
 *
 * SOLO se arma cuando la versión vigente del dato entró con método
 * 'ia_sugerido' Y tiene documento de origen. Un dato cargado a mano no devuelve
 * este bloque —ni vacío, ni con banderas en false—: la AUSENCIA del bloque es la
 * respuesta, y la ficha no dibuja ningún sello. Un badge que dijera "no fue IA"
 * en cada uno de los cientos de datos que carga una persona sería ruido puro.
 *
 * Todo lo que sale de acá está guardado en `classification_audits`. No se
 * infiere nada, y en particular NO se infiere la confirmación humana: se lee de
 * `validatedByCostista` / `costaValidatedAt`, que es lo que escribe el costista
 * al aprobar el documento. Si el audit no está, no hay confirmación que mostrar.
 */

/**
 * Confianza en palabras, nunca el número crudo.
 *
 * Un "87%" se lee como "hay 87% de probabilidad de que esté bien", y no es eso:
 * es un puntaje interno de un cascade de señales, sin calibrar contra ninguna
 * frecuencia real de aciertos. Mostrarlo invita a una lectura falsa y precisa,
 * que es peor que una lectura vaga y honesta.
 */
export type ConfianzaCualitativa = 'alta' | 'media' | 'baja';

/**
 * El corte de 'baja' es 72 porque es el umbral que usa el propio clasificador
 * (`CONFIDENCE_THRESHOLD` en cascade-classifier.ts) para decidir si se anima a
 * clasificar sin ayuda de la IA: por debajo, el sistema ya declaró que no está
 * seguro. El corte de 'alta' es el único número elegido acá, y a propósito es
 * exigente — entre 72 y 85 hay clasificaciones correctas, pero no tantas como
 * para que la ficha invite a firmar sin mirar.
 */
const CONFIANZA_BAJA_MAX = 72;
const CONFIANZA_ALTA_MIN = 85;

export function confianzaCualitativa(confidence: number): ConfianzaCualitativa {
  if (confidence < CONFIANZA_BAJA_MAX) return 'baja';
  if (confidence >= CONFIANZA_ALTA_MIN) return 'alta';
  return 'media';
}

/**
 * Nombre humano de cada capa del clasificador.
 *
 * "Layer 4" no significa nada para un costista y suena a que hay un problema
 * técnico. Si se muestra de qué capa salió la decisión, se muestra qué hizo esa
 * capa. El índice es `SignalResult.layer`.
 */
const CAPA_NOMBRE: Record<number, string> = {
  0: 'Control de calidad del texto',
  1: 'Señal definitiva del comprobante',
  2: 'Señales que se corroboran entre sí',
  3: 'Verificación de los importes',
  4: 'Reglas de imputación por tipo de comprobante',
  5: 'Lectura del documento con IA',
};

export function nombreDeCapa(layer: number): string {
  return CAPA_NOMBRE[layer] ?? `Capa ${layer}`;
}

/** Qué tan legible resultó el documento (columna `qualityGate`). */
const CALIDAD_LABEL: Record<string, string> = {
  PASS: 'El documento se leyó completo',
  PARTIAL: 'El documento se leyó a medias',
  FAIL: 'El documento casi no se pudo leer',
};

const SECCION_LABEL: Record<string, string> = {
  MATERIA_PRIMA: 'Materia Prima',
  MANO_DE_OBRA: 'Mano de Obra Directa',
  COSTOS_INDIRECTOS: 'Costos Indirectos de Producción',
  VENTAS: 'Ventas',
  GASTO_COMERCIALIZACION: 'Gasto de Comercialización',
  GASTO_ADMINISTRACION: 'Gasto de Administración',
  GASTO_FINANCIERO: 'Gasto Financiero',
  MULTIPLE: 'varias secciones (documento mixto)',
  DESCONOCIDO: 'sin determinar',
};

const TIPO_DOC_LABEL: Record<string, string> = {
  FACTURA_COMPRA: 'Factura de compra',
  FACTURA_VENTA: 'Factura de venta',
  REMITO: 'Remito',
  LIQUIDACION_MOD: 'Liquidación de sueldos',
  PLANILLA_HORAS: 'Planilla de horas',
  NOTA_DEBITO: 'Nota de débito',
  NOTA_CREDITO: 'Nota de crédito',
  DESCONOCIDO: 'sin determinar',
};

/** Traduce una clave interna a su nombre humano, o la deja pasar si no la conoce. */
function label(map: Record<string, string>, key: string | null): string | null {
  if (!key) return null;
  return map[key] ?? key;
}

/**
 * EL DETALLE TÉCNICO: por qué el sistema decidió lo que decidió.
 *
 * Va detrás de un "ver detalle técnico" plegado. Le sirve a quien audita el
 * clasificador, no a quien está costeando un producto — y mezclarlos en la
 * misma pantalla convierte la ficha en un log.
 */
export interface DetalleTecnicoIA {
  /** Qué capa tomó la decisión, con nombre humano (nunca "Layer 4"). */
  capa: string;
  /** La señal que la disparó sola, si hubo una. */
  senalDeterminante: string | null;
  /** Las señales que apoyaron la decisión sin ser determinantes. */
  senalesCorroborantes: string[];
  /** Qué tan legible resultó el documento. */
  calidadDeLectura: string | null;
  /** Si se usó un modelo de lenguaje o alcanzó con las reglas. */
  usoModeloDeLenguaje: boolean;
  /** La explicación que ya escribe el clasificador para el costista. */
  explicacion: string | null;
}

export interface AiProvenance {
  /** Leído de `validatedByCostista`. Nunca inferido de otra cosa. */
  confirmado: boolean;
  /** Quién confirmó. `null` si todavía no lo confirmó nadie. */
  confirmadoPor: string | null;
  /** Cuándo. ISO. `null` mientras no haya confirmación. */
  confirmadoEl: string | null;
  /** El costista cambió lo que la IA había propuesto (`costaOverrode`). */
  corregidoPorPersona: boolean;
  /** Confianza en palabras. Nunca el porcentaje crudo. */
  confianza: ConfianzaCualitativa;
  /** El propio clasificador pidió que alguien lo mire (`requiresReview`). */
  requiereRevision: boolean;
  /** El documento del que salió el número. Sin ids internos. */
  documento: {
    tipo: string | null;
    seccion: string | null;
    archivo: string | null;
  };
  detalleTecnico: DetalleTecnicoIA;
}

/** Señales corroborantes tal como las guarda el audit (`SignalResult[]`). */
function leerSenales(raw: Prisma.JsonValue | null): { label: string; layer: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { label: string; layer: number }[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
    const o = s as Record<string, unknown>;
    if (typeof o['label'] !== 'string') continue;
    out.push({ label: o['label'], layer: typeof o['layer'] === 'number' ? o['layer'] : 2 });
  }
  return out;
}

/**
 * Qué capa decidió. No está guardado como tal en el audit, así que se deriva de
 * lo que SÍ está, en el mismo orden en que corre el cascade: si hubo señal
 * definitiva ganó la capa 1; si se usó el modelo, la 5; si no, decidieron las
 * corroborantes (la capa más alta que aportó una señal).
 */
function capaQueDecidio(
  definitiveSignal: string | null,
  aiUsed: boolean,
  senales: { layer: number }[],
): string {
  if (definitiveSignal) return nombreDeCapa(1);
  if (aiUsed) return nombreDeCapa(5);
  if (senales.length > 0) return nombreDeCapa(Math.max(...senales.map((s) => s.layer)));
  return nombreDeCapa(4);
}

/**
 * Arma el bloque de procedencia de la versión vigente de un dato.
 *
 * Devuelve `null` —y la ficha no muestra sello— cuando:
 *   · la versión no entró con método 'ia_sugerido' (la cargó una persona), o
 *   · no tiene documento de origen, o
 *   · el documento no tiene clasificación registrada (no hay nada que contar).
 */
export async function buildAiProvenance(
  db: Pick<PrismaClient, 'dataEntry' | 'classificationAudit' | 'user'>,
  version: { method: string; dataEntryId: string | null } | null,
): Promise<AiProvenance | null> {
  if (!version || version.method !== 'ia_sugerido' || !version.dataEntryId) return null;

  const entry = await db.dataEntry.findUnique({
    where: { id: version.dataEntryId },
    select: { fileName: true, reviewedBy: true },
  });
  if (!entry) return null;

  const audit = await db.classificationAudit.findFirst({
    where: { dataEntryId: version.dataEntryId },
    orderBy: { createdAt: 'desc' },
  });
  if (!audit) return null;

  // QUIÉN CONFIRMÓ. Se lee del rastro, nunca se asume: `costaValidatedAt` dice
  // que alguien aprobó el documento, y `reviewedBy` de la entrada dice quién
  // fue. Sin `validatedByCostista` no hay nombre que mostrar aunque el
  // documento tenga un revisor anotado.
  let confirmadoPor: string | null = null;
  if (audit.validatedByCostista) {
    const quien = entry.reviewedBy ?? audit.costistId;
    const user = await db.user.findUnique({ where: { id: quien }, select: { name: true } });
    confirmadoPor = user?.name ?? null;
  }

  const senales = leerSenales(audit.corroboratingSignals);

  return {
    confirmado: audit.validatedByCostista,
    confirmadoPor,
    confirmadoEl: audit.costaValidatedAt ? audit.costaValidatedAt.toISOString() : null,
    corregidoPorPersona: audit.costaOverrode,
    confianza: confianzaCualitativa(audit.confidence),
    requiereRevision: audit.requiresReview,
    documento: {
      tipo: label(TIPO_DOC_LABEL, audit.documentType),
      seccion: label(SECCION_LABEL, audit.costSection),
      archivo: entry.fileName,
    },
    detalleTecnico: {
      capa: capaQueDecidio(audit.definitiveSignal, audit.aiUsed, senales),
      senalDeterminante: audit.definitiveSignal,
      senalesCorroborantes: senales.map((s) => s.label),
      calidadDeLectura: label(CALIDAD_LABEL, audit.qualityGate),
      usoModeloDeLenguaje: audit.aiUsed,
      explicacion: audit.explanation,
    },
  };
}
