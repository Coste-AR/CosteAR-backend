/**
 * Validación de esquema (Zod) para las respuestas JSON de Groq.
 *
 * `response_format: json_object` garantiza JSON SINTÁCTICO, no que los enums
 * (`documentType` / `costSection`) estén en rango ni que los importes sean
 * números. Sin esto, un enum fuera de rango o un `netAmount` que llega como
 * string se propaga silencioso por todo el pipeline (§3.4 de la auditoría del
 * clasificador — "cero errores silenciosos").
 *
 * Este módulo expone:
 *  - Los esquemas de ambas respuestas (analyzeDocument / classifyDocument).
 *  - `describeZodIssues`: convierte los errores en una pista concreta para el
 *    reintento guiado ("costSection = 'X' no es válido, debe ser uno de …").
 *  - `salvage*` / `fallback*`: recuperación de datos válidos o resultado seguro
 *    marcado para revisión humana, para no perder el análisis.
 */

import { z } from 'zod';
import type { DocumentAnalysis, ClassifyResponse } from './groq-service.js';
import type { CostitaChatResponse } from './groq-costista-chat.js';

// ── Enums (fuente de verdad de los valores aceptados) ──────────────────────

/** Tipos que devuelve `analyzeDocument` (prompt de extracción, en minúsculas). */
export const ANALYZE_DOC_TYPES = [
  'factura_compra', 'factura_venta', 'liquidacion_sueldos',
  'planilla_horas', 'datos_costeo', 'otro',
] as const;

/** Tipos que devuelve `classifyDocument` (Layer 5, en mayúsculas). Coincide
 *  con VALID_DOC_TYPES de layer5-ai-fallback.ts. */
export const CLASSIFY_DOC_TYPES = [
  'FACTURA_COMPRA', 'FACTURA_VENTA', 'REMITO', 'LIQUIDACION_MOD',
  'PLANILLA_HORAS', 'NOTA_DEBITO', 'NOTA_CREDITO', 'DESCONOCIDO',
] as const;

/** Secciones de costo/gasto — incluye las categorías GASTO_* agregadas antes.
 *  Coincide con el type CostSection y con VALID_SECTIONS de Layer 5. */
export const COST_SECTIONS = [
  'MATERIA_PRIMA', 'MANO_DE_OBRA', 'COSTOS_INDIRECTOS', 'VENTAS',
  'GASTO_COMERCIALIZACION', 'GASTO_ADMINISTRACION', 'GASTO_FINANCIERO',
  'MULTIPLE', 'DESCONOCIDO',
] as const;

const QUALITY = ['legible', 'parcial', 'ilegible'] as const;

/** Acciones que puede proponer el chat del costista. Coincide con el type
 *  ChatActionType de groq-costista-chat.ts. */
export const CHAT_ACTION_TYPES = [
  'CREATE_ENTRY', 'CREATE_ALERT', 'INFO_ONLY', 'VAULT_QUESTION',
] as const;

/** Severidad de una alerta propuesta. Coincide con ProposedAlert['severity'].
 *  costista-chat-service.ts la mapea a un AlertType de Prisma. */
export const ALERT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;

/** Secciones que acepta `proposedEntry`. Es COST_SECTIONS SIN 'MULTIPLE': una
 *  entrada manual del chat va a una sección concreta, y el type ProposedEntry
 *  tampoco lo admite. Se enumera aparte en vez de derivarlo con un filter para
 *  que el tuple quede literal y z.enum infiera la unión exacta. */
export const CHAT_COST_SECTIONS = [
  'MATERIA_PRIMA', 'MANO_DE_OBRA', 'COSTOS_INDIRECTOS', 'VENTAS',
  'GASTO_COMERCIALIZACION', 'GASTO_ADMINISTRACION', 'GASTO_FINANCIERO',
  'DESCONOCIDO',
] as const;

// ── Piezas reutilizables ───────────────────────────────────────────────────

