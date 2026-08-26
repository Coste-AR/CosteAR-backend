import { z } from 'zod';

/**
 * PARÁMETROS DE COSTEO — entrada de datos (issue #115).
 *
 * `confirmado` no tiene default a propósito: quien llama tiene que decidirlo.
 * Cargar un valor para poder avanzar no es lo mismo que el cliente
 * confirmándolo (REV-03), y esconder la diferencia detrás de un default sería
 * volver a la misma ambigüedad que el catálogo vino a sacar.
 */
export const setParametroCosteoSchema = z.object({
  valor: z.number().finite(),
  confirmado: z.boolean(),
  /** Nivel al que aplica. Ausentes = vale para toda la empresa. */
  structureId: z.string().uuid().nullable().optional(),
  periodId: z.string().uuid().nullable().optional(),
});

export type SetParametroCosteoInput = z.infer<typeof setParametroCosteoSchema>;
