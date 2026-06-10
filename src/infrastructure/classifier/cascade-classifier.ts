// src/infrastructure/classifier/cascade-classifier.ts
import { runQualityGate } from './layers/layer0-quality-gate.js';
import { detectIntent }   from './layers/layer0a-intent-detection.js';
import { runLayer1 }      from './layers/layer1-definitive-signals.js';
import { runLayer2 }      from './layers/layer2-corroborating-signals.js';
import { runLayer3 }      from './layers/layer3-numeric-validation.js';
import { runLayer4 }      from './layers/layer4-business-routing.js';
import { runLayer5 }      from './layers/layer5-ai-fallback.js';
import { categorizeIndustry, getIndustryProfile } from './industry/industry-profile.js';
import type { ClassifierInput, ClassificationResult, DocumentType, CostSection, InputIntent, IndustryCategory } from './types.js';
import { prisma } from '../database/prisma.js';

const CONFIDENCE_THRESHOLD = 72;

/**
 * Genera una explicación legible para el costista sobre por qué
 * el sistema clasificó el documento de determinada manera.
 */
function buildExplanation(params: {
  intent: InputIntent;
  documentType: DocumentType;
  costSection: CostSection;
  confidence: number;
  definitiveSignal: string | null;
  l4Reasoning: string;
  aiUsed: boolean;
  supplierFingerprintUsed: boolean;
  requiresReview: boolean;
  industryCategory: IndustryCategory;
  industryLabel: string;
  signalCount: number;
}): string {
  const {
    intent, documentType, costSection, confidence,
    definitiveSignal, l4Reasoning, aiUsed,
    supplierFingerprintUsed, requiresReview,
    industryCategory, industryLabel, signalCount,
  } = params;

  const parts: string[] = [];

  // Contexto de intención
  const intentLabels: Partial<Record<InputIntent, string>> = {
    EVENTO_NEGOCIO:        '⚠️ Esto parece un evento de negocio, no un documento formal.',
    PERDIDA_INVENTARIO:    '⚠️ Esto parece una pérdida de inventario.',
    EVENTO_LABORAL:        'ℹ️ Esto parece un evento laboral.',
    ACTUALIZACION_PRECIO:  'ℹ️ Esto parece una actualización de precios de proveedor.',
    CORRECCION:            'ℹ️ Esto parece una corrección de una entrada anterior.',
    CONSULTA:              'ℹ️ Esto parece una consulta, no un documento.',
    DOCUMENTO_INFORMAL:    'ℹ️ El operario describió un documento con texto libre.',
  };
  if (intentLabels[intent]) parts.push(intentLabels[intent]!);

  // Qué fue detectado
  if (definitiveSignal) {
    parts.push(`Señal definitiva: ${definitiveSignal}.`);
  } else if (signalCount > 0) {
    parts.push(`Se detectaron ${signalCount} señal${signalCount > 1 ? 'es' : ''} que apuntan a este tipo.`);
  }

  // Routing de sección de costos
  if (l4Reasoning) {
    parts.push(l4Reasoning + '.');
  }

  // Rubro
  if (industryCategory !== 'DEFAULT') {
    parts.push(`Rubro considerado: ${industryLabel}.`);
  }

  // Quién clasificó
  if (supplierFingerprintUsed) {
    parts.push('Proveedor reconocido por historial de validaciones anteriores.');
  }
  if (aiUsed) {
    parts.push('Clasificación asistida por inteligencia artificial (Groq).');
  }

  // Confianza
  parts.push(`Confianza: ${confidence}%.`);

  if (requiresReview) {
    parts.push('La confianza es baja → requiere tu revisión antes de aplicar.');
  }

  return parts.join(' ');
}

/**
 * Cascade classifier — v2.
 *
 * Novedades vs v1:
 * - Layer 0A: detección de intención (evento de negocio, pérdida, consulta, etc.)
 * - Industry-aware Layer 4: routing según rubro de la empresa
 * - Layer 5 con contexto de rubro e intención
 * - Layer 4 se aplica DESPUÉS de Layer 5 para validar costSection
 * - enrichedText: usa el OCR de Groq para clasificar imágenes correctamente
 * - Explicación legible para el costista
 */