/** Campo numérico: rechaza strings/booleans que el modo json_object todavía
 *  puede dejar pasar. Acepta null (el prompt usa null para "ausente").
 *
 *  `.finite()` cierra el invariante para quien reutilice estos esquemas sobre
 *  objetos ya en memoria: por el camino de Groq es inalcanzable (JSON.parse
 *  nunca produce Infinity/NaN), pero deja el esquema autosuficiente en vez de
 *  depender de por dónde entró el dato.
 *
 *  NO se acota el signo de los importes a propósito: una nota de crédito o un
 *  ajuste traen importes legítimamente negativos. */
const nullableNumber = z.number().finite('debe ser un número finito (ni Infinity ni NaN).').nullable().optional();

/** Magnitud que no puede ser negativa por definición (horas trabajadas,
 *  dotación). Un valor negativo acá se propaga al cálculo de MOD. */
const nullableNonNegative = z
  .number()
  .finite('debe ser un número finito (ni Infinity ni NaN).')
  .min(0, 'no puede ser negativo.')
  .nullable()
  .optional();

const nullableString = z.string().nullable().optional();

const extractedItemSchema = z.object({
  description: z.string(),
  quantity: nullableNumber,
  unitCost: nullableNumber,
  total: nullableNumber,
}).passthrough();

/** Tope defensivo de ítems por documento. `max_tokens: 2500` ya hace inviable
 *  una lista mucho más larga; el tope evita que una respuesta degenerada
 *  infle el JSON que se persiste en `extractedData`. */
const MAX_EXTRACTED_ITEMS = 200;

// Solo se valida a fondo lo que importa a §3.4: los importes deben ser números.
// El resto se deja laxo (passthrough) para no rechazar respuestas por variación
// legítima de campos opcionales.
const extractedDataSchema = z.object({
  date: nullableString,
  supplier: nullableString,
  invoiceNumber: nullableString,
  totalAmount: nullableNumber,
  taxAmount: nullableNumber,
  netAmount: nullableNumber,
  currency: nullableString,
  items: z.array(extractedItemSchema).max(MAX_EXTRACTED_ITEMS, `no puede tener más de ${MAX_EXTRACTED_ITEMS} ítems.`).optional(),
  department: nullableString,
  role: nullableString,
  hoursWorked: nullableNonNegative,
  employeeCount: nullableNonNegative,
}).passthrough();

// ── Esquemas de respuesta ──────────────────────────────────────────────────

export const documentAnalysisSchema = z.object({
  documentType: z.enum(ANALYZE_DOC_TYPES),
  quality: z.enum(QUALITY),
  qualityNote: nullableString,
  costSection: z.enum(COST_SECTIONS),
  message: z.string(),
  // extractedData es opcional (un doc ilegible puede omitirlo) pero, si viene,
  // sus importes se validan como números.
  extractedData: extractedDataSchema.optional(),
  // `sections` es profundamente anidado y muy variable; se valida laxo
  // (presencia + passthrough). La preocupación de §3.4 son los enums de nivel
  // superior y los importes, no la estructura interna de cada sección.
  sections: z.record(z.unknown()).optional(),
}).passthrough();

export const classifyResponseSchema = z.object({
  documentType: z.enum(CLASSIFY_DOC_TYPES),
  costSection: z.enum(COST_SECTIONS),
  // El prompt pide "número 0-100". Sin el rango, un `confidence: 999` validaba
  // limpio y el único freno era el clamp de Layer 5 (layer5-ai-fallback.ts):
  // el esquema tiene que ser la barrera, no un refuerzo opcional. El clamp
  // downstream SE MANTIENE como defensa en profundidad.
  confidence: z
    .number()
    .finite('debe ser un número finito (ni Infinity ni NaN).')
    .min(0, 'debe estar entre 0 y 100.')
    .max(100, 'debe estar entre 0 y 100.'),
  reasoning: z.string(),
}).passthrough();

// ── Chat del costista ──────────────────────────────────────────────────────

/** El prompt del chat pide explícitamente `null` para los campos ausentes
 *  ("proposedEntry": null), pero las interfaces los declaran opcionales. Se
 *  acepta null y se normaliza a undefined para no arrastrar los dos vacíos. */
const chatOptionalString = z.string().nullish().transform((v) => v ?? undefined);

