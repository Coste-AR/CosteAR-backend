import type { PrismaClient, DataEntryStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { NotFoundError, ForbiddenError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { extractCuits } from '../../infrastructure/classifier/utils/cuit-validator.js';
import { buildLedgerDraft } from './ledger-builder.js';
import {
  detectarSenalCondicionIva,
  contradiceLaCondicionDeclarada,
  notaDeRevision,
} from './condicion-iva-signal.js';
import { populateCostStructureFromApproval } from './cost-structure-populator.js';
import { SystemAlertService } from '../system/system-alert-service.js';

export class ValidacionesService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly alerts: SystemAlertService = new SystemAlertService(),
  ) {}

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
          fileName: true, fileMimeType: true, fileUrl: true, costStructureId: true,
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

    // A qué CostStructure apuntaría cada entrada si se aprobara AHORA —
    // mismo criterio que usa el populador (costStructureId explícito, o la
    // activa/borrador de esa empresa). Sirve para que Validaciones muestre
    // el selector de departamento ANTES de aprobar cuando es Costeo por
    // Procesos, sin esperar a que el documento caiga en la cola de pendientes.
    const targetByEntry = await this.resolveTargetStructures(costistId, items);
    const itemsWithTarget = items.map((e) => ({ ...e, targetCostStructure: targetByEntry.get(e.id) ?? null }));

    return { items: itemsWithTarget, total, page, limit };
  }

  /** Ver comentario en `listPending`. */
  private async resolveTargetStructures(
    costistId: string,
    items: { id: string; costStructureId: string | null; connection: { company: { id: string } } }[],
  ): Promise<Map<string, { id: string; productName: string; costingSystem: string } | null>> {
    const explicitIds = [...new Set(items.filter((e) => e.costStructureId).map((e) => e.costStructureId!))];
    const fallbackCompanyIds = [...new Set(items.filter((e) => !e.costStructureId).map((e) => e.connection.company.id))];

    const [explicitStructures, fallbackStructures] = await Promise.all([
      explicitIds.length
        ? this.db.costStructure.findMany({
            where: { id: { in: explicitIds }, deletedAt: null },
            select: { id: true, productName: true, costingSystem: true },
          })
        : Promise.resolve([]),
      fallbackCompanyIds.length
        ? this.db.costStructure.findMany({
            where: { companyId: { in: fallbackCompanyIds }, userId: costistId, status: { in: ['ACTIVE', 'DRAFT'] }, deletedAt: null },
            orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
            select: { id: true, productName: true, costingSystem: true, companyId: true },
          })
        : Promise.resolve([]),
    ]);

    const byId = new Map(explicitStructures.map((s) => [s.id, s]));
    // El primero por companyId gana (orderBy ya prioriza ACTIVE y lo más reciente).
    const byCompany = new Map<string, (typeof fallbackStructures)[number]>();
    for (const s of fallbackStructures) {
      if (!byCompany.has(s.companyId)) byCompany.set(s.companyId, s);
    }

    const result = new Map<string, { id: string; productName: string; costingSystem: string } | null>();
    for (const e of items) {
      result.set(e.id, e.costStructureId ? (byId.get(e.costStructureId) ?? null) : (byCompany.get(e.connection.company.id) ?? null));
    }
    return result;
  }

  /**
   * Lista el historial de entradas ya resueltas (APPROVED / REJECTED / CORRECTED).
   */
  async listHistorial(costistId: string, page = 1, limit = 20, companyId?: string) {
    const skip = (page - 1) * limit;
    const whereClause: any = {
      costistId,
      status: { in: ['APPROVED', 'REJECTED', 'CORRECTED'] },
    };
    if (companyId) {
      whereClause.connection = { companyId };
    }
    const [items, total] = await Promise.all([
      this.db.dataEntry.findMany({
        where: whereClause,
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
        where: whereClause,
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
      /** Costeo por Procesos: departamento elegido por el costista al aprobar.
       *  Decisión siempre humana — la IA nunca lo sugiere, salvo el default de
       *  UI para Materia Prima (depto. 1), que igual llega acá como elección
       *  explícita del usuario. Sin esto, el documento queda pendiente. */
      processDepartmentId?: string | null;
    },
  ) {
    const entry = await this.db.dataEntry.findUnique({
      where: { id: entryId },
      // `condicionIva` viaja acá, dentro del select que ya se hacía: el importe
      // que entra al libro mayor (neto para un RI, total con IVA para un
      // monotributista/exento) lo decide la EMPRESA, no el documento. Es una
      // columna más en una query existente, sin viaje extra a la base.
      include: {
        connection: {
          select: { companyId: true, company: { select: { condicionIva: true } } },
        },
      },
    });
    if (!entry) throw new NotFoundError('Entrada no encontrada');
    if (entry.costistId !== costistId) throw new ForbiddenError('No tenés permiso para revisar esta entrada');
    if (entry.status !== 'PENDING') throw new ForbiddenError('Solo se pueden revisar entradas pendientes');

    // El departamento es una elección del costista sobre SU propia estructura:
    // se valida acá (no en el populador, que corre después y no-fatal) para
    // no dejar guardado un FK a un departamento de otra empresa/usuario.
    if (input.processDepartmentId) {
      const dept = await this.db.processDepartment.findFirst({
        where: { id: input.processDepartmentId, deletedAt: null },
        select: { structure: { select: { id: true, userId: true } } },
      });
      if (!dept || dept.structure.userId !== costistId) {
        throw new ForbiddenError('El departamento elegido no pertenece a una estructura tuya.');
      }
      if (entry.costStructureId && dept.structure.id !== entry.costStructureId) {
        throw new ForbiddenError('El departamento elegido no corresponde al producto de este documento.');
      }
    }

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
          costistaNote: input.note ?? null,
          correctedContent: input.correctedContent ?? null,
          reviewedAt: new Date(),
          reviewedBy: costistId,
          // undefined ⇒ Prisma no toca la columna (nadie eligió departamento).
          processDepartmentId: input.processDepartmentId,
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

          if (overrode && (truthDocumentType !== audit.documentType || truthCostSection !== audit.costSection)) {
            await tx.dailySignal.create({
              data: {
                type: 'USER_CORRECTION',
                source: 'VALIDACIONES_CORRECCION',
                content: 'El costista corrigió la clasificación del documento.',
                context: {
                  entryId,
                  original: { type: audit.documentType, section: audit.costSection },
                  correction: { type: truthDocumentType, section: truthCostSection },
                  explanation: audit.explanation
                },
                userId: costistId
              }
            });
          }

          // ── Cerrar el círculo: el documento aprobado entra al libro mayor ──────
          // Línea de costo trazable (monto, período, sección) linkeada a su
          // documento de origen. Solo si hay un monto utilizable; si no, queda
          // para carga manual del costista. La sección es la verdad final.
          if (truthCostSection && truthCostSection !== 'DESCONOCIDO') {
            const draft = buildLedgerDraft({
              aiReviewNote: entry.reviewNote,           // JSON del análisis IA (antes de sobrescribir)
              documentType: truthDocumentType,
              fallbackDescription: entry.fileName ?? u.rawContent.slice(0, 120),
              condicionIva: entry.connection.company.condicionIva,
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
        const message = err instanceof Error ? err.message : String(err);
        console.error('[ledger] No se pudo crear la línea de costo:', err);
        await this.alerts.create({
          source: 'validaciones',
          level: 'error',
          message: `No se pudo crear la línea de libro mayor para la entrada ${entryId}: ${message}`,
        });
      }
    }

    // ── Señal fiscal de la IA → bandera accionable en la empresa ─────────────
    // El prompt le pide a la IA que marque en `qualityNote` los indicios de que
    // la empresa NO es Responsable Inscripto ("Factura C", "Consumidor Final",
    // "Monotributista", "Responsable No Inscripto"). Hasta acá esa cadena moría
    // adentro del JSON de `reviewNote` sin cambiar nada. Si contradice la
    // condición declarada, ahora levanta bandera en `Company` y deja una
    // DailySignal. NO cambia la condición sola: eso es un hecho registral, lo
    // confirma el costista. No-fatal: nunca puede voltear una aprobación.
    if (input.status === 'APPROVED' || input.status === 'CORRECTED') {
      try {
        const senal = detectarSenalCondicionIva({
          aiReviewNote: entry.reviewNote,
          rawContent: entry.rawContent,
        });
        const declarada = entry.connection.company.condicionIva;
        if (senal && contradiceLaCondicionDeclarada(senal, declarada)) {
          const nota = notaDeRevision(senal, {
            documento: entry.fileName ?? entry.rawContent.slice(0, 80),
          });
          await this.db.company.update({
            where: { id: entry.connection.companyId },
            data: {
              condicionIvaRevisar: true,
              condicionIvaRevisarNota: nota,
              condicionIvaRevisarAt: new Date(),
            },
          });
          await this.db.dailySignal.create({
            data: {
              type: 'IMPROVEMENT_REPORT',
              source: 'VALIDACIONES_CORRECCION',
              status: 'PENDING',
              content: `Posible condición frente al IVA incorrecta: ${senal.indicio}`,
              context: {
                action: 'CONDICION_IVA_SOSPECHOSA',
                companyId: entry.connection.companyId,
                entryId,
                declarada,
                sugerida: senal.sugerida,
                indicio: senal.indicio,
                origen: senal.origen,
              },
              userId: costistId,
            },
          });
        }
      } catch (err) {
        console.error('[condicion-iva] No se pudo registrar la señal fiscal:', err);
      }
    }

    // Populación automática de CostStructure: no-fatal, fuera de transacción.
    // Solo se ejecuta cuando se aprueba/corrige (no en rechazo).
    // populationWarning viaja en la respuesta para que quien aprobó el
    // documento se entere EN EL MOMENTO si el dato no se aplicó — antes esto
    // solo se sabía revisando /admin/system-alerts.
    let populationWarning: string | undefined;
    if (input.status === 'APPROVED' || input.status === 'CORRECTED') {
      // Leer el audit actualizado para obtener la sección verdadera
      try {
        const latestAudit = await this.db.classificationAudit.findFirst({
          where: { dataEntryId: entryId },
          orderBy: { createdAt: 'desc' },
          select: { costSection: true, costaCorrection: true },
        });
        const correctionSection = latestAudit?.costaCorrection
          ? (latestAudit.costaCorrection as Record<string, string>)['section']
          : undefined;
        const lp = ledgerPayload as { costSection?: string; supplier?: string | null; amount?: number } | null;
        const finalSection = correctionSection ?? latestAudit?.costSection ?? lp?.costSection;

        if (finalSection && finalSection !== 'DESCONOCIDO') {
          const result = await populateCostStructureFromApproval(this.db, {
            companyId:           entry.connection.companyId,
            costistId,
            costSection:         finalSection,
            reviewNote:          entry.reviewNote,
            supplier:            lp?.supplier ?? null,
            costStructureId:     entry.costStructureId,
            amount:              lp?.amount ?? null,
            processDepartmentId: input.processDepartmentId ?? null,
          }, this.alerts);
          populationWarning = result.skippedReason;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[populator] Error al poblar CostStructure:', err);
        await this.alerts.create({
          source: 'validaciones',
          level: 'error',
          message: `No se pudo poblar CostStructure a partir de la aprobación de la entrada ${entryId}: ${message}`,
        });
        populationWarning = `No se pudo aplicar automáticamente a la estructura: ${message}`;
      }
    }

    return { ...updated, populationWarning };
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
  async bulkApproveConfident(
    costistId: string,
    companyId?: string,
  ): Promise<{ approved: number; skipped: number; populationWarnings: number }> {
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
    // Cuenta las aprobaciones cuyo dato NO se pudo aplicar a la estructura
    // (mismo motivo que en la revisión individual). Antes bulkApprove
    // descartaba por completo el resultado de review() por cada entrada —
    // alguien podía aprobar 20 documentos en un click y no enterarse de que
    // ninguno se cargó porque la empresa usa Costeo por Procesos.
    let populationWarnings = 0;
    for (const entry of pending) {
      const audit = entry.classificationAudits[0];
      // Solo las que el clasificador marcó como seguras (no requieren revisión).
      if (audit && !audit.requiresReview) {
        const result = await this.review(entry.id, costistId, { status: 'APPROVED' });
        if (result.populationWarning) populationWarnings++;
        approved++;
      } else {
        skipped++;
      }
    }
    return { approved, skipped, populationWarnings };
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

  /**
   * Cola de pendientes de Costeo por Procesos: documentos ya aprobados/corregidos
   * cuya clasificación final es MP/MOD/CIF pero que TODAVÍA no tienen departamento
   * asignado — o sea, documentos cuyo monto quedó sin acumular en ningún
   * `UnitMovementSchedule` porque nadie eligió a mano a qué etapa corresponden.
   * Nada se pierde: hasta que se asignan, quedan visibles acá.
   */
  async listUnassignedForStructure(costistId: string, costStructureId: string) {
    const structure = await this.db.costStructure.findFirst({
      where: { id: costStructureId, userId: costistId, deletedAt: null },
      select: { id: true, costingSystem: true },
    });
    if (!structure) throw new NotFoundError('Estructura de costos no encontrada');
    if (structure.costingSystem !== 'PROCESSES') {
      throw new UnprocessableEntityError('Esta estructura no usa Costeo por Procesos.');
    }

    const entries = await this.db.dataEntry.findMany({
      where: {
        costistId,
        costStructureId,
        processDepartmentId: null,
        status: { in: ['APPROVED', 'CORRECTED'] },
      },
      orderBy: { reviewedAt: 'desc' },
      select: {
        id: true, rawContent: true, fileName: true, fileUrl: true, reviewedAt: true,
        classificationAudits: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { costSection: true, documentType: true },
        },
      },
    });

    // Solo MP/MOD/CIF tienen un departamento al que ir — el resto (ventas,
    // gastos) no pertenece a esta cola aunque haya quedado sin costStructureId
    // específico en algún caso raro.
    const relevant = new Set(['MATERIA_PRIMA', 'MANO_DE_OBRA', 'COSTOS_INDIRECTOS']);
    return entries.filter((e) => relevant.has(e.classificationAudits[0]?.costSection ?? ''));
  }

  /**
   * Asigna (o reasigna) el departamento de Costeo por Procesos de un documento
   * YA aprobado, y dispara la acumulación de su monto en `UnitMovementSchedule`
   * que quedó pendiente por falta de esa decisión. Reintentable: si ya se había
   * acumulado antes con este mismo departamento, no vuelve a sumarlo dos veces
   * porque un documento solo puede tener UN `processDepartmentId` a la vez — para
   * cambiarlo hay que revertir a mano en el cuadro (ver nota en el HTTP handler).
   */
  async assignDepartment(entryId: string, costistId: string, processDepartmentId: string) {
    const entry = await this.db.dataEntry.findUnique({
      where: { id: entryId },
      include: { connection: { select: { companyId: true } } },
    });
    if (!entry) throw new NotFoundError('Entrada no encontrada');
    if (entry.costistId !== costistId) throw new ForbiddenError('No tenés permiso');
    if (entry.status !== 'APPROVED' && entry.status !== 'CORRECTED') {
      throw new UnprocessableEntityError('Solo se puede asignar departamento a un documento ya aprobado.');
    }
    if (entry.processDepartmentId) {
      throw new UnprocessableEntityError(
        'Este documento ya tiene un departamento asignado. Corregilo desde el cuadro de movimiento del departamento actual.',
      );
    }

    const dept = await this.db.processDepartment.findFirst({
      where: { id: processDepartmentId, deletedAt: null },
      select: { structure: { select: { id: true, userId: true } } },
    });
    if (!dept || dept.structure.userId !== costistId) {
      throw new ForbiddenError('El departamento elegido no pertenece a una estructura tuya.');
    }
    if (entry.costStructureId && dept.structure.id !== entry.costStructureId) {
      throw new ForbiddenError('El departamento elegido no corresponde al producto de este documento.');
    }

    const ledger = await this.db.costLedgerEntry.findFirst({
      where: { dataEntryId: entryId },
      orderBy: { createdAt: 'desc' },
      select: { costSection: true, amount: true },
    });

    await this.db.dataEntry.update({ where: { id: entryId }, data: { processDepartmentId } });

    if (!ledger) {
      // Se aprobó sin generar línea de libro mayor (sin monto reconocible en su
      // momento): queda asignado al departamento, pero no hay nada para acumular.
      return { populationWarning: 'El documento no tiene un monto registrado — cargá el importe a mano en el cuadro del departamento.' };
    }

    const result = await populateCostStructureFromApproval(this.db, {
      companyId:           entry.connection.companyId,
      costistId,
      costSection:         ledger.costSection,
      reviewNote:          entry.reviewNote,
      supplier:            null,
      costStructureId:     entry.costStructureId,
      amount:              Number(ledger.amount),
      processDepartmentId,
    }, this.alerts);

    return { populationWarning: result.skippedReason };
  }

}
