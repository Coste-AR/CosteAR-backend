import { z } from 'zod';

export const precioTransferenciaQuerySchema = z.object({
  criterioDecision: z.enum(['COSTO_VARIABLE', 'MERCADO']).optional(),
});

export const precioTransferenciaEnvelopeSchema = z.object({ data: z.object({
  equilibrioACostoVariable: z.number(), equilibrioAMercado: z.number(), diferencia: z.number(),
  criterioDecisionMarginal: z.literal('COSTO_VARIABLE'), avisoDecisionMarginal: z.string(),
  usoDeCadaCriterio: z.object({ COSTO_VARIABLE: z.string(), MERCADO: z.string() }),
  unidades: z.object({ equilibrioACostoVariable: z.string(), equilibrioAMercado: z.string(), diferencia: z.string() }),
}) });

export type PrecioTransferenciaQuery = z.infer<typeof precioTransferenciaQuerySchema>;
