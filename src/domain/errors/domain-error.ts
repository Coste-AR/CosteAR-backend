/**
 * Errores de dominio tipados. Cada uno mapea a un código HTTP y a un `code`
 * estable que el frontend puede interpretar sin parsear mensajes.
 *
 * Nunca se filtran stack traces ni detalles internos al cliente: el handler
 * HTTP central traduce estos errores a respuestas seguras.
 */
export abstract class DomainError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
  }
}

// `code` se tipa como `string` (no literal) para que las subclases de auth
// puedan especializarlo (ej. INVALID_CREDENTIALS sobre UNAUTHORIZED).
export class ValidationError extends DomainError {
  readonly statusCode: number = 400;
  readonly code: string = 'VALIDATION_ERROR';
}

export class UnauthorizedError extends DomainError {
  readonly statusCode: number = 401;
  readonly code: string = 'UNAUTHORIZED';
}

export class ForbiddenError extends DomainError {
  readonly statusCode: number = 403;
  readonly code: string = 'FORBIDDEN';
}

export class NotFoundError extends DomainError {
  readonly statusCode: number = 404;
  readonly code: string = 'NOT_FOUND';
}

export class ConflictError extends DomainError {
  readonly statusCode: number = 409;
  readonly code: string = 'CONFLICT';
}

export class TooManyRequestsError extends DomainError {
  readonly statusCode: number = 429;
  readonly code: string = 'TOO_MANY_REQUESTS';
}

/**
 * Error de negocio no destructivo pero que impide procesar la solicitud tal
 * como llegó (falta un insumo, un cálculo no puede correr todavía, etc.).
 * Nunca es un 500: es información accionable para que el usuario sepa qué
 * cargar. `details` puede incluir `{ field }` para apuntar al campo puntual.
 */
export class UnprocessableEntityError extends DomainError {
  readonly statusCode: number = 422;
  readonly code: string = 'UNPROCESSABLE_ENTITY';
}

export class CalcError extends DomainError {
  readonly statusCode: number = 422;
  readonly code: string = 'CALC_ERROR';
}
