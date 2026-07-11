import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';

export class DataPointService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Obtiene la trazabilidad completa de un DataPoint.
   * - Datos actuales
   * - Historial inmutable de versiones (quién cambió qué y cuándo)
   * - Evidencia asociada (comprobantes, URLs)
   */
  async getTrace(id: string) {
    const dp = await this.db.dataPoint.findUnique({
      where: { id },
    });

    if (!dp) throw new NotFoundError('DataPoint no encontrado');

    const versions = await this.db.dataPointVersion.findMany({
      where: { dataPointId: dp.id },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        evidence: true,
      },
    });

    if (!dp) throw new NotFoundError('DataPoint no encontrado');

    return dp;
  }

  async getTraceByVersion(versionId: string) {
    const v = await this.db.dataPointVersion.findUnique({
      where: { id: versionId },
      select: { dataPointId: true }
    });
    if (!v) throw new NotFoundError('Versión de DataPoint no encontrada');
    return this.getTrace(v.dataPointId);
  }
}
