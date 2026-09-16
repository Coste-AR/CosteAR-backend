import { z } from 'zod';

/**
 * CONCEPTOS DE COSTEO — entrada de datos (M1-01, plan de análisis marginal v2).
 *
 * `clave` es libre (a diferencia de `ParametroCosteo`, que resuelve contra un
 * catálogo fijo): cada empresa desagrega sus propios conceptos. `confirmado`
 * no tiene default, mismo criterio que el resto del catálogo (REV-03): cargar
 * un valor para poder avanzar no es lo mismo que el cliente confirmándolo.
 */

const claveSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_]+$/, 'La clave va en snake_case: solo minúsculas, números y guion bajo.');

export const crearConceptoCosteoSchema = z.object({
  clave: claveSchema,
  descripcion: z.string().min(1).max(300).optional(),
  elemento: z.enum(['MP', 'MOD', 'CIP', 'VENTA']),
  comportamientoVolumen: z.enum(['VARIABLE', 'FIJO', 'SEMIFIJO']).optional(),
  causaVariabilidad: z.enum(['volumen', 'tiempo', 'intensidad_de_uso', 'precio', 'contrato', 'otra']).optional(),
  erogable: z.boolean().optional(),
  horizonteErogableMeses: z.number().int().positive().optional(),
  evitable: z.boolean().optional(),
  nivelSegmentacion: z.enum(['empresa', 'division', 'canal', 'linea']).optional(),
  segmentoId: z.string().uuid().optional(),
  rangoActividadDesde: z.number().finite().nonnegative().optional(),
  rangoActividadHasta: z.number().finite().positive().optional(),
  confirmado: z.boolean(),
  /** Nivel al que aplica. Ausentes = vale para toda la empresa. */
  structureId: z.string().uuid().nullable().optional(),
  periodId: z.string().uuid().nullable().optional(),
}).superRefine((value, ctx) => {
  if (
    value.rangoActividadDesde !== undefined &&
    value.rangoActividadHasta !== undefined &&
    value.rangoActividadDesde >= value.rangoActividadHasta
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'El rango de actividad tiene que ir de menor a mayor.',
      path: ['rangoActividadHasta'],
    });
  }
});

export type CrearConceptoCosteoInput = z.infer<typeof crearConceptoCosteoSchema>;

/** La actualización acepta los mismos campos que la creación, todos opcionales salvo `confirmado`. */
export const actualizarConceptoCosteoSchema = crearConceptoCosteoSchema
  .innerType()
  .partial()
  .extend({ confirmado: z.boolean() })
  .superRefine((value, ctx) => {
    if (
      value.rangoActividadDesde !== undefined &&
      value.rangoActividadHasta !== undefined &&
      value.rangoActividadDesde >= value.rangoActividadHasta
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El rango de actividad tiene que ir de menor a mayor.',
        path: ['rangoActividadHasta'],
      });
    }
  });

export type ActualizarConceptoCosteoInput = z.infer<typeof actualizarConceptoCosteoSchema>;
