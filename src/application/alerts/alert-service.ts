import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit, type AuditContext } from '../audit/audit-logger.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';

/**
 * Sistema de alertas: márgenes bajo umbral, cambios macro, picos de costo.
 * El worker de recálculo crea las alertas; este servicio las lee y administra
 * la configuración de umbrales por usuario.
 */
export class AlertService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async list(userId: string, onlyUnread = false) {
    return this.db.alert.findMany({
      where: { userId, ...(onlyUnread ? { isRead: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markRead(userId: string, id: string) {
    const alert = await this.db.alert.findFirst({ where: { id, userId } });
    if (!alert) throw new NotFoundError('Alerta no encontrada');
    return this.db.alert.update({ where: { id }, data: { isRead: true, readAt: new Date() } });
  }

  async getSettings(userId: string) {
    const existing = await this.db.alertSetting.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.db.alertSetting.create({ data: { userId } });
  }

  async updateSettings(
    userId: string,
    input: { marginThresholdPct?: number; emailNotifications?: boolean },
    ctx: AuditContext,
  ) {
    const updated = await this.db.alertSetting.upsert({
      where: { userId },
      create: {
        userId,
        marginThresholdPct: input.marginThresholdPct ?? 15,
        emailNotifications: input.emailNotifications ?? true,
      },
      update: {
        ...(input.marginThresholdPct !== undefined ? { marginThresholdPct: input.marginThresholdPct } : {}),
        ...(input.emailNotifications !== undefined ? { emailNotifications: input.emailNotifications } : {}),
      },
    });
    await recordAudit({ ...ctx, userId, action: 'alert.settings.update' }, this.db);
    return updated;
  }

  /**
   * Crea una alerta de margen bajo umbral (idempotente por 24h: no spamea la
   * misma estructura). Devuelve la alerta creada o null si fue deduplicada.
   */
  async createMarginAlert(params: {
    userId: string;
    companyId: string;
    costStructureId: string;
    marginPct: number;
    thresholdPct: number;
    message: string;
  }) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.db.alert.findFirst({
      where: {
        costStructureId: params.costStructureId,
        type: 'MARGIN_BELOW_THRESHOLD',
        createdAt: { gte: since },
      },
    });
    if (recent) return null; // deduplicación 24h

    return this.db.alert.create({
      data: {
        userId: params.userId,
        companyId: params.companyId,
        costStructureId: params.costStructureId,
        type: 'MARGIN_BELOW_THRESHOLD',
        message: params.message,
        threshold: params.thresholdPct,
        actualValue: params.marginPct,
      },
    });
  }
}
