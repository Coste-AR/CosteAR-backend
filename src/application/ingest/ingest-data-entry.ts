// src/application/ingest/ingest-data-entry.ts
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ConflictError } from '../../domain/errors/domain-error.js';
import { GroqService } from '../../infrastructure/ai/groq-service.js';
import { classifyDocument } from '../../infrastructure/classifier/cascade-classifier.js';
import { extractCuits } from '../../infrastructure/classifier/utils/cuit-validator.js';
import { extractCAE } from '../../infrastructure/classifier/utils/cae-validator.js';
import { buildStrongDedupeKey } from '../../infrastructure/classifier/utils/dedupe-key.js';
import { buildEnrichedText } from '../../infrastructure/classifier/utils/text-enricher.js';
import { uploadToCloudinary } from '../../infrastructure/cloudinary/cloudinary-upload.js';
import { SystemAlertService } from '../system/system-alert-service.js';

export type IngestSourceType = 'TEXT' | 'PDF' | 'IMAGE' | 'WHATSAPP' | 'TELEGRAM';

export interface IngestInput {
  connectionId: string;
  costistId: string;
  companyId: string;
  rawContent: string;
  sourceType: IngestSourceType;
  /** Producto/estructura destino. Debe venir ya validado contra la empresa. */
  costStructureId?: string | null;
  /**
   * Qué PERSONA subió el documento (I5a). Lo manda el portal, que es el único
   * canal donde hay alguien identificado del otro lado.
   *
   * Los otros dos caminos que llegan acá —`/datos/submit` por API key y el
   * webhook de WhatsApp— no tienen una persona atrás, así que llega `undefined`
   * y la columna queda en null. Eso es lo correcto: "no consta" es un dato, y es
   * distinto de atribuirle el documento al dueño de la conexión.
   */
  uploadedBy?: string | null;
  fileName?: string | null;
  fileData?: string | null;
  fileMimeType?: string | null;
  /**
   * Documento ilegible (quality gate FAIL): si es `true` se rechaza con 409 y NO
   * se crea la entrada (el que subió puede reenviar una foto mejor). Si es
   * `false` la entrada se crea igual marcada para revisión — se usa en los
   * canales sin interlocutor humano (webhook de WhatsApp), donde tirar un error
   * equivale a perder el dato en silencio.
   */
  rejectIllegible?: boolean;
}

export interface IngestResult {
  isDuplicate: boolean;
  duplicateEntryId?: string;
  /** Estado real de la entrada previa cuando es duplicado. */
  duplicateStatus?: string | null;
  message?: string;
  id?: string;
  status?: string;
  aiResponse?: string | null;
  classification?: {
    documentType: string;
    costSection: string;
    confidence: number;
    requiresReview: boolean;
    qualityGate: string;
  };
}

/**
 * Camino ÚNICO de ingesta de datos.
 *
 * Toda entrada que llega al costista —portal del operador, `POST /datos/submit`
 * con API key, o webhook de WhatsApp— pasa por acá. Antes cada canal creaba su
 * `DataEntry` a mano y solo el portal clasificaba: las entradas de los otros dos
 * canales quedaban sin `ClassificationAudit`, y sin audit el resto del sistema
 * las trata como inexistentes (la UI de Validaciones no muestra tipo ni sección,
 * la aprobación masiva las saltea, y al aprobarlas no se genera línea del libro
 * mayor, ni fingerprint del proveedor, ni auto-población de la estructura).
 *
 * Si agregás un canal nuevo de ingesta, llamá a esta función. No crees
 * `DataEntry` por fuera.
 */