const proposedEntrySchema = z.object({
  companyId: z.string(),
  companyName: z.string(),
  rawContent: z.string(),
  costSection: z.enum(CHAT_COST_SECTIONS),
  documentType: z.string(),
  estimatedImpact: chatOptionalString,
}).passthrough();

const proposedAlertSchema = z.object({
  companyId: z.string(),
  companyName: z.string(),
  message: z.string(),
  severity: z.enum(ALERT_SEVERITIES),
}).passthrough();

/**
 * Respuesta del chat del costista (`GroqCostitaChat.interpret`).
 *
 * Este era el único call site de Groq del repo que hacía un cast a ciegas:
 * `actionType` llegaba al frontend sin comprobar, y `confidence` — documentada
 * "0-100" y mostrada al costista — no tenía ni validación ni clamp en ningún
 * punto del camino (a diferencia de la del clasificador, que sí se clampea en
 * layer5-ai-fallback.ts). Un `confidence: 999` o un `actionType` inventado
 * viajaban intactos hasta la UI.
 *
 * `proposedEntry.companyId` NO se valida acá contra la cartera: esa sanitización
 * (rechazar una empresa que no es del costista) necesita el portfolio y se
 * mantiene en `interpret()`, después del parseo.
 */
export const costitaChatResponseSchema = z.object({
  reply: z.string(),
  actionType: z.enum(CHAT_ACTION_TYPES),
  confidence: z
    .number()
    .finite('debe ser un número finito (ni Infinity ni NaN).')
    .min(0, 'debe estar entre 0 y 100.')
    .max(100, 'debe estar entre 0 y 100.'),
  proposedEntry: proposedEntrySchema.nullish().transform((v) => v ?? undefined),
  proposedAlert: proposedAlertSchema.nullish().transform((v) => v ?? undefined),
}).passthrough();

/**
 * CLAMP de `confidence` (0-100).
 *
 * El esquema RECHAZA un valor fuera de rango; esto es lo que lo convierte en un
 * valor usable en vez de tirar la respuesta entera. Un `confidence: 999` no
 * invalida el consejo que el chat acaba de dar: invalida el número que lo
 * acompaña, y para ese número hay una respuesta correcta y evidente (el borde
 * del rango). Lo que NO se hace es inventar: si no es un número finito, es 0.
 */
