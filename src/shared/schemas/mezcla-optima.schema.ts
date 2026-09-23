import { z } from 'zod';

const recursoSchema = z.object({
  id: z.string().uuid(),
  clave: z.string(),
  disponibleEnPeriodo: z.number().nonnegative(),
  unidad: z.string(),
  nombreUnidad: z.string(),
});

const rankingSchema = z.object({
  productoId: z.string().uuid(), producto: z.string(), cme: z.number(), cm: z.number(),
  consumoPorUnidad: z.number().positive(), demandaMaxima: z.number().nonnegative(),
  cantidadAsignada: z.number().nonnegative(), recursoAsignado: z.number().nonnegative(),
  unidades: z.object({
    cme: z.string(), cm: z.string(), consumoPorUnidad: z.string(), demandaMaxima: z.string(),
    cantidadAsignada: z.string(), recursoAsignado: z.string(),
  }),
});

export const mezclaOptimaEnvelopeSchema = z.object({
  data: z.object({
    recurso: recursoSchema.nullable(),
    ranking: z.array(rankingSchema),
    contribucionMarginalTotal: z.number().nullable(),
    recursoRestante: z.number().nullable(),
    motivoSinRanking: z.string().nullable(),
  }),
});
