import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../../domain/errors/domain-error.js';

/**
 * CL-01 — LÍNEAS ANTERIORES A LA CORRECCIÓN DEL IVA.
 *
 * Antes de CL-01 el costeo tomaba el total del comprobante (con IVA) en vez del
 * neto. Esas líneas quedaron infladas entre un 10,5 % y un 21 % según la
 * alícuota. La decisión fue MARCARLAS, no reescribirlas: el recálculo quedó
 * diferido y ningún importe se toca acá.
 *
 * `criterioImporteIva` viene estampado en cada fila (por la migración
 * `20260813120000_add_criterio_importe_iva` en las viejas, por `ledger-builder`
 * en las nuevas). Este servicio solo lo traduce a algo mostrable.
 */
const CRITERIO_PRE_FIX = 'ANTERIOR_A_LA_CORRECCION';

/** Cartel de una línea, en castellano y sin nomenclatura interna. */
const AVISO_POR_CRITERIO: Record<string, { nivel: 'alerta' | 'info'; texto: string } | null> = {
  ANTERIOR_A_LA_CORRECCION: {
    nivel: 'alerta',
    texto:
      'Importe anterior a la corrección del IVA: se tomó el total del comprobante en vez del ' +
      'neto, así que puede estar sobrevaluado. El IVA no es costo para un Responsable Inscripto.',
  },
  SIN_EVIDENCIA: {
    nivel: 'info',
    texto:
      'No se pudo verificar contra el comprobante si el importe incluye IVA. Revisalo si el ' +
      'costo del período no cierra.',
  },
  NETO_SIN_IVA: null,
  TOTAL_CON_IVA: null,
  CARGA_MANUAL: null,
};

export class ValidacionesLedgerService {
  constructor(private readonly db: PrismaClient = prisma) {}

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

    const totalsBySection: Record<string, number> = {};
    for (const e of entries) {
      if (e.currency === 'ARS') {
        totalsBySection[e.costSection] = (totalsBySection[e.costSection] ?? 0) + Number(e.amount);
      }
    }

    const periods = [...new Set(entries.map((e) => e.period))].sort().reverse();

    const mapped = entries.map((e) => {
      // Una fila sin marca solo puede venir de antes de la migración: se informa
      // como no verificable en vez de dejarla pasar como si estuviera revisada.
      const criterio = e.criterioImporteIva ?? 'SIN_EVIDENCIA';
      return {
        ...e,
        amount: Number(e.amount),
        criterioImporteIva: criterio,
        ivaIncluidoEstimado:
          e.ivaIncluidoEstimado == null ? null : Number(e.ivaIncluidoEstimado),
        /** `true` solo si la línea es demostrablemente anterior a la corrección. */
        importeAnteriorAlFixIva: criterio === CRITERIO_PRE_FIX,
        /** Cartel listo para la pantalla, o `null` si la línea no tiene nada que avisar. */
        avisoImporte: AVISO_POR_CRITERIO[criterio] ?? null,
      };
    });

    // Resumen para el cartel de cabecera: cuántas líneas hay que mirar y por
    // cuánto IVA podrían estar sobrevaluadas. Es informativo: NO se resta de
    // ningún total ni se aplica a ningún costo.
    const preFix = mapped.filter((e) => e.importeAnteriorAlFixIva);
    const revisionImporteIva = {
      lineasAnterioresAlFix: preFix.length,
      ivaIncluidoEstimado: preFix.reduce((acc, e) => acc + (e.ivaIncluidoEstimado ?? 0), 0),
      importeAfectado: preFix.reduce((acc, e) => acc + e.amount, 0),
      lineasNoVerificables: mapped.filter((e) => e.criterioImporteIva === 'SIN_EVIDENCIA').length,
    };

    return {
      entries: mapped,
      totalsBySection,
      periods,
      revisionImporteIva,
    };
  }

  async createManualLedgerEntry(costistId: string, input: {
    companyId: string;
    period: string;
    costSection: string;
    description: string;
    amount: number;
    supplier?: string;
    currency?: string;
    docDate?: string;
  }) {
    const company = await this.db.company.findFirst({
      where: { id: input.companyId, userId: costistId },
      select: { id: true },
    });
    if (!company) throw new ForbiddenError('Empresa no encontrada o sin acceso');

    await this.requirePeriodExists(input.companyId, input.period);

    return this.db.costLedgerEntry.create({
      data: {
        companyId:    input.companyId,
        costistId,
        dataEntryId:  null,
        period:       input.period,
        costSection:  input.costSection,
        documentType: 'CARGA_MANUAL',
        supplier:     input.supplier?.trim() || null,
        description:  input.description.trim(),
        amount:       input.amount,
        currency:     input.currency?.trim() || 'ARS',
        docDate:      input.docDate ? new Date(input.docDate) : null,
        sourceImageUrl: null,
        confidence:   null,
        aiUsed:       false,
        wasCorrected: false,
        // La tipeó el costista: no hay comprobante contra el cual auditar el IVA.
        criterioImporteIva: 'CARGA_MANUAL',
      },
    });
  }

  async updateLedgerEntry(costistId: string, id: string, input: {
    costSection?: string;
    description?: string;
    amount?: number;
    supplier?: string | null;
    period?: string;
    currency?: string;
    docDate?: string | null;
  }) {
    const existing = await this.db.costLedgerEntry.findUnique({
      where: { id },
      select: { costistId: true, companyId: true },
    });
    if (!existing) throw new NotFoundError('Línea no encontrada');
    if (existing.costistId !== costistId) throw new ForbiddenError('Sin permiso sobre esta línea');

    if (input.period !== undefined) {
      await this.requirePeriodExists(existing.companyId, input.period);
    }

    return this.db.costLedgerEntry.update({
      where: { id },
      data: {
        ...(input.costSection !== undefined ? { costSection: input.costSection } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        // Si el costista corrige el importe a mano, la bandera del IVA deja de
        // aplicar: el número ya no es el que dejó el criterio viejo. Se pasa a
        // carga manual en vez de seguir mostrando una alerta que ya no es cierta.
        ...(input.amount !== undefined
          ? { amount: input.amount, criterioImporteIva: 'CARGA_MANUAL', ivaIncluidoEstimado: null }
          : {}),
        ...(input.supplier !== undefined ? { supplier: input.supplier?.trim() || null } : {}),
        ...(input.period !== undefined ? { period: input.period } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.docDate !== undefined ? { docDate: input.docDate ? new Date(input.docDate) : null } : {}),
      },
    });
  }

  async deleteLedgerEntry(costistId: string, id: string) {
    const existing = await this.db.costLedgerEntry.findUnique({ where: { id }, select: { costistId: true } });
    if (!existing) throw new NotFoundError('Línea no encontrada');
    if (existing.costistId !== costistId) throw new ForbiddenError('Sin permiso sobre esta línea');
    await this.db.costLedgerEntry.delete({ where: { id } });
    return { success: true };
  }

  private async requirePeriodExists(companyId: string, period: string): Promise<void> {
    const structure = await this.db.costStructure.findFirst({
      where: { companyId, period },
      select: { id: true },
    });
    if (!structure) {
      throw new ValidationError(
        `El período ${period} no existe para esta empresa: creá primero la estructura de costos de ese mes`,
      );
    }
  }
}
