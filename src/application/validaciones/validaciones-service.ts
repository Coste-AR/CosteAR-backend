import type { PrismaClient, DataEntryStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { NotFoundError, ForbiddenError } from '../../domain/errors/domain-error.js';
import { extractCuits } from '../../infrastructure/classifier/utils/cuit-validator.js';

export class ValidacionesService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Lista las entradas pendientes de validación para el costista autenticado.
   * Paginadas, ordenadas por fecha de creación (más reciente primero).
   */
  async listPending(costistId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.db.dataEntry.findMany({
        where: { costistId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, rawContent: true, sourceType: true, status: true,
          correctedContent: true, reviewNote: true, reviewedAt: true, createdAt: true,
          fileName: true, fileMimeType: true, fileUrl: true,
          // fileData excluido del listado (legacy base64 — usar fileUrl)
          connection: {
            include: { company: { select: { id: true, name: true, industry: true } } },
          },
          // Incluir el audit de clasificación para mostrar la explicación
          classificationAudits: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              documentType: true, costSection: true, confidence: true,
              requiresReview: true, definitiveSignal: true, aiUsed: true,
              supplierFingerprintUsed: true, intent: true, industryCategory: true,
              explanation: true, corroboratingSignals: true,
            },
          },
        },
      }),
      this.db.dataEntry.count({ where: { costistId, status: 'PENDING' } }),
    ]);
    return { items, total, page, limit };
  }

  /**
   * Lista el historial de entradas ya resueltas (APPROVED / REJECTED / CORRECTED).
   */
  async listHistorial(costistId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.db.dataEntry.findMany({
        where: {
          costistId,
          status: { in: ['APPROVED', 'REJECTED', 'CORRECTED'] },
        },
        orderBy: { reviewedAt: 'desc' },
        skip,
        take: limit,
        include: {
          connection: {
            include: { company: { select: { id: true, name: true, industry: true } } },
          },
        },
      }),
      this.db.dataEntry.count({
        where: {
          costistId,
          status: { in: ['APPROVED', 'REJECTED', 'CORRECTED'] },
        },
      }),
    ]);
    return { items, total, page, limit };
  }

  /**
   * Cuenta las entradas pendientes para mostrar en el dashboard.
   */
  async countPending(costistId: string): Promise<number> {
    return this.db.dataEntry.count({ where: { costistId, status: 'PENDING' } });
  }

  /**
   * Revisa una entrada: APPROVED, REJECTED o CORRECTED.
   * Solo el costista dueño puede revisar.
   */
  async review(
    entryId: string,
    costistId: string,
    input: {
      status: 'APPROVED' | 'REJECTED' | 'CORRECTED';
      note?: string;
      correctedContent?: string;
      correctedDocumentType?: string;
      correctedCostSection?: string;
    },
  ) {
    const entry = await this.db.dataEntry.findUnique({
      where: { id: entryId },
      include: { connection: { select: { companyId: true } } },
    });
    if (!entry) throw new NotFoundError('Entrada no encontrada');
    if (entry.costistId !== costistId) throw new ForbiddenError('No tenés permiso para revisar esta entrada');
    if (entry.status !== 'PENDING') throw new ForbiddenError('Solo se pueden revisar entradas pendientes');

    const updated = await this.db.$transaction(async (tx) => {
      const u = await tx.dataEntry.update({
        where: { id: entryId },
        data: {
          status: input.status as DataEntryStatus,
          reviewNote: input.note ?? null,
          correctedContent: input.correctedContent ?? null,
          reviewedAt: new Date(),
          reviewedBy: costistId,
        },
      });
      await tx.validationHistory.create({
        data: {
          entryId,
          costistId,
          fromStatus: 'PENDING',
          toStatus: input.status as DataEntryStatus,
          note: input.note ?? null,
        },
      });

      // ── Update supplier fingerprint if approved or corrected ───────────────
      if (input.status === 'APPROVED' || input.status === 'CORRECTED') {
        const audit = await tx.classificationAudit.findFirst({
          where: { dataEntryId: entryId },
          orderBy: { createdAt: 'desc' },
        });

        if (audit) {
          const foundCuits = extractCuits(u.rawContent);
          const supplierCuit = foundCuits[0];
          const overrode = input.status === 'CORRECTED';

          // Verdad de oro: cuando el costista corrige, la clasificación CORRECTA
          // es la que él eligió, NO la que el sistema había puesto. Si no eligió
          // explícitamente, caemos a la clasificación original del audit.
          const truthDocumentType = overrode
            ? (input.correctedDocumentType ?? audit.documentType)
            : audit.documentType;
          const truthCostSection = overrode
            ? (input.correctedCostSection ?? audit.costSection)
            : audit.costSection;

          await tx.classificationAudit.update({
            where: { id: audit.id },
            data: {
              validatedByCostista: true,
              costaValidatedAt: new Date(),
              costaOverrode: overrode,
              costaCorrection: overrode
                ? { type: truthDocumentType, section: truthCostSection }
                : undefined,
            },
          });

          if (supplierCuit) {
            const companyId = entry.connection.companyId;

            const existing = await tx.supplierFingerprint.findFirst({
              where: { costistId, supplierCuit, companyId },
            });

            if (existing) {
              const timesSeenCorrect = overrode ? existing.timesSeenCorrect : existing.timesSeenCorrect + 1;
              const timesOverridden = overrode ? existing.timesOverridden + 1 : existing.timesOverridden;
              const total = timesSeenCorrect + timesOverridden;
              const bonus = total > 0 ? Math.min(25, Math.round((timesSeenCorrect / total) * 30)) : 0;

              await tx.supplierFingerprint.update({
                where: { id: existing.id },
                data: {
                  timesSeenCorrect,
                  timesOverridden,
                  confidenceBonus: bonus,
                  // Al corregir, el fingerprint aprende la clasificación CORRECTA
                  // (lo que eligió el costista), no la que el sistema erró.
                  documentType: overrode ? truthDocumentType : existing.documentType,
                  costSection: overrode ? truthCostSection : existing.costSection,
                },
              });
            } else if (!overrode) {
              await tx.supplierFingerprint.create({
                data: {
                  costistId,
                  companyId,
                  supplierCuit,
                  documentType: truthDocumentType,
                  costSection: truthCostSection,
                  timesSeenCorrect: 1,
                  timesOverridden: 0,
                  confidenceBonus: 5,
                },
              });
            } else {
              // Primera vez que vemos este proveedor y ya viene corregido:
              // creamos el fingerprint directamente con la verdad del costista,
              // así el aprendizaje no se pierde.
              await tx.supplierFingerprint.create({
                data: {
                  costistId,
                  companyId,
                  supplierCuit,
                  documentType: truthDocumentType,
                  costSection: truthCostSection,
                  timesSeenCorrect: 1,
                  timesOverridden: 0,
                  confidenceBonus: 5,
                },
              });
            }
          }
        }
      }

      return u;
    });
    return updated;
  }

  /**
   * Feed unificado de todas las entradas (todas los estados),
   * usado en el Centro de automatización para ver el flujo completo.
   */
  async listFeed(costistId: string, limit = 50) {
    const items = await this.db.dataEntry.findMany({
      where: { costistId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        connection: {
          include: { company: { select: { id: true, name: true, industry: true } } },
        },
        classificationAudits: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            documentType: true,
            costSection: true,
            confidence: true,
            requiresReview: true,
            aiUsed: true,
            definitiveSignal: true,
            explanation: true,
          },
        },
      },
    });
    return { data: items, total: items.length };
  }

  /**
   * Obtiene el historial completo de transiciones de una entrada.
   */
  async getEntryHistory(entryId: string, costistId: string) {
    const entry = await this.db.dataEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundError('Entrada no encontrada');
    if (entry.costistId !== costistId) throw new ForbiddenError('No tenés permiso');

    return this.db.validationHistory.findMany({
      where: { entryId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
