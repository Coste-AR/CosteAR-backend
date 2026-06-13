import type { PrismaClient, DataEntryStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { NotFoundError, ForbiddenError } from '../../domain/errors/domain-error.js';
import { extractCuits } from '../../infrastructure/classifier/utils/cuit-validator.js';
import { buildLedgerDraft } from './ledger-builder.js';

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

    // El payload del libro mayor se arma dentro de la transacción (necesita la
    // verdad de la clasificación) pero se INSERTA después de que la aprobación
    // commitea, de forma no-fatal: una línea de costo mal formada nunca puede
    // revertir ni bloquear la aprobación de un documento.
    let ledgerPayload: {
      companyId: string; costistId: string; dataEntryId: string;
      period: string; costSection: string; documentType: string;
      supplier: string | null; description: string; amount: number;
      currency: string; docDate: Date | null; sourceImageUrl: string | null;
      confidence: number | null; aiUsed: boolean; wasCorrected: boolean;
    } | null = null;

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

          // ── Cerrar el círculo: el documento aprobado entra al libro mayor ──────
          // Línea de costo trazable (monto, período, sección) linkeada a su
          // documento de origen. Solo si hay un monto utilizable; si no, queda
          // para carga manual del costista. La sección es la verdad final.
          if (truthCostSection && truthCostSection !== 'DESCONOCIDO') {
            const draft = buildLedgerDraft({
              aiReviewNote: entry.reviewNote,           // JSON del análisis IA (antes de sobrescribir)
              documentType: truthDocumentType,
              fallbackDescription: entry.fileName ?? u.rawContent.slice(0, 120),
            });
            if (draft) {
              ledgerPayload = {
                companyId:      entry.connection.companyId,
                costistId,
                dataEntryId:    entryId,
                period:         draft.period,
                costSection:    truthCostSection,
                documentType:   truthDocumentType,
                supplier:       draft.supplier,
                description:    draft.description,
                amount:         draft.amount,
                currency:       draft.currency,
                docDate:        draft.docDate,
                sourceImageUrl: entry.fileUrl,
                confidence:     audit.confidence,
                aiUsed:         audit.aiUsed,
                wasCorrected:   overrode,
              };
            }
          }

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

    // Línea del libro mayor: fuera de la transacción y no-fatal. Si falla, la
    // aprobación ya quedó firme; solo se loguea (no se pierde el documento).
    if (ledgerPayload) {
      try {
        await this.db.costLedgerEntry.create({ data: ledgerPayload });
      } catch (err) {
        console.error('[ledger] No se pudo crear la línea de costo:', err);
      }
    }

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
   * Métricas de precisión del clasificador para el costista.
   *
   * Mide, sobre las validaciones que el costista ya revisó, cuántas estaban
   * bien clasificadas (las aprobó sin tocar) vs cuántas tuvo que corregir.
   * Sirve para darle visibilidad y para detectar si el sistema está mejorando.
   */
  async getAccuracyStats(costistId: string) {
    const audits = await this.db.classificationAudit.findMany({
      where: { costistId, validatedByCostista: true },
      select: {
        costaOverrode: true,
        confidence: true,
        aiUsed: true,
        requiresReview: true,
        documentType: true,
        createdAt: true,
      },
    });

    const total = audits.length;
    const corrected = audits.filter((a) => a.costaOverrode).length;
    const correct = total - corrected;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : null;

    // Precisión cuando el sistema dijo estar seguro (no requería revisión).
    const confident = audits.filter((a) => !a.requiresReview);
    const confidentCorrect = confident.filter((a) => !a.costaOverrode).length;
    const confidentAccuracy = confident.length > 0
      ? Math.round((confidentCorrect / confident.length) * 100)
      : null;

    // Desglose reglas vs IA.
    const byEngine = (used: boolean) => {
      const subset = audits.filter((a) => a.aiUsed === used);
      const ok = subset.filter((a) => !a.costaOverrode).length;
      return {
        total: subset.length,
        accuracy: subset.length > 0 ? Math.round((ok / subset.length) * 100) : null,
      };
    };

    return {
      total,
      correct,
      corrected,
      accuracy,                 // % global aprobado sin tocar
      confidentAccuracy,        // % acierto cuando NO pedía revisión (lo importante)
      rules: byEngine(false),   // precisión de las reglas deterministas
      ai: byEngine(true),       // precisión del fallback de IA
    };
  }

  /**
   * Panel "qué necesita mi atención hoy" — resumen cruzando todas las empresas
   * del costista. Por cada empresa: cuántas validaciones esperan, cuántas son
   * dudosas (requieren revisión por conflicto/baja confianza), y hace cuánto
   * que no llega nada (para detectar clientes desactualizados).
   */
  async getAttentionOverview(costistId: string) {
    const [companies, pending] = await Promise.all([
      this.db.company.findMany({
        where: { userId: costistId, isActive: true },
        select: { id: true, name: true, industry: true },
      }),
      this.db.dataEntry.findMany({
        where: { costistId, status: 'PENDING' },
        select: {
          createdAt: true,
          connection: { select: { companyId: true } },
          classificationAudits: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { requiresReview: true },
          },
        },
      }),
    ]);

    // Última actividad por empresa (cualquier estado), para marcar desactualizadas.
    const recent = await this.db.dataEntry.findMany({
      where: { costistId },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: { createdAt: true, connection: { select: { companyId: true } } },
    });
    const lastActivity: Record<string, string> = {};
    for (const r of recent) {
      const cid = r.connection.companyId;
      if (!lastActivity[cid]) lastActivity[cid] = r.createdAt.toISOString();
    }

    const byCompany: Record<string, { pending: number; conflicts: number }> = {};
    for (const e of pending) {
      const cid = e.connection.companyId;
      byCompany[cid] ??= { pending: 0, conflicts: 0 };
      byCompany[cid].pending++;
      if (e.classificationAudits[0]?.requiresReview) byCompany[cid].conflicts++;
    }

    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const items = companies.map((c) => {
      const counts = byCompany[c.id] ?? { pending: 0, conflicts: 0 };
      const last = lastActivity[c.id] ?? null;
      const daysSince = last ? Math.floor((now - new Date(last).getTime()) / DAY) : null;
      return {
        companyId: c.id,
        companyName: c.name,
        industry: c.industry,
        pending: counts.pending,
        conflicts: counts.conflicts,
        lastActivity: last,
        daysSinceActivity: daysSince,
        // "Necesita atención" si hay conflictos, pendientes acumulados, o lleva
        // ≥14 días sin novedades teniendo historial.
        needsAttention: counts.conflicts > 0 || counts.pending >= 5 || (daysSince != null && daysSince >= 14),
      };
    });

    // Orden: primero las que más atención piden.
    items.sort((a, b) => (b.conflicts - a.conflicts) || (b.pending - a.pending));
    return items;
  }

  /**
   * Aprobación masiva de las entradas "seguras": las que el clasificador
   * resolvió sin necesidad de revisión (requiresReview = false en su audit).
   * Las dudosas (conflicto / baja confianza) NO se tocan — quedan para revisión
   * manual. Devuelve cuántas aprobó. Reusa review() para que cada aprobación
   * dispare el libro mayor y el aprendizaje, igual que una aprobación individual.
   */
  async bulkApproveConfident(costistId: string, companyId?: string): Promise<{ approved: number; skipped: number }> {
    const pending = await this.db.dataEntry.findMany({
      where: {
        costistId,
        status: 'PENDING',
        ...(companyId ? { connection: { companyId } } : {}),
      },
      select: {
        id: true,
        classificationAudits: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { requiresReview: true },
        },
      },
    });

    let approved = 0;
    let skipped = 0;
    for (const entry of pending) {
      const audit = entry.classificationAudits[0];
      // Solo las que el clasificador marcó como seguras (no requieren revisión).
      if (audit && !audit.requiresReview) {
        await this.review(entry.id, costistId, { status: 'APPROVED' });
        approved++;
      } else {
        skipped++;
      }
    }
    return { approved, skipped };
  }

  /**
   * Libro mayor de costos: líneas respaldadas por documentos aprobados,
   * agrupadas por sección, con totales por período. Cada línea linkea a su
   * documento de origen (imagen) para trazabilidad total.
   */
  async getLedger(costistId: string, opts: { companyId?: string; period?: string }) {
    const entries = await this.db.costLedgerEntry.findMany({
      where: {
        costistId,
        ...(opts.companyId ? { companyId: opts.companyId } : {}),
        ...(opts.period ? { period: opts.period } : {}),
      },
      orderBy: [{ period: 'desc' }, { docDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });

    // Totales por sección (en ARS; otras monedas se listan aparte sin sumar).
    const totalsBySection: Record<string, number> = {};
    for (const e of entries) {
      if (e.currency === 'ARS') {
        totalsBySection[e.costSection] = (totalsBySection[e.costSection] ?? 0) + Number(e.amount);
      }
    }

    // Períodos disponibles (para el selector del frontend).
    const periods = [...new Set(entries.map((e) => e.period))].sort().reverse();

    return {
      entries: entries.map((e) => ({
        ...e,
        amount: Number(e.amount),
      })),
      totalsBySection,
      periods,
    };
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
