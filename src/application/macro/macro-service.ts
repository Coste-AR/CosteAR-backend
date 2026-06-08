import type { PrismaClient, MacroSource } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';

/**
 * Acceso a los snapshots macroeconómicos (BCRA, INDEC, ARCA, paritarias).
 * Los snapshots son inmutables: este servicio solo lee y registra nuevos.
 */
export class MacroService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** Último valor conocido de cada indicador. */
  async latest() {
    const rows = await this.db.macroSnapshot.findMany({
      orderBy: { effectiveDate: 'desc' },
      distinct: ['source', 'indicatorCode'],
    });
    return rows;
  }

  async history(params: { source?: MacroSource; indicatorCode?: string; from?: Date; to?: Date }) {
    return this.db.macroSnapshot.findMany({
      where: {
        ...(params.source ? { source: params.source } : {}),
        ...(params.indicatorCode ? { indicatorCode: params.indicatorCode } : {}),
        ...(params.from || params.to
          ? { effectiveDate: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
          : {}),
      },
      orderBy: { effectiveDate: 'asc' },
      take: 500,
    });
  }

  /** Registra un snapshot nuevo (idempotente por source+code+fecha). */
  async record(snapshot: {
    source: MacroSource;
    indicatorCode: string;
    value: number;
    effectiveDate: Date;
    metadata?: unknown;
  }) {
    return this.db.macroSnapshot.upsert({
      where: {
        source_indicatorCode_effectiveDate: {
          source: snapshot.source,
          indicatorCode: snapshot.indicatorCode,
          effectiveDate: snapshot.effectiveDate,
        },
      },
      create: {
        source: snapshot.source,
        indicatorCode: snapshot.indicatorCode,
        value: snapshot.value,
        effectiveDate: snapshot.effectiveDate,
        metadata: (snapshot.metadata as object) ?? undefined,
      },
      update: { value: snapshot.value },
    });
  }
}
