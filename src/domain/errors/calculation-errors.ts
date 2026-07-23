import { UnprocessableEntityError } from './domain-error.js';

/**
 * Falta un insumo para poder calcular (presupuesto sin cerrar, horas en 0,
 * dato sin imputar, etc.). 422 con mensaje accionable en español — nunca un
 * 500 crudo (R4).
 */
export class MissingInputError extends UnprocessableEntityError {
  override readonly code = 'MISSING_INPUT';

  /**
   * `datosPendientes` (opcional) viaja en `details` para que el front resuelva
   * los datos sin imputar EN EL LUGAR del bloqueo (F05), sin caer a una lista
   * vieja del último cálculo. Formato { id, nombre } — el `id` solo abre la
   * ficha; lo que se muestra al costista es el nombre (regla #6).
   */
  constructor(field: string, message: string, datosPendientes?: { id: string; nombre: string }[]) {
    super(message, datosPendientes ? { field, datosPendientes } : { field });
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
