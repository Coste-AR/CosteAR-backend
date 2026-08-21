import { z } from 'zod';

/**
 * DESPERDICIO DEL PERÍODO — entrada de datos (issue #92, regla R5 de la clase 4).
 *
 * El motor ya sabe imputar el desperdicio: `desperdicio.ts` implementa R5 y
 * `runCalculation` lo aplica. Lo que faltaba era **por dónde entra el dato**: la
 * tabla `desperdicio_registros` existía y no se leía ni se escribía desde
 * ningún lado.
 *
 * LA REGLA QUE MANDA ESTE SCHEMA: `naturaleza` es OPCIONAL, y su ausencia
 * significa «nadie la declaró todavía», no «normal». Un registro sin naturaleza
 * no entra al cálculo y aparece como pendiente. El umbral que separa la merma
 * normal de la extraordinaria **no surge del comprobante**, así que el sistema
 * no puede elegirlo sin preguntar: mandar una merma extraordinaria al costo
 * infla el costo unitario de todo el mes y no se ve.
 */

export const naturalezaDesperdicioSchema = z.enum(['normal', 'extraordinaria']);

/** Importe de dinero: no negativo y con la precisión de la columna (18,4). */
const money = z
  .number()
  .finite()
  .nonnegative()
  .max(9_999_999_999_999, 'El importe es demasiado grande');

export const desperdicioCreateSchema = z
  .object({
    /** Qué se perdió, en las palabras del productor: "mortandad", "huevo roto". */
    concepto: z.string().trim().min(1, 'Escribí qué se perdió').max(200),
    /** Valor de lo perdido, en pesos. */
    valor: money,
    /** Cantidad física, si se conoce. Es opcional: no siempre se cuenta. */
    cantidad: z.number().finite().nonnegative().nullable().optional(),
    unidadId: z.string().uuid().nullable().optional(),
    /**
     * Naturaleza DECLARADA. Ausente o `null` = sin declarar: queda pendiente y
     * NO entra al cálculo. No es lo mismo no saber que suponer.
     */
    naturaleza: naturalezaDesperdicioSchema.nullable().optional(),
    /** Lo que se recupera vendiéndolo. Se resta de la merma normal (R5). */
    valorRecupero: money.default(0),
    /** Por qué se declaró así. Es lo que hace auditable la decisión. */
    motivo: z.string().trim().max(1000).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    // Un recupero mayor que lo perdido significa que uno de los dos está mal
    // cargado. Dejarlo pasar produce una merma normal NEGATIVA, que abarataría
    // el costo del producto por un error de tipeo.
    if (v.valorRecupero > v.valor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valorRecupero'],
        message:
          'El recupero no puede ser mayor que el valor de lo perdido. ' +
          'Revisá los dos importes: no se puede recuperar más de lo que se perdió.',
      });
    }
  });

/** Actualización: todos los campos opcionales, mismas reglas. */
export const desperdicioUpdateSchema = z
  .object({
    concepto: z.string().trim().min(1, 'Escribí qué se perdió').max(200).optional(),
    valor: money.optional(),
    cantidad: z.number().finite().nonnegative().nullable().optional(),
    unidadId: z.string().uuid().nullable().optional(),
    naturaleza: naturalezaDesperdicioSchema.nullable().optional(),
    valorRecupero: money.optional(),
    motivo: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'No hay nada para actualizar',
  });

export type DesperdicioCreateInput = z.infer<typeof desperdicioCreateSchema>;
export type DesperdicioUpdateInput = z.infer<typeof desperdicioUpdateSchema>;
