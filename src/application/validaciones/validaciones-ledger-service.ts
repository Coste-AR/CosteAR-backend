import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../../domain/errors/domain-error.js';

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

    return {
      entries: entries.map((e) => ({
        ...e,
        amount: Number(e.amount),
      })),
      totalsBySection,
      periods,
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
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
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
