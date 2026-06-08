import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { DomainError } from '../../domain/errors/domain-error.js';

/**
 * Handler de errores central. Traduce errores de dominio y de validación a
 * respuestas seguras y consistentes. NUNCA filtra stack traces ni detalles
 * internos al cliente en producción.
 *
 * Forma de respuesta: { error: { code, message, details? } }
 */
export function errorHandler(
  error: FastifyError | DomainError | ZodError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Errores de validación de Zod → 400 con detalle de campos.
  if (error instanceof ZodError) {
    reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Datos de entrada inválidos',
        details: error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
    });
    return;
  }

  // Errores de dominio tipados → su statusCode y code.
  if (error instanceof DomainError) {
    reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  // Rate limit de @fastify/rate-limit.
  if ((error as FastifyError).statusCode === 429) {
    reply.status(429).send({
      error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiadas solicitudes, intentá más tarde' },
    });
    return;
  }

  // Validación de schema de Fastify (Ajv).
  if ((error as FastifyError).validation) {
    reply.status(400).send({
      error: { code: 'VALIDATION_ERROR', message: error.message },
    });
    return;
  }

  // Error no controlado: log completo del lado servidor, respuesta genérica.
  request.log.error({ err: error }, 'Error no controlado');
  reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
  });
}
