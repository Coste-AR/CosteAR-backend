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
  valor: z.number().finite().optional(),
  comportamientoVolumen: z.enum(['VARIABLE', 'FIJO', 'SEMIFIJO']).optional(),
  confirmado: z.boolean(),
  /** Nivel al que aplica. Ausentes = vale para toda la empresa. */
  structureId: z.string().uuid().nullable().optional(),
  periodId: z.string().uuid().nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.valor === undefined && value.comportamientoVolumen === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Indicá un valor o un comportamiento frente al volumen.' });
  }
  if (value.valor !== undefined && value.comportamientoVolumen !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Un parámetro numérico y una clasificación se guardan por separado.' });
  }
});

export type SetParametroCosteoInput = z.infer<typeof setParametroCosteoSchema>;