function clampConfidence(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

/**
 * Salvataje de la respuesta del chat, análogo a `salvageClassifyResponse`.
 *
 * POR QUÉ EXISTE. Sin esto, el único camino ante una respuesta inválida era el
 * fallback genérico ("Por el momento no puedo interpretar eso"), o sea que un
 * `confidence: 120` en una respuesta por lo demás perfecta le borraba al costista
 * una explicación correcta y útil. Eso es tirar una respuesta usable por un campo
 * accesorio — justo lo que el salvataje del clasificador ya evitaba del otro lado.
 *
 * SOLO SE SALVA `confidence`, Y ES DELIBERADO. Es el único campo accesorio: es
 * un adorno del `reply`, no lo que el `reply` dice. Los otros NO se neutralizan
 * aunque técnicamente se podría, porque están ACOPLADOS AL TEXTO:
 *  · un `actionType` inventado bajado a 'INFO_ONLY' dejaría un `reply` que le
 *    anuncia al costista una acción ("te propongo registrar…") que ya no viene
 *    con la tarjeta para confirmarla;
 *  · descartar un `proposedEntry`/`proposedAlert` inválido tiene el mismo
 *    problema, y dejarlo con su `actionType` es peor todavía: `confirmAction`
 *    tira un Error si la acción no trae payload, o sea una tarjeta que explota
 *    al confirmarla.
 * En esos casos el texto ya no se sostiene solo, así que la respuesta entera va
 * al fallback. Lo mismo si lo que falla es `reply`, que ES la respuesta.
 *
 * A diferencia del clasificador, acá NO hay reintento guiado: ver la nota de
 * `fallbackCostitaChatResponse`. El salvataje sí corresponde porque no cuesta un
 * segundo round-trip — es aritmética sobre la respuesta que ya llegó.
 */
export function salvageCostitaChatResponse(
  raw: unknown,
  issues: z.ZodIssue[],
): CostitaChatResponse | null {
  if (raw == null || typeof raw !== 'object') return null;
  const clone = { ...(raw as Record<string, unknown>) };

  for (const iss of issues) {
    if (iss.path.length !== 1 || iss.path[0] !== 'confidence') return null;
    clone.confidence = clampConfidence(clone.confidence);
  }

  const re = costitaChatResponseSchema.safeParse(clone);
  if (!re.success) return null;
  return re.data as CostitaChatResponse;
}

/**
 * Resultado seguro cuando la respuesta del chat no valida — la misma forma que
 * ya usa costista-chat-service.ts cuando la IA no está disponible, así el
 * costista ve un mensaje conocido en vez de un dato sin validar.
 *
 * Es el último recurso: primero se intenta `salvageCostitaChatResponse`. A
 * diferencia del clasificador, acá NO hay reintento guiado:
 *  - El chat es interactivo y sincrónico; un segundo round-trip duplica la
 *    latencia de la respuesta justo en el camino que ya salió mal.
 *  - Es el call site de Groq de mayor volumen (uno por mensaje), y la cuota se
 *    comparte con el pipeline de documentos, que sí la necesita.
 *  - El costo de fallar es una respuesta conversacional que el costista puede
 *    reintentar reformulando; el del clasificador es un dato contable
 *    persistido en silencio. Distinto riesgo, distinta maquinaria.
 */
export function fallbackCostitaChatResponse(): CostitaChatResponse {
  return {
    reply: 'Por el momento no puedo interpretar eso. Probá con otra consulta.',
    actionType: 'INFO_ONLY',
    confidence: 0,
  };
}

// ── Pista para el reintento guiado ─────────────────────────────────────────

/**
 * Traduce los errores de Zod a instrucciones concretas de corrección, para que
 * el modelo sepa QUÉ arreglar en el reintento en vez de reenviar el mismo
 * prompt a ciegas.
 */
export function describeZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((iss) => {
      const field = iss.path.join('.') || '(raíz)';
      if (iss.code === 'invalid_enum_value') {
        const opts = iss.options.map((o) => JSON.stringify(o)).join(', ');
        return `El campo "${field}" tenía el valor ${JSON.stringify(iss.received)}, que NO es un valor válido. Debe ser EXACTAMENTE uno de: [${opts}].`;
      }
      if (iss.code === 'invalid_type') {
        return `El campo "${field}" debe ser de tipo ${iss.expected}, pero enviaste un ${iss.received}. Devolvé un ${iss.expected} real (los importes van como número, sin comillas).`;
      }
      return `El campo "${field}" es inválido: ${iss.message}.`;
    })
    .join('\n');
}

// ── Salvataje de campos válidos (§4 del pedido) ─────────────────────────────

/** Setea `null` en un leaf de un objeto siguiendo un path de Zod. */
function nullifyPath(obj: Record<string, unknown>, path: (string | number)[]): void {
  let cur: unknown = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (cur == null || typeof cur !== 'object') return;
    cur = (cur as Record<string, unknown>)[path[i] as string];
  }
  if (cur != null && typeof cur === 'object') {
    (cur as Record<string, unknown>)[path[path.length - 1] as string] = null;
  }
}

const REVIEW_NOTE = '[Auto] Campos inválidos en la respuesta de la IA: se anularon/normalizaron y el documento quedó marcado para revisión humana.';

/**
 * Intenta salvar una respuesta de `analyzeDocument` cuando SOLO fallan campos
 * localizados y seguros de neutralizar (enums de nivel superior o importes de
 * extractedData). Anula/normaliza esos campos, re-valida y marca requiresReview.
 * Si hay un error que no sabemos neutralizar sin riesgo → devuelve null (el
 * caller usa el fallback completo).
 */
