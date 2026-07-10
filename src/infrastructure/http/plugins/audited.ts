import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../database/prisma.js';
import { Prisma, SourceArea, CaptureMethod } from '@prisma/client';

export type AuditedHandler = (
  req: FastifyRequest,
  res: FastifyReply,
  tx: Prisma.TransactionClient
) => Promise<any>;

export function fingerprint(req: FastifyRequest): string {
  const ip = req.ip || 'unknown';
  const ua = req.headers['user-agent'] || 'unknown';
  return `${ip} - ${ua}`.substring(0, 255);
}

export function audited(action: string, entityType: string) {
  return (handler: AuditedHandler) => async (req: FastifyRequest, res: FastifyReply) => {
    return await prisma.$transaction(async (tx) => {
      const result = await handler(req, res, tx);
      
      const user = (req as any).authUser || (req as any).user;
      
      // Default to SISTEMA if no user (e.g., background jobs or public endpoints)
      const actorId = user?.id;
      const actorRole = user?.role || 'SISTEMA';
      
      // Map user role or other logic to SourceArea. 
      // This is a simple default mapping, can be refined based on business logic.
      let actorArea: SourceArea = 'sistema';
      if (actorRole === 'COSTISTA') actorArea = 'costista';
      if (actorRole === 'EMPRESA_OPERATOR') actorArea = 'planta'; // Or depending on user definition
      if (actorRole === 'ADMIN') actorArea = 'sistema';

      await tx.auditLog.create({
        data: {
          action,
          entityType,
          entityId: result?.id || 'UNKNOWN',
          actorId,
          actorRole,
          actorArea,
          deviceInfo: fingerprint(req),
          before: result?.before || null,
          after: result?.after || result || null,
          method: 'manual', // Default method, could be extracted from req headers or body
        }
      });
      
      return result;
    });
  };
}
