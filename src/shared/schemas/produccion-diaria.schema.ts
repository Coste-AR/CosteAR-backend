import { z } from 'zod';

const cantidad = z.number().finite().nonnegative('La cantidad no puede ser negativa');

/** Hechos diarios; la postura se calcula después y no es parte de este input. */
export const produccionDiariaCreateSchema = z
  .object({
    fecha: z.string().date(),
    variante: z.string().trim().min(1, 'Indicá la variante').max(120),
    unidadesProducidas: cantidad,
    roturas: cantidad.default(0),
    descartes: cantidad.default(0),
  })
  .superRefine((valor, ctx) => {
    if (valor.roturas + valor.descartes > valor.unidadesProducidas) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['roturas'],
        message: 'Roturas y descartes no pueden superar las unidades producidas',
      });
    }
  });

export type ProduccionDiariaCreateInput = z.infer<typeof produccionDiariaCreateSchema>;
