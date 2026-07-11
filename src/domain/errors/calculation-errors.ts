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

/**
 * Falta la base de asignación (o su orden de cierre) de un centro de servicio,
 * así que el prorrateo secundario no puede correr (Parte 4.5). 422 con link
 * accionable al formulario de bases — nunca un 500.
 */
export class MissingAllocationBaseError extends UnprocessableEntityError {
  override readonly code = 'MISSING_ALLOCATION_BASE';

  constructor(field: string, message: string) {
    super(message, { field });
  }
}