export async function ingestDataEntry(
  input: IngestInput,
  deps: { db?: PrismaClient; groq?: GroqService; alerts?: SystemAlertService } = {},
): Promise<IngestResult> {
  const db = deps.db ?? prisma;
  const groq = deps.groq ?? new GroqService();
  const alerts = deps.alerts ?? new SystemAlertService();
  const rejectIllegible = input.rejectIllegible ?? true;

  // ── Rubro de la empresa (clasificación consciente de la industria) ──────────
  const company = await db.company.findUnique({
    where: { id: input.companyId },
    select: { industry: true, description: true },
  });
  const industry = company?.industry ?? null;
  const companyContext = company?.description ?? null;

  // ── Análisis de Groq (extracción + calidad + OCR) ───────────────────────────
  const aiAnalysis = await groq.analyzeDocument({
    text: input.rawContent,
    fileData: input.fileData ?? undefined,
    fileMimeType: input.fileMimeType ?? undefined,
    fileName: input.fileName ?? undefined,
    companyContext,
  });

  // ── Texto enriquecido: para imágenes el rawContent no tiene señales ─────────
  const enrichedText = buildEnrichedText(input.rawContent, aiAnalysis);

  const textToClassify = enrichedText || input.rawContent || (input.fileName ?? '');
  const supplierCuit = extractCuits(textToClassify)[0] ?? null;

  // ── Dedup por CAE ───────────────────────────────────────────────────────────
  const cae = extractCAE(textToClassify);
  if (cae) {
    const existingCAE = await db.processedCAE.findUnique({ where: { cae } });
    if (existingCAE) {
      // El estado real de la entrada previa, no uno asumido: puede estar ya
      // aprobada o rechazada, y quien reenvía el comprobante necesita saberlo.
      const previa = await db.dataEntry.findUnique({
        where: { id: existingCAE.dataEntryId },
        select: { status: true },
      });
      return {
        isDuplicate: true,
        duplicateEntryId: existingCAE.dataEntryId,
        duplicateStatus: previa?.status ?? null,
        message: 'Este documento ya fue enviado anteriormente.',
      };
    }
  }

  // ── Dedup sin CAE: clave fuerte proveedor + nro de comprobante ──────────────
  const dedupeKey = buildStrongDedupeKey({
    supplier: aiAnalysis?.extractedData?.supplier ?? null,
    invoiceNumber: aiAnalysis?.extractedData?.invoiceNumber ?? null,
  });
  if (dedupeKey) {
    const existingDup = await db.dataEntry.findFirst({
      where: { connectionId: input.connectionId, dedupeKey, status: { not: 'REJECTED' } },
      select: { id: true, status: true },
    });
    if (existingDup) {
      return {
        isDuplicate: true,
        duplicateEntryId: existingDup.id,
        duplicateStatus: existingDup.status,
        message: 'Este comprobante ya fue enviado antes (mismo proveedor y número).',
      };
    }
  }

  // ── Clasificador en cascada ─────────────────────────────────────────────────
  // El clasificador razona sobre TEXT | PDF | IMAGE; un mensaje de WhatsApp es
  // texto libre a todos los efectos (el enum de persistencia sí lo distingue).
  const classifierSourceType =
    input.sourceType === 'WHATSAPP' || input.sourceType === 'TELEGRAM' ? 'TEXT' : input.sourceType;

  const classification = await classifyDocument({
    text: input.rawContent || (input.fileName ?? ''),
    enrichedText,
    industry,
    sourceType: classifierSourceType,
    costistId: input.costistId,
    companyId: input.companyId,
    dataEntryId: 'pending',
    supplierCuit,
    groqQuality: aiAnalysis?.quality ?? null,
    extractedData: (aiAnalysis?.extractedData as Record<string, unknown> | null) ?? null,
  });

  if (classification.qualityGate === 'FAIL' && rejectIllegible) {
    throw new ConflictError(
      classification.explanation ||
      'El documento es ilegible o no se pudo leer bien. Por favor, enviá una foto o archivo más claro y con mejor iluminación.',
    );
  }

  // ── Adjunto a Cloudinary (no bloquea el flujo si falla) ─────────────────────
  let fileUrl: string | null = null;
  if (input.fileData && input.fileMimeType && input.fileName) {
    try {
      fileUrl = await uploadToCloudinary(input.fileData, input.fileMimeType, input.fileName);
    } catch (err) {
      // No bloqueamos el flujo si Cloudinary falla — el archivo queda sin URL,
      // pero eso antes solo quedaba en logs de Railway, invisible para todos.
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Cloudinary] Upload failed:', err);
      await alerts.create({
        source: 'ingest',
        level: 'warning',
        message: `Falló el upload a Cloudinary de "${input.fileName}" (costistId: ${input.costistId}, canal: ${input.sourceType}): ${message}. La entrada se guarda sin archivo adjunto.`,
      });
    }
  }

  const aiJson = aiAnalysis ? JSON.stringify(aiAnalysis) : null;

  // DataEntry + ClassificationAudit + ProcessedCAE en UNA sola transacción.
  // Antes el DataEntry se creaba afuera: si la transacción de audit/CAE
  // fallaba (ej. dos envíos casi simultáneos del mismo comprobante chocando
  // contra el índice único de ProcessedCAE.cae — plausible en el webhook de
  // WhatsApp con reintentos), quedaba un DataEntry húerfano sin
  // ClassificationAudit. Por el header de este archivo: una entrada sin
  // audit es invisible para Validaciones, se saltea la aprobación masiva, y
  // nunca dispara el libro mayor ni el populador. Ahora, si algo falla,
  // no queda nada a medio crear.
  const entry = await db.$transaction(async (tx) => {
    const created = await tx.dataEntry.create({
      data: {
        connectionId: input.connectionId,
        costistId: input.costistId,
        // La PERSONA que lo subió, cuando la hay. `costistId` es el dueño de la
        // conexión, no quien mandó el papel.
        uploadedBy: input.uploadedBy ?? null,
        costStructureId: input.costStructureId ?? null,
        rawContent: input.rawContent || (input.fileName ? `[Archivo: ${input.fileName}]` : ''),
        sourceType: input.sourceType,
        status: 'PENDING',
        fileName: input.fileName ?? null,
        fileData: null,           // ya no guardamos base64 en la DB
        fileMimeType: input.fileMimeType ?? null,
        fileUrl,
        dedupeKey,
        reviewNote: aiJson,
      },
    });

    await tx.classificationAudit.create({
      data: {
        dataEntryId: created.id,
        companyId: input.companyId,
        costistId: input.costistId,
        qualityGate: classification.qualityGate,
        definitiveSignal: classification.definitiveSignal,
        corroboratingSignals: classification.signals as unknown as Parameters<typeof tx.classificationAudit.create>[0]['data']['corroboratingSignals'],
        numericValidationDelta: 0,
        supplierFingerprintUsed: classification.supplierFingerprintUsed,
        aiUsed: classification.aiUsed,
        confidenceCap: classification.confidenceCap,
        documentType: classification.documentType,
        costSection: classification.costSection,
        confidence: classification.confidence,
        requiresReview: classification.requiresReview,
        intent: classification.intent,
        industryCategory: classification.industryCategory,
        explanation: classification.explanation,
      },
    });

    if (cae) {
      await tx.processedCAE.create({
        data: { cae, dataEntryId: created.id, companyId: input.companyId },
      });
    }

    return created;
  });

  return {
    isDuplicate: false,
    id: entry.id,
    status: entry.status,
    aiResponse: aiJson,
    classification: {
      documentType: classification.documentType,
      costSection: classification.costSection,
      confidence: classification.confidence,
      requiresReview: classification.requiresReview,
      qualityGate: classification.qualityGate,
    },
  };
}
