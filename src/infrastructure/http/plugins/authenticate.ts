import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../../crypto/tokens.js';
import { UnauthorizedError, ForbiddenError } from '../../../domain/errors/domain-error.js';

/**
 * Contexto de autenticación adjuntado a cada request autenticada.
 */
export interface AuthUser {
  id: string;
  tenantId: string;
  role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

/**
 * Pre-handler que exige un access token válido en el header Authorization.
 * Adjunta `request.authUser` para los handlers downstream.
 */
export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new UnauthorizedError('Token de acceso requerido');
  }

  const token = header.slice('Bearer '.length);
  try {
    const payload = verifyAccessToken(token);
    request.authUser = {
      id: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
    };
  } catch {
    throw new UnauthorizedError('Token de acceso inválido o expirado');
  }
}

/** Exige que el usuario autenticado tenga uno de los roles dados. */
export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.authUser) {
      throw new UnauthorizedError('No autenticado');
    }
    if (!roles.includes(request.authUser.role)) {
      throw new ForbiddenError('No tenés permisos para esta acción');
    }
  };
}

/** Extrae IP y User-Agent para auditoría. */
export function auditContext(request: FastifyRequest): {
  ipAddress: string;
  userAgent: string;
} {
  return {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'] ?? 'unknown',
  };
}
