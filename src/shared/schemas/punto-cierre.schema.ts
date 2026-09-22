import { z } from 'zod';

export const guardarImporteConceptoSchema = z.object({
  importeFijo: z.number().finite().nonnegative().optional(),
  importeVariableUnitario: z.number().finite().nonnegative().optional(),
  moneda: z.string().trim().length(3).transform((v) => v.toUpperCase()),
  unidad: z.string().trim().min(1).max(80),
  vigenteDesde: z.string().datetime(),
});

export const puntoCierreQuerySchema = z.object({
  horizontes: z.string().regex(/^\d+(,\d+)*$/).transform((v) => [...new Set(v.split(',').map(Number))]),
  precioUnitario: z.coerce.number().finite().positive(),
  puntoEquilibrioEconomico: z.coerce.number().finite().nonnegative(),
  actividad: z.coerce.number().finite().nonnegative().optional(),
  structureId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  vigenteEn: z.string().datetime().optional(),
});

const conceptoReferenciaSchema = z.object({ clave: z.string(), etiqueta: z.string() });
const puntoSchema = z.object({
  horizonteMeses: z.number().int().positive(),
  valor: z.number().nullable(),
  motivoSinEquilibrio: z.string().optional(),
  costosFijosErogables: z.number().nullable(),
  costoVariableUnitarioErogable: z.number().nullable(),
  contribucionMarginalFinanciera: z.number().nullable(),
  situacion: z.string().nullable(),
  advertencia: z.string(),
  basadoEn: z.array(conceptoReferenciaSchema),
  conceptosIncluidos: z.array(conceptoReferenciaSchema).optional(),
  conceptosExcluidos: z.array(conceptoReferenciaSchema).optional(),
});

export const importeConceptoSchema = z.object({
  id: z.string().uuid(), conceptoId: z.string().uuid(), importeFijo: z.number().nullable(),
  importeVariableUnitario: z.number().nullable(), moneda: z.string(), unidad: z.string(),
  vigenteDesde: z.string().datetime(), createdAt: z.string().datetime(),
});
export const importeConceptoEnvelopeSchema = z.object({ data: importeConceptoSchema });
export const puntoCierreEnvelopeSchema = z.object({ data: z.object({
  moneda: z.string().nullable(), unidad: z.string().nullable(), nominal: z.literal(true),
  precioUnitario: z.number(), puntoEquilibrioEconomico: z.number(), actividad: z.number().nullable(),
  importeVersionIds: z.array(z.string().uuid()), horizontes: z.array(puntoSchema),
}) });

export type GuardarImporteConceptoInput = z.infer<typeof guardarImporteConceptoSchema>;
export type PuntoCierreQuery = z.infer<typeof puntoCierreQuerySchema>;
