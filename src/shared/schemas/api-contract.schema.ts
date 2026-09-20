import { z } from 'zod';

/** Sobres compartidos por el borde HTTP. Se publican en cada operación. */
export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().optional(),
    message: z.string(),
    details: z.union([
      z.record(z.unknown()),
      z.array(z.object({ field: z.string(), message: z.string() })),
    ]).optional(),
  }),
});

export const apiErrorResponses = {
  400: apiErrorEnvelopeSchema,
  401: apiErrorEnvelopeSchema,
  403: apiErrorEnvelopeSchema,
  404: apiErrorEnvelopeSchema,
  409: apiErrorEnvelopeSchema,
  422: apiErrorEnvelopeSchema,
  429: apiErrorEnvelopeSchema,
  500: apiErrorEnvelopeSchema,
} as const;

const entitySchema = z.object({ id: z.string() }).passthrough();

export const sessionEnvelopeSchema = z.object({
  data: z.object({
    user: z.object({
      id: z.string(),
      email: z.string().email(),
      name: z.string(),
      role: z.string(),
      mustChangePassword: z.boolean(),
      needsTermsAcceptance: z.boolean(),
    }),
    accessToken: z.string(),
    refreshToken: z.string(),
  }),
});

export const tokenEnvelopeSchema = z.object({
  data: z.object({ accessToken: z.string(), refreshToken: z.string() }),
});

export const successEnvelopeSchema = z.object({ data: z.object({ success: z.literal(true) }) });

export const companySchema = entitySchema.extend({
  name: z.string(),
  industry: z.string().nullable(),
  periodicity: z.enum(['MONTHLY', 'BIWEEKLY', 'QUARTERLY', 'CUSTOM_DAYS']),
  condicionIva: z.enum(['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO']),
});

export const companiesEnvelopeSchema = z.object({ data: z.array(companySchema) });

export const costStructureSchema = entitySchema.extend({
  companyId: z.string(),
  productName: z.string(),
  period: z.string(),
  status: z.string(),
  costingSystem: z.enum(['ORDERS', 'PROCESSES']),
});

export const costStructureEnvelopeSchema = z.object({ data: costStructureSchema });
export const costStructuresEnvelopeSchema = z.object({
  data: z.array(costStructureSchema),
  nextCursor: z.string().nullable(),
});

type CalculationResultContract = {
  rawMaterialConsumed: number;
  directLaborTotal: number;
  indirectCostsApplied: number;
  productionCost: number;
  costOfGoodsSold: number;
  grossMargin: number;
  grossMarginPct: number;
};

const calculationResultSchema: z.ZodType<CalculationResultContract> = z.object({
  rawMaterialConsumed: z.number(),
  directLaborTotal: z.number(),
  indirectCostsApplied: z.number(),
  productionCost: z.number(),
  costOfGoodsSold: z.number(),
  grossMargin: z.number(),
  grossMarginPct: z.number(),
}).passthrough();

export const calculationEnvelopeSchema = z.object({
  data: z.object({ result: calculationResultSchema, calculationId: z.string() }),
});

export const simulationEnvelopeSchema = z.object({
  data: z.object({ result: calculationResultSchema, simulated: z.literal(true) }),
});

export const periodSchema = entitySchema.extend({
  structureId: z.string(),
  companyId: z.string(),
  code: z.string(),
  label: z.string(),
  status: z.enum(['OPEN', 'CLOSED']),
});

export const periodsEnvelopeSchema = z.object({ data: z.array(periodSchema) });
export const periodEnvelopeSchema = z.object({ data: periodSchema.nullable() });

type PeriodComparisonContract = {
  unidadGestion: { codigo: string; nombre: string; factor: number } | null;
  units: { from: number | null; to: number | null; comparable: boolean };
};

const periodComparisonSchema: z.ZodType<PeriodComparisonContract> = z.object({
  unidadGestion: z.object({
    codigo: z.string(),
    nombre: z.string(),
    factor: z.number(),
  }).nullable(),
  units: z.object({
    from: z.number().nullable(),
    to: z.number().nullable(),
    comparable: z.boolean(),
  }),
}).passthrough();

export const periodComparisonEnvelopeSchema = z.object({
  data: periodComparisonSchema,
});

type ClassificationContract = {
  documentType: string;
  costSection: string;
  confidence: number;
};

const classificationSchema: z.ZodType<ClassificationContract> = z.object({
  documentType: z.string(),
  costSection: z.string(),
  confidence: z.number(),
}).passthrough();

export const submitDataEnvelopeSchema = z.object({
  data: z.discriminatedUnion('isDuplicate', [
    z.object({
      id: z.string(),
      status: z.string(),
      isDuplicate: z.literal(true),
      message: z.string(),
    }),
    z.object({
      id: z.string(),
      status: z.string(),
      isDuplicate: z.literal(false),
      classification: classificationSchema,
    }),
  ]),
});

export const validationEntrySchema = entitySchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CORRECTED']),
  rawContent: z.string(),
  sourceType: z.string(),
});

export const pendingValidationsEnvelopeSchema = z.object({
  data: z.object({
    items: z.array(validationEntrySchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
  }),
});

export const validationEntryEnvelopeSchema = z.object({ data: validationEntrySchema });
