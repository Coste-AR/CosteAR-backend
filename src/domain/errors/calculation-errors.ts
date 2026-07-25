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
 * La estructura está configurada con un sistema de costeo que el motor todavía
 * no sabe calcular (hoy: Procesos — llega con B17). 422 con mensaje accionable en
 * español, NUNCA un 500 ni un crash: la estructura se pudo crear como Procesos
 * (B01), pero calcularla no está disponible aún. Placeholder temporal que el
 * motor de Procesos reemplazará. Ver DECISIONES.md (B02).
 */
export class CostingSystemNotAvailableError extends UnprocessableEntityError {
  override readonly code = 'COSTING_SYSTEM_NOT_AVAILABLE';

  constructor(
    message = 'El costeo por procesos todavía no está disponible. Por ahora podés calcular estructuras de costeo por órdenes.',
  ) {
    super(message);
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

/**
 * El cuadro de movimiento de unidades de Costeo por Procesos no se puede
 * resolver o no cuadra: dos incógnitas a la vez, un departamento inicial con
 * datos que no le corresponden (recibidas/aumento), pérdida real menor a la
 * normal, o Σ unidades a justificar ≠ Σ unidades justificadas (B06, reglas
 * R1-R5). 422 con mensaje accionable en español — nunca un 500.
 *
 * `details` lleva la diferencia numérica (`difference`) y/o el campo en falta
 * (`field`) para que el front pinte el indicador "cuadra / no cuadra" y ubique
 * el dato exacto. El motor de Procesos (B17) lo consumirá tal cual.
 */
export class ProcessValidationError extends UnprocessableEntityError {
  override readonly code = 'PROCESS_VALIDATION';

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}
