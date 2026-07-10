import { UnprocessableEntityError } from './domain-error.js';

/**
 * Falta un insumo para poder calcular (presupuesto sin cerrar, horas en 0,
 * dato sin imputar, etc.). 422 con mensaje accionable en español — nunca un
 * 500 crudo (R4).
 */
export class MissingInputError extends UnprocessableEntityError {
  override readonly code = 'MISSING_INPUT';

  constructor(field: string, message: string) {
    super(message, { field });
  }
}
