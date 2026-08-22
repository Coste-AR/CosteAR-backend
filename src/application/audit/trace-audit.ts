import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';

/**
 * Bitácora append-only dedicada a las acciones de Trazabilidad Total v1
 * (tabla `trace_audit_log`, distinta del `AuditLog` legado — ver
 * DECISIONES.md). Nunca se llama sola: siempre dentro de la misma
 * transacción que la mutación de negocio que audita (R2).
 */

export interface TraceActor {
  id: string;
  role: string;
  /**
   * EL PUESTO DECLARADO de la persona en la empresa (I5b): "Jefe de Depósito",
   * "Contador". Distinto de `role`, que es el permiso de login y solo tiene tres
   * valores, dos de los cuales son en la práctica la misma persona.
   *
   * Lo resuelve el pre-handler de autenticación, una vez por request, y viaja
   * hasta `DataPointVersion.actorJobTitle`, que lo ESTAMPA. `null`/ausente
   * cuando la persona no tiene puesto declarado o no es operario de empresa.
   */
  jobTitle?: string | null;
  area: string; // SourceArea
  method?: string; // CaptureMethod
  device?: string;
}

export interface TraceAuditEntry {
  entityType: string;
  entityId: string;
  action: string;
  actor: TraceActor;
  before?: unknown;
  after?: unknown;
  comment?: string;
}

export async function recordTraceAudit(
  entry: TraceAuditEntry,
  client: Pick<PrismaClient, 'traceAuditLog'> | Prisma.TransactionClient = prisma,
): Promise<void> {
  await client.traceAuditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      actorId: entry.actor.id,
      actorRole: entry.actor.role,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      actorArea: entry.actor.area as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      method: entry.actor.method as any,
      deviceInfo: entry.actor.device,
      before: entry.before === undefined ? undefined : (entry.before as object),
      after: entry.after === undefined ? undefined : (entry.after as object),
      comment: entry.comment,
    },
  });
}
