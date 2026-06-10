// src/infrastructure/classifier/cascade-classifier.ts
import { runQualityGate } from './layers/layer0-quality-gate.js';
import { runLayer1 } from './layers/layer1-definitive-signals.js';
import { runLayer2 } from './layers/layer2-corroborating-signals.js';
import { runLayer3 } from './layers/layer3-numeric-validation.js';
import { runLayer4 } from './layers/layer4-business-routing.js';
import { runLayer5 } from './layers/layer5-ai-fallback.js';
import type { ClassifierInput, ClassificationResult, DocumentType, CostSection } from './types.js';

const CONFIDENCE_THRESHOLD = 72;

/**
 * Main cascade classifier orchestrator.
 *
 * Runs the 6-layer pipeline in order, short-circuiting early when confidence
 * is already high enough. Never forces a classification — prefers
 * requiresReview=true over a wrong label.
 *
 * Does NOT write to the DB — persistence is handled by empresa-portal-service.ts.
 */
export async function classifyDocument(input: ClassifierInput & {
  groqQuality?: 'legible' | 'parcial' | 'ilegible' | null;
}): Promise<ClassificationResult> {
  const { text, groqQuality = null } = input;

  // ── Layer 0: Quality Gate ──────────────────────────────────────────────────
  const qualityResult = runQualityGate({ quality: groqQuality, text });
  if (qualityResult.gate === 'FAIL') {
    return {
      documentType: 'DESCONOCIDO',
      costSection: 'DESCONOCIDO',
      confidence: 0,
      requiresReview: true,
      isDuplicate: false,
      qualityGate: 'FAIL',
      definitiveSignal: null,
      signals: [],
      aiUsed: false,
      supplierFingerprintUsed: false,
      confidenceCap: null,
    };
  }

  const confidenceCap = qualityResult.confidenceCap;

  // ── Layer 1: Definitive Signals ────────────────────────────────────────────
  const layer1 = runLayer1(text);

  if (layer1) {
    let confidence = confidenceCap !== null
      ? Math.min(layer1.confidence, confidenceCap)
      : layer1.confidence;

    const l4 = runLayer4(layer1.documentType, text);

    if (confidence >= CONFIDENCE_THRESHOLD && !l4.requiresAI) {
      return {
        documentType: layer1.documentType as DocumentType,
        costSection: l4.costSection,
        confidence,
        requiresReview: false,
        isDuplicate: false,
        qualityGate: qualityResult.gate,
        definitiveSignal: layer1.label,
        signals: [{ label: layer1.label, pts: layer1.confidence, type: layer1.documentType, layer: 1 }],
        aiUsed: false,
        supplierFingerprintUsed: false,
        confidenceCap,
      };
    }

    // Layer 1 found something but Layer 4 needs AI for cost section routing
    if (l4.requiresAI && confidence >= CONFIDENCE_THRESHOLD) {
      const aiResult = await runLayer5({
        text,
        accumulatedPts: confidence,
        foundSignalLabels: [layer1.label],
        suggestedType: layer1.documentType,
      });

      if (aiResult) {
        const finalConfidence = confidenceCap !== null
          ? Math.min(aiResult.confidence, confidenceCap)
          : aiResult.confidence;
        return {
          documentType: layer1.documentType as DocumentType,
          costSection: aiResult.costSection,
          confidence: finalConfidence,
          requiresReview: finalConfidence < CONFIDENCE_THRESHOLD,
          isDuplicate: false,
          qualityGate: qualityResult.gate,
          definitiveSignal: layer1.label,
          signals: [{ label: layer1.label, pts: layer1.confidence, type: layer1.documentType, layer: 1 }],
          aiUsed: true,
          supplierFingerprintUsed: false,
          confidenceCap,
        };
      }
    }
  }

  // ── Layers 2-3: Corroborating + Numeric ───────────────────────────────────
  const layer1Labels = layer1 ? [layer1.label] : [];
  const layer2 = runLayer2(text, layer1Labels);
  const layer3Delta = runLayer3(text);

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
  const l4 = runLayer4(suggestedType ?? 'DESCONOCIDO', text);

  if (accumulatedPts >= CONFIDENCE_THRESHOLD && !l4.requiresAI) {
    return {
      documentType: (suggestedType ?? 'DESCONOCIDO') as DocumentType,
      costSection: l4.costSection,
      confidence: Math.min(accumulatedPts, 100),
      requiresReview: false,
      isDuplicate: false,
      qualityGate: qualityResult.gate,
      definitiveSignal: layer1?.label ?? null,
      signals: allSignals,
      aiUsed: false,
      supplierFingerprintUsed: false,
      confidenceCap,
    };
  }

  // ── Layer 5: AI Fallback ───────────────────────────────────────────────────
  const foundLabels = allSignals.map((s) => s.label);
  const aiResult = await runLayer5({ text, accumulatedPts, foundSignalLabels: foundLabels, suggestedType });

  if (aiResult) {
    const finalConfidence = confidenceCap !== null
      ? Math.min(aiResult.confidence, confidenceCap)
      : aiResult.confidence;
    return {
      documentType: aiResult.documentType as DocumentType,
      costSection: aiResult.costSection as CostSection,
      confidence: finalConfidence,
      requiresReview: finalConfidence < CONFIDENCE_THRESHOLD,
      isDuplicate: false,
      qualityGate: qualityResult.gate,
      definitiveSignal: layer1?.label ?? null,
      signals: allSignals,
      aiUsed: true,
      supplierFingerprintUsed: false,
      confidenceCap,
    };
  }

  // ── Layer 6: Human Escalation ──────────────────────────────────────────────
  return {
    documentType: (suggestedType ?? 'DESCONOCIDO') as DocumentType,
    costSection: l4.costSection,
    confidence: Math.min(accumulatedPts, 71),
    requiresReview: true,
    isDuplicate: false,
    qualityGate: qualityResult.gate,
    definitiveSignal: layer1?.label ?? null,
    signals: allSignals,
    aiUsed: false,
    supplierFingerprintUsed: false,
    confidenceCap,
  };
}
