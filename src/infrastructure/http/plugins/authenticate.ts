import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../../crypto/tokens.js';
import { UnauthorizedError, ForbiddenError } from '../../../domain/errors/domain-error.js';
import { prisma } from '../../database/prisma.js';
import { enterTenantScope, enterSystemScope } from '../../database/tenant-context.js';

/**
 * Contexto de autenticación adjuntado a cada request autenticada.
 */
export interface AuthUser {
  id: string;
  tenantId: string;
  role: string;
  /**
   * EL PUESTO DECLARADO en la empresa ("Jefe de Depósito"), no el rol de login
   * (I5b). Se resuelve acá, una vez por request, y viaja en el `TraceActor`
   * hasta la versión del dato, que lo estampa.
   *
   * No sale del JWT a propósito: el costista puede corregir el puesto de un
   * operario y el cambio tiene que valer desde el dato siguiente, no cuando a
   * esa persona se le venza el token.
   */
  jobTitle?: string | null;
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

  // A partir de acá, TODA consulta de esta request viaja con el inquilino
  // seteado, así las políticas RLS también se aplican a las lecturas. Antes eso
  // solo pasaba dentro de `withTenant`, o sea únicamente en las escrituras.
  //
  // El ADMIN es la excepción y va sin acotar: es personal interno, no tiene
  // datos propios, y el panel mira todas las empresas a propósito. Acotarlo a su
  // propio id le devolvería cero filas en todas las pantallas. Lo que lo protege
  // es `requireRole('ADMIN')`, no el inquilino.
  if (request.authUser.role === 'ADMIN') {
    enterSystemScope('panel de administración: mira todas las empresas');
  } else {
    enterTenantScope(request.authUser.id);
  }

  // Solo los operarios de empresa tienen membresía y, por lo tanto, puesto: el
  // costista es el dueño de la estructura y el admin es personal interno. Con
  // la guarda, el 95% de las requests no paga ninguna consulta extra.
  //
  // Si la consulta falla no se cae la request: quedarse sin puesto degrada la
  // trazabilidad de ese dato, tumbar el login la rompe entera.
  if (request.authUser.role === 'EMPRESA_OPERATOR') {
    try {
      const membership = await prisma.operatorMembership.findFirst({
        where: { operatorId: request.authUser.id, isActive: true, jobTitle: { not: null } },
        select: { jobTitle: true },
      });
      request.authUser.jobTitle = membership?.jobTitle ?? null;
    } catch {
      request.authUser.jobTitle = null;
    }
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
