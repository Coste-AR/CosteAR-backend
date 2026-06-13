// src/infrastructure/classifier/cascade-classifier.ts
import { runQualityGate, PARTIAL_CONFIDENCE_CAP } from './layers/layer0-quality-gate.js';
import { detectIntent }   from './layers/layer0a-intent-detection.js';
import { runLayer1 }      from './layers/layer1-definitive-signals.js';
import { runLayer2 }      from './layers/layer2-corroborating-signals.js';
import { runLayer3 }      from './layers/layer3-numeric-validation.js';
import { runLayer4 }      from './layers/layer4-business-routing.js';
import { runLayer5 }      from './layers/layer5-ai-fallback.js';
import { categorizeIndustry, getIndustryProfile } from './industry/industry-profile.js';
import { getCorrectionExamples } from './memory/correction-memory.js';
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

  // Para calidad parcial: el threshold efectivo baja al cap para no bloquear
  // documentos con señales fuertes que de igual forma están capeados.
  // Ej: confidenceCap=65, CONFIDENCE_THRESHOLD=72 → si exigiéramos 72 nunca
  // pasaría, pero si hay señal definitiva con 65 de confianza ya es suficiente.
  const EFFECTIVE_THRESHOLD = confidenceCap !== null
    ? Math.min(CONFIDENCE_THRESHOLD, confidenceCap)
    : CONFIDENCE_THRESHOLD;

  // ── Supplier Fingerprint Lookup ────────────────────────────────────────────
  // El bonus solo se aplica si el costSection aprendido coincide con la sección
  // que sugiere el texto actual (Layer 4 temprano). Esto evita contaminar
  // clasificaciones donde el mismo proveedor vende cosas distintas a la misma empresa.
  let supplierFingerprintUsed = false;
  let fingerprintBonus = 0;
  let fingerprintLearnedSection: string | null = null;

  if (input.supplierCuit) {
    try {
      const fp = await prisma.supplierFingerprint.findFirst({
        where: {
          costistId:    input.costistId,
          supplierCuit: input.supplierCuit,
          companyId:    input.companyId,
        },
      });
      if (fp && fp.timesSeenCorrect >= 3) {
        fingerprintLearnedSection = fp.costSection;
        // El bonus se reserva; se aplica condicionalmente después de Layer 4
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

    // Aplicar fingerprint bonus solo si la sección aprendida coincide con la
    // que Layer 4 sugiere para este texto. Si el proveedor vendió siempre MP
    // pero ahora el texto habla de algo diferente, no inflamos la confianza.
    const l4 = runLayer4(layer1.documentType, text, industryCategory);
    const sectionMatch = !fingerprintLearnedSection
      || l4.requiresAI                                // sin decisión todavía → aceptamos bonus
      || fingerprintLearnedSection === l4.costSection; // coincide → bonus válido
    if (sectionMatch) {
      confidence = Math.min(confidence + fingerprintBonus, confidenceCap ?? 100);
      if (fingerprintBonus > 0 && sectionMatch) supplierFingerprintUsed = true;
    }

    if (confidence >= EFFECTIVE_THRESHOLD && !l4.requiresAI) {
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
    if (l4.requiresAI && confidence >= EFFECTIVE_THRESHOLD) {
      const correctionExamples = await getCorrectionExamples({
        costistId: input.costistId,
        industryCategory,
        foundLabels: [layer1.label],
      });
      const aiResult = await runLayer5({
        text,
        accumulatedPts: confidence,
        foundSignalLabels: [layer1.label],
        suggestedType: layer1.documentType,
        industryLabel: industryProfile.label,
        industryCategory,
        intent,
        correctionExamples,
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
          requiresReview: finalConf < EFFECTIVE_THRESHOLD,
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

  // Ambigüedad de TIPO: solo aplica cuando NO hay señal definitiva (Layer 1).
  // Una señal definitiva (CAE, "RECIBO DE SUELDO") manda por sobre el margen.
  // Sin ella, si Layer 2 dejó dos tipos peleados, no confiamos en el puntaje
  // absoluto: lo desempata la IA y, si no está, va a revisión humana.
  const typeAmbiguous = !layer1 && layer2.ambiguous;

  // ── Layer 4: Business Routing ──────────────────────────────────────────────
  const l4 = runLayer4(suggestedType ?? 'DESCONOCIDO', text, industryCategory);

  // Aplicar fingerprint bonus sobre el score acumulado (layers 2-3), misma
  // lógica: solo si el costSection aprendido coincide con lo que Layer 4 sugiere.
  if (!supplierFingerprintUsed && fingerprintBonus > 0) {
    const sectionMatch2 = !fingerprintLearnedSection
      || l4.requiresAI
      || fingerprintLearnedSection === l4.costSection;
    if (sectionMatch2) {
      accumulatedPts = Math.min(accumulatedPts + fingerprintBonus, confidenceCap ?? 100);
      supplierFingerprintUsed = true;
    }
  }

  if (accumulatedPts >= EFFECTIVE_THRESHOLD && !l4.requiresAI && !typeAmbiguous) {
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
  // Se llama tanto por confianza baja como por ambigüedad (empate de tipos o
  // de sección): en ese caso la IA actúa de desempate aunque el puntaje fuera alto.
  const foundLabels = allSignals.map((s) => s.label);
  const ambiguityHint = typeAmbiguous && layer2.runnerUpType
    ? `Las reglas dejaron dos tipos empatados: ${layer2.winningType} vs ${layer2.runnerUpType}. Decidí cuál corresponde.`
    : undefined;
  const correctionExamples = await getCorrectionExamples({
    costistId: input.costistId,
    industryCategory,
    foundLabels,
  });
  const aiResult = await runLayer5({
    text,
    accumulatedPts,
    foundSignalLabels: foundLabels,
    suggestedType,
    industryLabel: industryProfile.label,
    industryCategory,
    intent,
    ambiguityHint,
    correctionExamples,
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
