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

// ── Piezas reutilizables ───────────────────────────────────────────────────

/** Campo numérico: rechaza strings/booleans que el modo json_object todavía
 *  puede dejar pasar. Acepta null (el prompt usa null para "ausente"). */
const nullableNumber = z.number().nullable().optional();
const nullableString = z.string().nullable().optional();

const extractedItemSchema = z.object({
  description: z.string(),
  quantity: nullableNumber,
  unitCost: nullableNumber,
  total: nullableNumber,
}).passthrough();

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
  items: z.array(extractedItemSchema).optional(),
  department: nullableString,
  role: nullableString,
  hoursWorked: nullableNumber,
  employeeCount: nullableNumber,
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
  confidence: z.number(),
  reasoning: z.string(),
}).passthrough();

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