export function salvageDocumentAnalysis(
  raw: unknown,
  issues: z.ZodIssue[],
): DocumentAnalysis | null {
  if (raw == null || typeof raw !== 'object') return null;
  const clone = structuredClone(raw) as Record<string, unknown>;

  for (const iss of issues) {
    const p = iss.path;
    if (p.length === 1 && p[0] === 'costSection') {
      clone.costSection = 'DESCONOCIDO';
    } else if (p.length === 1 && p[0] === 'documentType') {
      clone.documentType = 'otro';
    } else if (p.length === 1 && p[0] === 'quality') {
      clone.quality = 'parcial';
    } else if (p.length === 2 && p[0] === 'extractedData' && p[1] === 'items') {
      // Lista degenerada (supera el tope). `items` es opcional, así que la
      // descartamos entera en vez de anularla (null no valida) y conservamos
      // el resto de la extracción; queda marcado para revisión humana.
      const ed = clone.extractedData;
      if (ed != null && typeof ed === 'object') delete (ed as Record<string, unknown>).items;
    } else if (p[0] === 'extractedData' && p.length >= 2) {
      // Importe/campo suelto inválido → lo anulamos, el resto se conserva.
      nullifyPath(clone, p);
    } else {
      return null; // error estructural: no arriesgamos, va al fallback completo.
    }
  }

  const re = documentAnalysisSchema.safeParse(clone);
  if (!re.success) return null;

  const salvaged = re.data as DocumentAnalysis;
  salvaged.requiresReview = true;
  salvaged.qualityNote = [salvaged.qualityNote, REVIEW_NOTE].filter(Boolean).join(' ');
  return salvaged;
}

/**
 * Salvataje análogo para `classifyDocument` (respuesta chica de 4 campos).
 */
export function salvageClassifyResponse(
  raw: unknown,
  issues: z.ZodIssue[],
): ClassifyResponse | null {
  if (raw == null || typeof raw !== 'object') return null;
  const clone = { ...(raw as Record<string, unknown>) };

  for (const iss of issues) {
    if (iss.path.length !== 1) return null;
    const key = iss.path[0];
    if (key === 'documentType') clone.documentType = 'DESCONOCIDO';
    else if (key === 'costSection') clone.costSection = 'DESCONOCIDO';
    else if (key === 'confidence') clone.confidence = 0;
    else if (key === 'reasoning') clone.reasoning = String((raw as Record<string, unknown>).reasoning ?? '');
    else return null;
  }

  const re = classifyResponseSchema.safeParse(clone);
  if (!re.success) return null;
  return { ...re.data, requiresReview: true };
}

// ── Resultados de fallback seguro (§3 del pedido) ───────────────────────────

/**
 * Resultado seguro cuando la respuesta de `analyzeDocument` no valida ni siquiera
 * tras el reintento. No devolvemos null (perderíamos el análisis): el documento
 * se guarda con costSection DESCONOCIDO y requiresReview → lo revisa un humano.
 *
 * Nota: el enum de `documentType` de analyzeDocument no incluye 'DESCONOCIDO'
 * (sus valores son minúsculas: factura_compra … otro); 'otro' es su catch-all
 * equivalente. costSection sí usa 'DESCONOCIDO'.
 */
export function fallbackDocumentAnalysis(): DocumentAnalysis {
  return {
    documentType: 'otro',
    quality: 'parcial',
    qualityNote: '[Auto] La IA devolvió una respuesta inválida incluso tras el reintento guiado; el documento se guardó y quedó pendiente de revisión humana.',
    costSection: 'DESCONOCIDO',
    message: 'No se pudo validar automáticamente la respuesta de la IA. El documento se guardó igual y quedó pendiente de revisión.',
    extractedData: {},
    requiresReview: true,
  };
}

/**
 * Resultado seguro análogo para `classifyDocument` (Layer 5).
 * confidence 0 + DESCONOCIDO garantiza que la cascada lo rutee a revisión.
 */
export function fallbackClassifyResponse(): ClassifyResponse {
  return {
    documentType: 'DESCONOCIDO',
    costSection: 'DESCONOCIDO',
    confidence: 0,
    reasoning: 'La IA devolvió una respuesta inválida tras el reintento guiado; se deriva a revisión humana.',
    requiresReview: true,
  };
}
