import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';

/**
 * Registro de auditoría (append-only). Toda acción sensible — login,
 * cambios de datos financieros, cambios de cuenta — deja una huella inmutable
 * con quién, qué, cuándo y desde dónde.
 */

export interface AuditContext {
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry extends AuditContext {
  action: string;
  entityType?: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export async function recordAudit(
  entry: AuditEntry,
  client: Pick<PrismaClient, 'auditLog'> = prisma,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: entry.userId ?? null,
      action: entry.action,
      entityType: entry.entityType ?? '',
      entityId: entry.entityId ?? '',
      before: entry.oldValue === undefined ? undefined : (entry.oldValue as object),
      after: entry.newValue === undefined ? undefined : (entry.newValue as object),
      deviceInfo: `IP: ${entry.ipAddress ?? 'unknown'} | UA: ${entry.userAgent ?? 'unknown'}`,
      actorRole: 'SYSTEM',
      actorArea: 'contaduria'
    },
  });
}
