import { z } from 'zod';

const observacionSchema = z.object({
  volumen: z.number().finite().nonnegative(),
  importe: z.number().finite().nonnegative(),
});

/** Mismo payload para vista previa y guardado: ambos ejecutan la misma cuenta. */
export const separarTramoSemifijoSchema = z.object({
  importe: z.number().finite().nonnegative(),
  metodo: z.enum(['PUNTOS_EXTREMOS', 'CORRELACION', 'DISPERSION_GRAFICA', 'DECLARADO']),
  observacionesBase: z.array(observacionSchema).max(120).optional(),
  porcionFija: z.number().finite().nonnegative().optional(),
  porcionVariable: z.number().finite().nonnegative().optional(),
});

export type SepararTramoSemifijoInput = z.infer<typeof separarTramoSemifijoSchema>;
