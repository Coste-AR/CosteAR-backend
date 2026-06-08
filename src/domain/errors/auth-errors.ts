import { UnauthorizedError, ForbiddenError, ConflictError } from './domain-error.js';

/**
 * Errores de autenticación. Importante: los mensajes hacia el usuario son
 * deliberadamente genéricos ("credenciales inválidas") para no revelar si un
 * email existe o no (enumeración de usuarios).
 */

export class InvalidCredentialsError extends UnauthorizedError {
  override readonly code = 'INVALID_CREDENTIALS';
  constructor() {
    super('Email o contraseña incorrectos');
  }
}

export class AccountLockedError extends ForbiddenError {
  override readonly code = 'ACCOUNT_LOCKED';
  constructor() {
    super('La cuenta está temporalmente bloqueada por intentos fallidos');
  }
}

export class EmailAlreadyExistsError extends ConflictError {
  override readonly code = 'EMAIL_EXISTS';
  constructor() {
    // Mensaje neutro: no confirma directamente la existencia en flujos sensibles.
    super('No se pudo completar el registro con esos datos');
  }
}

export class TwoFactorRequiredError extends UnauthorizedError {
  override readonly code = 'TWO_FACTOR_REQUIRED';
  constructor() {
    super('Se requiere el código de verificación de dos factores');
  }
}

export class InvalidTwoFactorError extends UnauthorizedError {
  override readonly code = 'INVALID_TWO_FACTOR';
  constructor() {
    super('Código de verificación inválido');
  }
}

export class InvalidRefreshTokenError extends UnauthorizedError {
  override readonly code = 'INVALID_REFRESH_TOKEN';
  constructor() {
    super('Sesión inválida o expirada');
  }
}
