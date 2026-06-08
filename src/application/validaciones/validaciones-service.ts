import type { PrismaClient, DataEntryStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { NotFoundError, ForbiddenError } from '../../domain/errors/domain-error.js';

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
        include: {
          connection: {
            include: { company: { select: { id: true, name: true, industry: true } } },
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
    },
  ) {
    const entry = await this.db.dataEntry.findUnique({ where: { id: entryId } });
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
          include: { company: { select: { id: true, name: true } } },
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
