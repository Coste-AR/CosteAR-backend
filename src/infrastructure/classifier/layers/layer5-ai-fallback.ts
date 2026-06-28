// src/infrastructure/classifier/layers/layer5-ai-fallback.ts
import { GroqService } from '../../ai/groq-service.js';
import type { DocumentType, CostSection } from '../types.js';

let groq: GroqService | null = null;
let groqInitFailed = false;

function getGroq(): GroqService | null {
  if (groqInitFailed) return null;
  if (!groq) {
    try {
      groq = new GroqService();
    } catch {
      groqInitFailed = true;
      return null;
    }
  }
  return groq;
}

export interface Layer5Result {
  documentType: DocumentType;
  costSection: CostSection;
  confidence: number;
  reasoning: string;
}

const VALID_DOC_TYPES = new Set<string>([
  'FACTURA_COMPRA', 'FACTURA_VENTA', 'REMITO', 'LIQUIDACION_MOD',
  'PLANILLA_HORAS', 'NOTA_DEBITO', 'NOTA_CREDITO', 'DESCONOCIDO',
]);

const VALID_SECTIONS = new Set<string>([
  'MATERIA_PRIMA', 'MANO_DE_OBRA', 'COSTOS_INDIRECTOS', 'VENTAS', 'MULTIPLE', 'DESCONOCIDO',
]);

/**
 * Layer 5: Groq AI Fallback.
 * Only called when accumulated confidence < 72 after layers 0-4.
 * Returns null if the API is unavailable.
 */
export async function runLayer5(input: {
  text: string;
  accumulatedPts: number;
  foundSignalLabels: string[];
  suggestedType: string | null;
  industryLabel?: string;
  industryCategory?: string;
  intent?: string;
  /** Pista de desempate cuando las reglas dejaron dos candidatos peleados. */
  ambiguityHint?: string;
  /** Ejemplos few-shot de correcciones previas del costista (memoria). */
  correctionExamples?: string;
}): Promise<Layer5Result | null> {
  const service = getGroq();
  if (!service) return null;
  const raw = await service.classifyDocument(input);
  if (!raw) return null;

  // Si Groq devuelve un tipo o sección fuera del set válido, lo tratamos como
  // DESCONOCIDO (más abajo) — nunca inventamos una categoría que no existe.

  const documentType = VALID_DOC_TYPES.has(raw.documentType)
    ? (raw.documentType as DocumentType)
    : 'DESCONOCIDO';

  const costSection = VALID_SECTIONS.has(raw.costSection)
    ? (raw.costSection as CostSection)
    : 'DESCONOCIDO';

  const confidence = Math.min(100, Math.max(0, Math.round(raw.confidence)));

  return { documentType, costSection, confidence, reasoning: raw.reasoning };
}
