import { z } from 'zod';

/**
 * ACTIVOS AMORTIZABLES — entrada de datos (issue #116).
 *
 * `vidaUtilMeses` es OPCIONAL a propósito: si no se manda, la cuota se deriva
 * del catálogo de parámetros de costeo (`vida_util_lote_meses`, #115) en vez de
 * quedar tipeada. Cargarla acá es la excepción para un activo puntual que
 * necesita otra vida útil, no la regla.
 */
const money = z
  .number()
  .finite()
  .nonnegative()
  .max(9_999_999_999_999, 'El importe es demasiado grande');

export const activoAmortizableCreateSchema = z
  .object({
    nombre: z.string().trim().min(1, 'Ponele un nombre al activo').max(200),
    costoAdquisicion: money,
    valorResidual: money.default(0),
    /** NULL/ausente = usar el parámetro de costeo del rubro. */
    vidaUtilMeses: z.number().int().positive().nullable().optional(),
    fechaAlta: z.string().date(),
    cantidad: z.number().finite().positive().nullable().optional(),
    unidadId: z.string().uuid().nullable().optional(),
    structureId: z.string().uuid().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.valorResidual > v.costoAdquisicion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valorResidual'],
        message:
          'El valor residual no puede superar al costo de adquisición: ' +
          'daría una amortización negativa.',
      });
    }
  });

export const activoAmortizableUpdateSchema = z
  .object({
    nombre: z.string().trim().min(1).max(200).optional(),
    costoAdquisicion: money.optional(),
    valorResidual: money.optional(),
    vidaUtilMeses: z.number().int().positive().nullable().optional(),
    fechaAlta: z.string().date().optional(),
    cantidad: z.number().finite().positive().nullable().optional(),
    unidadId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay nada para actualizar' });

export type ActivoAmortizableCreateInput = z.infer<typeof activoAmortizableCreateSchema>;
export type ActivoAmortizableUpdateInput = z.infer<typeof activoAmortizableUpdateSchema>;
