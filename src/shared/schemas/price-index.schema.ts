import { z } from 'zod';

const periodCode = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Usá un período mensual YYYY-MM.');

export const savePriceIndexSeriesSchema = z.object({
  source: z.string().trim().min(2).max(120),
  basePeriodCode: periodCode,
  values: z.array(z.object({
    periodCode,
    indexValue: z.number().finite().positive(),
  })).min(1).max(600),
}).superRefine(({ values }, ctx) => {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.periodCode)) {
      ctx.addIssue({ code: 'custom', path: ['values', index, 'periodCode'], message: 'El período está repetido.' });
    }
    seen.add(value.periodCode);
  });
});

export type SavePriceIndexSeriesInput = z.infer<typeof savePriceIndexSeriesSchema>;

export const priceIndexSeriesViewSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  source: z.string(),
  basePeriodCode: periodCode,
  version: z.object({ id: z.string().uuid(), number: z.number().int().positive(), createdAt: z.string().datetime() }),
  values: z.array(z.object({ periodCode, indexValue: z.number().positive() })),
});

export const priceIndexSeriesEnvelopeSchema = z.object({ data: priceIndexSeriesViewSchema.nullable() });
