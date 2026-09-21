import { z } from 'zod';

export const indicadorMacroSchema = z.object({
  clave: z.string(),
  etiqueta: z.string(),
  valor: z.number().nullable(),
  unidad: z.string().nullable(),
  fecha: z.string().datetime().nullable(),
  fuenteNombre: z.string(),
  fuenteUrl: z.string().url(),
  error: z.literal('fuente no disponible').optional(),
});

export const indicadoresMacroEnvelopeSchema = z.object({
  data: z.array(indicadorMacroSchema),
});
