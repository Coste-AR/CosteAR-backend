// src/infrastructure/classifier/cascade-classifier.ts
import { runQualityGate } from './layers/layer0-quality-gate.js';
import { detectIntent }   from './layers/layer0a-intent-detection.js';
import { runLayer1 }      from './layers/layer1-definitive-signals.js';
import { runLayer2 }      from './layers/layer2-corroborating-signals.js';
import { runLayer3 }      from './layers/layer3-numeric-validation.js';
import { runLayer4 }      from './layers/layer4-business-routing.js';
import type { Layer4Result } from './layers/layer4-business-routing.js';
import { runLayer5 }      from './layers/layer5-ai-fallback.js';
import { detectAcquisitionCostLink } from './layers/layer4-acquisition-link.js';
import { categorizeIndustry, getIndustryProfile } from './industry/industry-profile.js';
import { getActiveVocabularyTerms, withVocabularyTerms } from './industry/vocabulary-profile.js';
import { getCorrectionExamples } from './memory/correction-memory.js';
import type { ClassifierInput, ClassificationResult, DocumentType, CostSection, InputIntent, IndustryCategory } from './types.js';
import { prisma } from '../database/prisma.js';

// OJO: 72 se usa con DOS escalas distintas (ver caveat detallado en la asignación
// de `confidence`, ~línea 267): umbral de PROBABILIDAD calibrada para la rama de
// señal definitiva, y umbral de PUNTOS acumulados para la rama corroborante.
const CONFIDENCE_THRESHOLD = 72;

/**
 * Puntaje mínimo en Layer 2 para que un tipo DISTINTO al elegido cuente como
 * competidor real (≈2-3 señales corroborantes fuertes). Por debajo es ruido
 * normal (ej. el CUIT del empleador en un recibo) y no dispara conflicto.
 */
const STRONG_COMPETITOR = 30;

