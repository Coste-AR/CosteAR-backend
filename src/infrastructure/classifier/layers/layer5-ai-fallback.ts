// src/infrastructure/classifier/layers/layer5-ai-fallback.ts
import { GroqClassifier } from '../../ai/groq-classifier.js';
import { createClassifierAiClient } from '../classifier-ai-client.js';
import type { DocumentType, CostSection } from '../types.js';

let classifierAi: GroqClassifier | null = null;
let classifierAiInitFailed = false;

function getClassifierAi(): GroqClassifier | null {
  if (classifierAiInitFailed) return null;
  if (!classifierAi) {
    try {
      classifierAi = new GroqClassifier(createClassifierAiClient());
    } catch {
      classifierAiInitFailed = true;
      return null;
    }
  }
  return classifierAi;
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
  'MATERIA_PRIMA', 'MANO_DE_OBRA', 'COSTOS_INDIRECTOS', 'VENTAS',
  'GASTO_COMERCIALIZACION', 'GASTO_ADMINISTRACION', 'GASTO_FINANCIERO',
  'MULTIPLE', 'DESCONOCIDO',
]);

/**
 * Layer 5: fallback de IA configurable (Groq o DeepSeek).
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
  const service = getClassifierAi();
  if (!service) return null;
  const raw = await service.classifyDocument(input);
  if (!raw) return null;

  // Si el proveedor devuelve un tipo o sección fuera del set válido, lo tratamos como
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
