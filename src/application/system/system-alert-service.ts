import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { NotFoundError } from '../../domain/errors/domain-error.js';

export class SystemAlertService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async create(data: {
    source: string;
    level: string;
    message: string;
    sentryIssueId?: string;
    sentryUrl?: string;
  }) {
    return this.db.systemAlert.create({
      data,
    });
  }

  async list(onlyUnresolved = false) {
    return this.db.systemAlert.findMany({
      where: onlyUnresolved ? { resolvedAt: null } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async resolve(id: string) {
    const alert = await this.db.systemAlert.findUnique({ where: { id } });
    if (!alert) {
      throw new NotFoundError('System alert not found');
    }
    return this.db.systemAlert.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });
  }
}
