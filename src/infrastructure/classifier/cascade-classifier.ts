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
 * Puntaje mínimo en Layer 2 para que un tipo DISTINTO al elegido cuente como
 * competidor real (≈2-3 señales corroborantes fuertes). Por debajo es ruido
 * normal (ej. el CUIT del empleador en un recibo) y no dispara conflicto.
 */
const STRONG_COMPETITOR = 30;

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
  wasteReviewRequired?: boolean;
}): string {
  const {
    intent, documentType, costSection, confidence,
    definitiveSignal, l4Reasoning, aiUsed,
    supplierFingerprintUsed, requiresReview,
    industryCategory, industryLabel, signalCount,
    wasteReviewRequired,
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

  // Merma de naturaleza ambigua: aviso explícito de por qué va a revisión.
  if (wasteReviewRequired) {
    parts.push('⚠️ Se menciona una merma/pérdida pero no queda claro si es NORMAL (esperada, se absorbe en el costo) o EXTRAORDINARIA (siniestro, es pérdida). No se asume ninguna → requiere tu confirmación.');
  }

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

  // Merma de naturaleza ambigua (ni claramente normal ni extraordinaria):
  // revisión humana OBLIGATORIA. No se auto-clasifica ni como pérdida ni como
  // costo. "Cero errores silenciosos".
  const wasteReviewRequired = intentResult.requiresReview === true;

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
  let fingerprintLearnedType: string | null = null;

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
        fingerprintLearnedType    = fp.documentType;
        // El bonus se reserva; se aplica condicionalmente después de Layer 4
        fingerprintBonus = fp.confidenceBonus;
      }
    } catch {
      // DB lookup failure es no-fatal
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EVIDENCIA COMPLETA: corren SIEMPRE todas las capas deterministas (baratas).
  // No hay cortocircuito: ninguna capa "gana" sola sin que se mire al resto.
  // ════════════════════════════════════════════════════════════════════════════
  const layer1       = runLayer1(text);                     // señal definitiva o null
  const layer1Labels = layer1 ? [layer1.label] : [];
  const layer2       = runLayer2(text, layer1Labels);       // corroborantes + margen
  const layer3Delta  = runLayer3(text);                     // validación numérica

  const allSignals = [
    ...(layer1 ? [{ label: layer1.label, pts: layer1.confidence, type: layer1.documentType, layer: 1 as const }] : []),
    ...layer2.signals,
  ];
  const foundLabels = allSignals.map((s) => s.label);

  // ── Opiniones de TIPO de cada fuente independiente ──────────────────────────
  const definitiveType   = layer1?.documentType ?? null;
  const corroboratingType = layer2.winningType ?? null;

  // Hipótesis principal: la señal definitiva manda como primera hipótesis; si no,
  // el ganador de corroborantes; si no, lo aprendido del proveedor.
  const chosenType = (definitiveType ?? corroboratingType ?? fingerprintLearnedType ?? 'DESCONOCIDO') as DocumentType;

  // ── Conflicto ENTRE capas (el agujero que tapamos) ──────────────────────────
  // Un competidor fuerte = un tipo distinto al elegido con puntaje sustancial en
  // Layer 2. Si existe, la evidencia se contradice: NO confiamos en una sola señal.
  const competingTypes = Object.entries(layer2.scoreByType)
    .filter(([t, pts]) => t !== chosenType && t !== '' && pts >= STRONG_COMPETITOR)
    .map(([t]) => t);

  // El fingerprint (verdad aprendida del costista) contradice a la señal definitiva.
  const fingerprintConflict = Boolean(
    fingerprintLearnedType && definitiveType && fingerprintLearnedType !== definitiveType,
  );

  const crossLayerConflict = competingTypes.length > 0 || fingerprintConflict;

  // Ambigüedad interna de Layer 2 (dos tipos pegados) cuando no hay señal definitiva.
  const typeAmbiguous = !layer1 && layer2.ambiguous;

  // ── Puesto/cargo extraído por Groq (para distinguir MOD de mano de obra
  //    indirecta en liquidaciones). Puede venir null si no se pudo extraer. ────
  const extractedRole = typeof input.extractedData?.role === 'string'
    ? (input.extractedData.role as string)
    : null;

  // ── Layer 4: routing de sección para la hipótesis elegida ───────────────────
  const l4 = runLayer4(chosenType, text, industryCategory, extractedRole);

  // ── Confianza a partir de la evidencia ──────────────────────────────────────
  let confidence = definitiveType
    ? layer1!.confidence
    : layer2.totalPts + layer3Delta;
  if (confidenceCap !== null) confidence = Math.min(confidence, confidenceCap);

  // Bonus de fingerprint solo si la sección aprendida coincide con la ruteada.
  const sectionMatch = !fingerprintLearnedSection
    || l4.requiresAI
    || fingerprintLearnedSection === l4.costSection;
  if (fingerprintBonus > 0 && sectionMatch) {
    confidence = Math.min(confidence + fingerprintBonus, confidenceCap ?? 100);
    supplierFingerprintUsed = true;
  }

  // ── DECISIÓN ────────────────────────────────────────────────────────────────
  // Auto-clasifica SOLO si todas las fuentes coinciden, no hay ambigüedad de
  // sección, y la confianza alcanza. Cualquier duda → IA y/o revisión humana.
  const blocked = crossLayerConflict || typeAmbiguous || l4.requiresAI || wasteReviewRequired;

  if (!blocked && confidence >= EFFECTIVE_THRESHOLD && chosenType !== 'DESCONOCIDO') {
    return {
      documentType: chosenType,
      costSection:  l4.costSection,
      confidence:   Math.min(confidence, 100),
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
        intent, documentType: chosenType,
        costSection: l4.costSection, confidence: Math.min(confidence, 100),
        definitiveSignal: layer1?.label ?? null, l4Reasoning: l4.reasoning,
        aiUsed: false, supplierFingerprintUsed, requiresReview: false,
        industryCategory, industryLabel: industryProfile.label, signalCount: allSignals.length,
      }),
    };
  }

  // ── Layer 5: IA como desempate (recibe TODO el contexto del conflicto) ──────
  const conflictHint = crossLayerConflict
    ? `⚠️ Las reglas se contradicen: la evidencia apunta a ${chosenType} pero también hay señales fuertes de ${[...competingTypes, fingerprintConflict ? `${fingerprintLearnedType} (histórico del proveedor)` : ''].filter(Boolean).join(', ')}. Resolvé con cuidado.`
    : typeAmbiguous && layer2.runnerUpType
      ? `Las reglas dejaron dos tipos empatados: ${layer2.winningType} vs ${layer2.runnerUpType}. Decidí cuál corresponde.`
      : undefined;

  // Prior fuerte para liquidaciones de personal que NO es mano de obra directa:
  // el puesto (capataz, gerente, administrativo…) sugiere CIP o gasto admin.
  const payrollHint = (l4.requiresAI && l4.suggestedSection
    && (chosenType === 'LIQUIDACION_MOD' || chosenType === 'PLANILLA_HORAS'))
    ? `Liquidación/planilla de un puesto que NO es mano de obra directa. ${l4.reasoning}. Las reglas sugieren ${l4.suggestedSection} como candidato (mano de obra indirecta = Costos Indirectos de Producción; personal administrativo = Gasto de Administración). Confirmá según el puesto.`
    : undefined;

  // Merma ambigua: la IA debe entender que NO puede asumir pérdida ni costo.
  const wasteHint = wasteReviewRequired
    ? 'El texto menciona una merma/pérdida pero no aclara su naturaleza. Merma NORMAL (esperada, dentro de rango, "% habitual", "merma de proceso") se absorbe en el costo de las unidades buenas y NO es pérdida. Merma EXTRAORDINARIA (incendio, robo, inundación, "se pudrió todo", siniestro) es pérdida fuera del costo (PERDIDA_INVENTARIO). No la clasifiques como pérdida ni como costo sin que el costista confirme cuál es.'
    : undefined;

  const correctionExamples = await getCorrectionExamples({
    costistId: input.costistId,
    industryCategory,
    foundLabels,
  });
  const aiResult = await runLayer5({
    text,
    accumulatedPts: confidence,
    foundSignalLabels: foundLabels,
    suggestedType: chosenType,
    industryLabel: industryProfile.label,
    industryCategory,
    intent,
    ambiguityHint: conflictHint ?? payrollHint ?? wasteHint,
    correctionExamples,
  });

  if (aiResult) {
    const l4afterAI = runLayer4(aiResult.documentType, text, industryCategory, extractedRole);
    const finalSection: CostSection = (!l4afterAI.requiresAI)
      ? l4afterAI.costSection
      : aiResult.costSection as CostSection;

    const finalConf = confidenceCap !== null
      ? Math.min(aiResult.confidence, confidenceCap)
      : aiResult.confidence;

    // Garantía de cero errores silenciosos: si hubo conflicto duro entre capas,
    // o una merma de naturaleza ambigua, la IA pre-llena su mejor hipótesis pero
    // SIEMPRE pasa por revisión humana. Sin conflicto, vale el umbral normal.
    const requiresReview = crossLayerConflict || wasteReviewRequired || finalConf < CONFIDENCE_THRESHOLD;

    return {
      documentType: aiResult.documentType as DocumentType,
      costSection:  finalSection,
      confidence:   finalConf,
      requiresReview,
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
        definitiveSignal: layer1?.label ?? null,
        l4Reasoning: crossLayerConflict ? `${aiResult.reasoning} (había señales contradictorias → confirmá)` : aiResult.reasoning,
        aiUsed: true, supplierFingerprintUsed, requiresReview,
        industryCategory, industryLabel: industryProfile.label, signalCount: allSignals.length,
        wasteReviewRequired,
      }),
    };
  }

  // ── Layer 6: Escalamiento humano (IA no disponible o sin resolución) ────────
  return {
    documentType: chosenType,
    costSection:  l4.costSection,
    confidence:   Math.min(confidence, 71),
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
      intent, documentType: chosenType,
      costSection: l4.costSection, confidence: Math.min(confidence, 71),
      definitiveSignal: layer1?.label ?? null, l4Reasoning: l4.reasoning,
      aiUsed: false, supplierFingerprintUsed, requiresReview: true,
      industryCategory, industryLabel: industryProfile.label, signalCount: allSignals.length,
      wasteReviewRequired,
    }),
  };
}
