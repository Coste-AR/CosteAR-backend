import { z } from 'zod';

export const relacionReemplazoInputSchema = z.object({
  segmentoOrigenId: z.string().uuid(),
  segmentoDestinoId: z.string().uuid(),
  cantidadOrigen: z.number().finite().positive(),
  resultadoObjetivo: z.number().finite().default(0),
  unidadCantidad: z.string().min(1).max(80),
}).strict().refine((input) => input.segmentoOrigenId !== input.segmentoDestinoId, {
  message: 'Los segmentos de origen y destino deben ser distintos.',
  path: ['segmentoDestinoId'],
});

const unidadesSchema = z.object({
  cantidadOrigen: z.string(),
  cantidadDestino: z.string(),
  resultadoCortoPlazo: z.string(),
  resultadoLargoPlazo: z.string(),
});

export const relacionReemplazoEnvelopeSchema = z.object({
  data: z.object({
    relacionReemplazo: z.number().nullable(),
    cantidadOrigen: z.number().positive(),
    cantidadDestino: z.number().nullable(),
    resultadoCortoPlazo: z.number().nullable(),
    resultadoLargoPlazo: z.number().nullable(),
    unidades: unidadesSchema,
    motivo: z.string().optional(),
  }),
});

export type RelacionReemplazoInput = z.infer<typeof relacionReemplazoInputSchema>;