export async function classifyDocument(input: ClassifierInput & {
  groqQuality?: 'legible' | 'parcial' | 'ilegible' | null;
}): Promise<ClassificationResult> {

  const sourceType = input.sourceType ?? 'TEXT';

  // ── Categoría de industria ─────────────────────────────────────────────────
  const industryCategory: IndustryCategory = categorizeIndustry(input.industry);
  const industryProfile  = getIndustryProfile(industryCategory);

  // ── Texto efectivo para clasificar ────────────────────────────────────────
  // Si hay texto enriquecido (de Groq OCR), lo usamos. Si no, el rawContent.
  const text = (input.enrichedText && input.enrichedText.trim().length > 10)
    ? input.enrichedText
    : input.text;

  // ── Layer 0A: Detección de intención ──────────────────────────────────────
  const intentResult = detectIntent(text, sourceType, industryProfile);
  const intent: InputIntent = intentResult.intent;

  // ── Layer 0: Quality Gate ──────────────────────────────────────────────────
  const qualityResult = runQualityGate({ quality: input.groqQuality ?? null, text });

  if (qualityResult.gate === 'FAIL') {
    return {
      documentType: 'DESCONOCIDO',
      costSection:  'DESCONOCIDO',
      confidence:   0,
      requiresReview: true,
      isDuplicate:  false,
      qualityGate:  'FAIL',
      definitiveSignal: null,
      signals: [],
      aiUsed: false,
      supplierFingerprintUsed: false,
      confidenceCap: null,
      intent,
      industryCategory,
      explanation: 'El documento es ilegible. No se puede determinar su tipo ni contenido. Por favor reenviá una imagen más clara.',
    };
  }

  const confidenceCap = qualityResult.confidenceCap;

  // ── Supplier Fingerprint Lookup ────────────────────────────────────────────
  let supplierFingerprintUsed = false;
  let fingerprintBonus = 0;

  if (input.supplierCuit) {
    try {
      // Buscar primero por companyId (específico) y luego genérico
      const fp = await prisma.supplierFingerprint.findFirst({
        where: {
          costistId:    input.costistId,
          supplierCuit: input.supplierCuit,
          companyId:    input.companyId,
        },
      });
      if (fp && fp.timesSeenCorrect >= 3) {
        supplierFingerprintUsed = true;
        fingerprintBonus = fp.confidenceBonus;
      }
    } catch {
      // DB lookup failure es no-fatal
    }
  }

  // ── Layer 1: Definitive Signals ────────────────────────────────────────────
  const layer1 = runLayer1(text);

  if (layer1) {
    let confidence = confidenceCap !== null
      ? Math.min(layer1.confidence, confidenceCap)
      : layer1.confidence;
    confidence = Math.min(confidence + fingerprintBonus, confidenceCap ?? 100);

    const l4 = runLayer4(layer1.documentType, text, industryCategory);

    if (confidence >= CONFIDENCE_THRESHOLD && !l4.requiresAI) {
      return {
        documentType: layer1.documentType as DocumentType,
        costSection:  l4.costSection,
        confidence,
        requiresReview: false,
        isDuplicate:  false,
        qualityGate:  qualityResult.gate,
        definitiveSignal: layer1.label,
        signals: [{ label: layer1.label, pts: layer1.confidence, type: layer1.documentType, layer: 1 }],
        aiUsed: false,
        supplierFingerprintUsed,
        confidenceCap,
        intent,
        industryCategory,
        explanation: buildExplanation({
          intent, documentType: layer1.documentType as DocumentType,
          costSection: l4.costSection, confidence,
          definitiveSignal: layer1.label, l4Reasoning: l4.reasoning,
          aiUsed: false, supplierFingerprintUsed, requiresReview: false,
          industryCategory, industryLabel: industryProfile.label, signalCount: 1,
        }),
      };
    }

    // Layer 1 encontró doc type pero Layer 4 necesita IA para el cost section
    if (l4.requiresAI && confidence >= CONFIDENCE_THRESHOLD) {
      const aiResult = await runLayer5({
        text,
        accumulatedPts: confidence,
        foundSignalLabels: [layer1.label],
        suggestedType: layer1.documentType,
        industryLabel: industryProfile.label,
        industryCategory,
        intent,
      });

      if (aiResult) {
        // Aplicar Layer 4 sobre la sección que sugirió Groq para validar con rubro
        const l4check = runLayer4(layer1.documentType, text, industryCategory);
        const finalSection = (!l4check.requiresAI) ? l4check.costSection : aiResult.costSection as CostSection;
        const finalConf = confidenceCap !== null ? Math.min(aiResult.confidence, confidenceCap) : aiResult.confidence;

        return {
          documentType: layer1.documentType as DocumentType,
          costSection:  finalSection,
          confidence:   finalConf,
          requiresReview: finalConf < CONFIDENCE_THRESHOLD,
          isDuplicate:  false,
          qualityGate:  qualityResult.gate,
          definitiveSignal: layer1.label,
          signals: [{ label: layer1.label, pts: layer1.confidence, type: layer1.documentType, layer: 1 }],
          aiUsed: true,
          supplierFingerprintUsed,
          confidenceCap,
          intent,
          industryCategory,
          explanation: buildExplanation({
            intent, documentType: layer1.documentType as DocumentType,
            costSection: finalSection, confidence: finalConf,
            definitiveSignal: layer1.label, l4Reasoning: aiResult.reasoning,
            aiUsed: true, supplierFingerprintUsed, requiresReview: finalConf < CONFIDENCE_THRESHOLD,
            industryCategory, industryLabel: industryProfile.label, signalCount: 1,
          }),
        };
      }
    }
  }

  // ── Layers 2-3: Corroborating + Numeric ───────────────────────────────────
  const layer1Labels = layer1 ? [layer1.label] : [];
  const layer2       = runLayer2(text, layer1Labels);
  const layer3Delta  = runLayer3(text);

  let accumulatedPts = layer2.totalPts + layer3Delta;
  const suggestedType = layer2.winningType ?? (layer1?.documentType ?? null);

  if (confidenceCap !== null) {
    accumulatedPts = Math.min(accumulatedPts, confidenceCap);
  }

  const allSignals = [
    ...(layer1 ? [{ label: layer1.label, pts: layer1.confidence, type: layer1.documentType, layer: 1 as const }] : []),
    ...layer2.signals,
  ];

  // ── Layer 4: Business Routing ──────────────────────────────────────────────
  const l4 = runLayer4(suggestedType ?? 'DESCONOCIDO', text, industryCategory);

  if (accumulatedPts >= CONFIDENCE_THRESHOLD && !l4.requiresAI) {
    return {
      documentType: (suggestedType ?? 'DESCONOCIDO') as DocumentType,
      costSection:  l4.costSection,
      confidence:   Math.min(accumulatedPts, 100),
      requiresReview: false,
      isDuplicate:  false,
      qualityGate:  qualityResult.gate,
      definitiveSignal: layer1?.label ?? null,
      signals: allSignals,
      aiUsed: false,
      supplierFingerprintUsed,
      confidenceCap,
      intent,
      industryCategory,
      explanation: buildExplanation({
        intent, documentType: (suggestedType ?? 'DESCONOCIDO') as DocumentType,
        costSection: l4.costSection, confidence: Math.min(accumulatedPts, 100),
        definitiveSignal: layer1?.label ?? null, l4Reasoning: l4.reasoning,
        aiUsed: false, supplierFingerprintUsed, requiresReview: false,
        industryCategory, industryLabel: industryProfile.label, signalCount: allSignals.length,
      }),
    };
  }

  // ── Layer 5: AI Fallback ───────────────────────────────────────────────────
  const foundLabels = allSignals.map((s) => s.label);
  const aiResult = await runLayer5({
    text,
    accumulatedPts,
    foundSignalLabels: foundLabels,
    suggestedType,
    industryLabel: industryProfile.label,
    industryCategory,
    intent,
  });

  if (aiResult) {
    // Aplicar Layer 4 con rubro sobre lo que dijo Groq (costSection puede corregirse)
    const l4afterAI = runLayer4(aiResult.documentType, text, industryCategory);
    const finalSection: CostSection = (!l4afterAI.requiresAI)
      ? l4afterAI.costSection
      : aiResult.costSection as CostSection;

    const finalConf = confidenceCap !== null
      ? Math.min(aiResult.confidence, confidenceCap)
      : aiResult.confidence;

    return {
      documentType: aiResult.documentType as DocumentType,
      costSection:  finalSection,
      confidence:   finalConf,
      requiresReview: finalConf < CONFIDENCE_THRESHOLD,
      isDuplicate:  false,
      qualityGate:  qualityResult.gate,
      definitiveSignal: layer1?.label ?? null,
      signals: allSignals,
      aiUsed: true,
      supplierFingerprintUsed,
      confidenceCap,
      intent,
      industryCategory,
      explanation: buildExplanation({
        intent, documentType: aiResult.documentType as DocumentType,
        costSection: finalSection, confidence: finalConf,
        definitiveSignal: layer1?.label ?? null, l4Reasoning: aiResult.reasoning,
        aiUsed: true, supplierFingerprintUsed, requiresReview: finalConf < CONFIDENCE_THRESHOLD,
        industryCategory, industryLabel: industryProfile.label, signalCount: allSignals.length,
      }),
    };
  }

  // ── Layer 6: Human Escalation ──────────────────────────────────────────────
  return {
    documentType: (suggestedType ?? 'DESCONOCIDO') as DocumentType,
    costSection:  l4.costSection,
    confidence:   Math.min(accumulatedPts, 71),
    requiresReview: true,
    isDuplicate:  false,
    qualityGate:  qualityResult.gate,
    definitiveSignal: layer1?.label ?? null,
    signals: allSignals,
    aiUsed: false,
    supplierFingerprintUsed,
    confidenceCap,
    intent,
    industryCategory,
    explanation: buildExplanation({
      intent, documentType: (suggestedType ?? 'DESCONOCIDO') as DocumentType,
      costSection: l4.costSection, confidence: Math.min(accumulatedPts, 71),
      definitiveSignal: layer1?.label ?? null, l4Reasoning: l4.reasoning,
      aiUsed: false, supplierFingerprintUsed, requiresReview: true,
      industryCategory, industryLabel: industryProfile.label, signalCount: allSignals.length,
    }),
  };
}
