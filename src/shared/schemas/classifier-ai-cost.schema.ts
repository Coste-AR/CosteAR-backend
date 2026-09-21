import { z } from 'zod';

export const classifierCostSummaryEnvelopeSchema = z.object({
  data: z.object({
    desde: z.string().datetime(),
    hasta: z.string().datetime(),
    proveedores: z.array(z.object({
      provider: z.string(),
      calls: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      estimatedCost: z.number().nonnegative(),
      costCurrency: z.string().nullable(),
      unmeasuredCalls: z.number().int().nonnegative(),
    })),
  }),
});