/** Nombre legible de cada sección, para poder citarla en una explicación. */
const SECTION_LABEL: Record<CostSection, string> = {
  MATERIA_PRIMA:          'Materia Prima',
  MANO_DE_OBRA:           'Mano de Obra Directa',
  COSTOS_INDIRECTOS:      'Costos Indirectos de Producción',
  VENTAS:                 'Ventas',
  GASTO_COMERCIALIZACION: 'Gasto de Comercialización',
  GASTO_ADMINISTRACION:   'Gasto de Administración',
  GASTO_FINANCIERO:       'Gasto Financiero',
  MULTIPLE:               'varias secciones (documento mixto)',
  DESCONOCIDO:            'sin determinar',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DECISIÓN DE SECCIÓN — la sección y su justificación son UNA sola cosa (CL-03)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Antes, `costSection` y el texto que se le muestra al costista se elegían por
 * separado: la sección salía de Layer 4 y el `reasoning` seguía saliendo de la
 * IA. Cuando Layer 4 pisaba a la IA, el costista leía la justificación de una
 * decisión que el sistema NO tomó (medido en GA-05: leía "…lo que indica un
 * gasto de comercialización" mientras el sistema imputaba MANO_DE_OBRA).
 *
 * Un chequeo posterior que compare ambas no alcanza: lo que hace falta es que
 * no exista el estado inválido. Por eso las dos viajan juntas en este tipo y
 * `buildSectionAndExplanation` devuelve el par `{ costSection, explanation }`
 * ya armado desde el mismo objeto — no hay forma de setear una sin la otra.
 */
export interface SectionDecision {
  readonly section: CostSection;
  /** El texto que justifica EXACTAMENTE a `section`. Nunca el de otra decisión. */
  readonly reasoning: string;
  readonly decidedBy: 'REGLAS' | 'IA';
  /** true cuando una regla determinista de Layer 4 contradijo a la IA. */
  readonly ruleDissent: boolean;
}

/** Decisión tomada por las reglas deterministas (Layer 4), sin IA de por medio. */
function decisionFromRules(l4: Layer4Result): SectionDecision {
  return {
    section:     l4.costSection,
    reasoning:   l4.reasoning,
    decidedBy:   'REGLAS',
    ruleDissent: false,
  };
}

/**
 * Resuelve la sección DESPUÉS de que la IA respondió, devolviendo sección y
 * justificación como una sola unidad.
 *
 * REGLA DE DESEMPATE (ver DECISIONES.md — CL-03): **gana la IA y se lleva su
 * propia explicación**, y el desacuerdo con una regla determinista de Layer 4
 * manda el documento a revisión humana en vez de resolverse en silencio.
 *
 * Por qué la IA y no Layer 4: cuando llegamos acá el `documentType` que se
 * guarda YA es el de la IA, sin discusión. Layer 4 corre sobre ESE tipo. Tomarle
 * la sección a Layer 4 mientras se le acepta el tipo a la IA es incoherente: se
 * mezclan dos lecturas del documento en un resultado que ninguna de las dos
 * sostiene. Además, los dos casos medidos de este pisado (GA-05 y MULTI-01) los
 * ganaba Layer 4 y en los dos Layer 4 estaba equivocada.
 */
export function resolveSectionAfterAI(
  ai: { costSection: CostSection; reasoning: string },
  l4AfterAI: Layer4Result,
): SectionDecision {
  // Layer 4 no tiene una regla determinista para este tipo, o coincide con la
  // IA: no hay nada que desempatar.
  if (l4AfterAI.requiresAI || l4AfterAI.costSection === ai.costSection) {
    return {
      section:     ai.costSection,
      reasoning:   ai.reasoning,
      decidedBy:   'IA',
      ruleDissent: false,
    };
  }

  // Desacuerdo real: una regla determinista dice otra cosa. Se guarda la
  // lectura de la IA —la misma que se muestra— y se declara la discrepancia en
  // el mismo texto, para que el costista pueda decidir con las dos a la vista.
  return {
    section:   ai.costSection,
    reasoning:
      `${ai.reasoning}. ⚠️ La regla de negocio para este tipo de documento apunta a ` +
      `${SECTION_LABEL[l4AfterAI.costSection]} (${l4AfterAI.reasoning}), que NO coincide ` +
      `con esta lectura. Se imputa ${SECTION_LABEL[ai.costSection]} —lo que dice esta misma ` +
      'explicación— y el documento queda para tu confirmación',
    decidedBy:   'IA',
    ruleDissent: true,
  };
}

/** Agrega una nota al final de la justificación sin desarmar la unidad. */
function withNote(decision: SectionDecision, note: string | null): SectionDecision {
  return note ? { ...decision, reasoning: `${decision.reasoning} (${note})` } : decision;
}

/**
 * Genera la sección imputada Y la explicación legible para el costista como un
 * único par. Se devuelven juntas a propósito: los call sites la esparcen con
 * `...` en el resultado, así que es imposible guardar una sección con la
 * explicación de otra decisión.
 */
function buildSectionAndExplanation(params: {
  intent: InputIntent;
  documentType: DocumentType;
  decision: SectionDecision;
  confidence: number;
  definitiveSignal: string | null;
  aiUsed: boolean;
  supplierFingerprintUsed: boolean;
  requiresReview: boolean;
  industryCategory: IndustryCategory;
  industryLabel: string;
  signalCount: number;
  wasteReviewRequired?: boolean;
}): { costSection: CostSection; explanation: string } {
  // `documentType` y `aiUsed` siguen en el tipo de `params` —forman parte del
  // contrato— pero esta función no los usa para armar el texto.
  const {
    intent, confidence,
    definitiveSignal, decision,
    supplierFingerprintUsed, requiresReview,
    industryCategory, industryLabel, signalCount,
    wasteReviewRequired,
  } = params;
  const l4Reasoning = decision.reasoning;

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
    // Cuando la revisión viene de una regla que contradice a la IA, decir "la
    // confianza es baja" sería mentira: la confianza puede ser 97. El motivo
    // real ya quedó escrito arriba, dentro de la justificación de la decisión.
    parts.push(decision.ruleDissent
      ? 'Las reglas y la IA no coinciden → requiere tu revisión antes de aplicar.'
      : 'La confianza es baja → requiere tu revisión antes de aplicar.');
  }

  return { costSection: decision.section, explanation: parts.join(' ') };
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
  const staticIndustryProfile = getIndustryProfile(industryCategory);
  let industryProfile = staticIndustryProfile;

  try {
    const vocabularyTerms = await getActiveVocabularyTerms(industryCategory);
    industryProfile = withVocabularyTerms(staticIndustryProfile, vocabularyTerms);
  } catch {
    // El clasificador ya funcionaba sin esta lectura (por ejemplo en una tarea
    // local sin base); conservar el perfil estático evita convertir una caída de
    // infraestructura en una clasificación distinta.
  }

  // ── Texto efectivo para clasificar ────────────────────────────────────────
  // Si hay texto enriquecido (de Groq OCR), lo usamos. Si no, el rawContent.
  const text = (input.enrichedText && input.enrichedText.trim().length > 10)
    ? input.enrichedText
    : input.text;

  // ── Vínculo de costo de adquisición declarado por el documento ─────────────
  // Se detecta acá y no dentro del ruteo porque NO depende del tipo de documento
  // ni de la sección: es un hecho del texto que la capa de aplicación necesita
  // igual, incluso cuando la IA termina eligiendo otra sección. La misma función
  // pura la usa layer4-invoice-routing para decidir la sección.
  const acquisitionLink = detectAcquisitionCostLink(text.toLowerCase());

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
  const l4 = runLayer4(chosenType, text, industryCategory, extractedRole, industryProfile);

  // ── Confianza a partir de la evidencia ──────────────────────────────────────
  // ⚠️ CAVEAT DE ESCALAS: las dos ramas NO están en la misma unidad, aunque
  // compartan la variable `confidence` y se comparen luego contra el mismo umbral.
  //   • definitiveType → layer1.confidence  = probabilidad CALIBRADA (~93-98),
  //     una señal definitiva ya mapeada a "qué tan probable es este tipo".
  //   • si no → layer2.totalPts + layer3Delta = SUMA DE PUNTAJES acumulados de
  //     señales corroborantes independientes. Un documento con 5 señales fuertes
  //     puede superar 72 puntos con facilidad, pero eso NO es "72% de probabilidad";
  //     es una suma de pesos, no una probabilidad normalizada 0-100.
  // Por eso CONFIDENCE_THRESHOLD (72, ver línea 17) actúa como umbral de PUNTOS en
  // la rama corroborante y como umbral de PROBABILIDAD en la rama definitiva: son
  // dos criterios distintos que casualmente coinciden en el mismo número. Funciona
  // hoy y NO es urgente de arreglar, pero NO asumas que ambas ramas producen una
  // probabilidad calibrada 0-100 al tocar esta lógica.
  // TODO(future): normalizar Layer 2 a 0-100 antes de comparar contra el umbral,
  //   p.ej. saturación `100 * (1 - Math.exp(-pts / k))`, para que ambas ramas sean
  //   comparables de verdad. NO implementado a propósito (cambiaría el comportamiento).
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
      acquisitionLink,
      // `costSection` y `explanation` salen juntas de acá: no se pueden separar.
      ...buildSectionAndExplanation({
        intent, documentType: chosenType,
        decision: decisionFromRules(l4), confidence: Math.min(confidence, 100),
        definitiveSignal: layer1?.label ?? null,
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
    const l4afterAI = runLayer4(
      aiResult.documentType,
      text,
      industryCategory,
      extractedRole,
      industryProfile,
    );

    // Una sola decisión: la sección que se guarda y el texto que se muestra
    // salen de acá y no se vuelven a tocar por separado.
    const decision = withNote(
      resolveSectionAfterAI(aiResult, l4afterAI),
      crossLayerConflict ? 'había señales contradictorias → confirmá' : null,
    );

    const finalConf = confidenceCap !== null
      ? Math.min(aiResult.confidence, confidenceCap)
      : aiResult.confidence;

    // Garantía de cero errores silenciosos: si hubo conflicto duro entre capas,
    // una merma de naturaleza ambigua, o una regla determinista que contradice a
    // la IA, la IA pre-llena su mejor hipótesis pero SIEMPRE pasa por revisión
    // humana. Sin conflicto, vale el umbral normal.
    const requiresReview = crossLayerConflict || wasteReviewRequired
      || decision.ruleDissent || finalConf < CONFIDENCE_THRESHOLD;

    return {
      documentType: aiResult.documentType as DocumentType,
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
      acquisitionLink,
      // `costSection` y `explanation` salen juntas de acá: no se pueden separar.
      ...buildSectionAndExplanation({
        intent, documentType: aiResult.documentType as DocumentType,
        decision, confidence: finalConf,
        definitiveSignal: layer1?.label ?? null,
        aiUsed: true, supplierFingerprintUsed, requiresReview,
        industryCategory, industryLabel: industryProfile.label, signalCount: allSignals.length,
        wasteReviewRequired,
      }),
    };
  }

  // ── Layer 6: Escalamiento humano (IA no disponible o sin resolución) ────────
  return {
    documentType: chosenType,
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
    // `costSection` y `explanation` salen juntas de acá: no se pueden separar.
    ...buildSectionAndExplanation({
      intent, documentType: chosenType,
      decision: decisionFromRules(l4), confidence: Math.min(confidence, 71),
      definitiveSignal: layer1?.label ?? null,
      aiUsed: false, supplierFingerprintUsed, requiresReview: true,
      industryCategory, industryLabel: industryProfile.label, signalCount: allSignals.length,
      wasteReviewRequired,
    }),
  };
}
