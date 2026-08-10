import { z } from 'zod';

/**
 * Schemas de los endpoints de Trazabilidad Total v1. `sourceArea` viaja en el
 * body de cada mutación porque el JWT actual no lleva "área" (solo rol) — ver
 * DECISIONES.md.
 */

export const sourceAreaSchema = z.enum([
  'deposito',
  'contaduria',
  'planta',
  'comercial',
  'costista',
  'sistema',
]);

export const captureMethodSchema = z.enum([
  'manual',
  'portal_operador',
  'ia_sugerido',
  'excel_import',
  'calculado',
]);

export const costElementSchema = z.enum(['MP', 'MOD', 'CIP', 'VENTA']);

/**
 * Tipos de los tres enums de trazabilidad. Se exportan para que los servicios
 * que arman DataPoints "a mano" (el reconciliador de Órdenes) usen exactamente
 * el mismo vocabulario que la API, sin redeclararlo.
 */
export type SourceArea = z.infer<typeof sourceAreaSchema>;
export type CaptureMethod = z.infer<typeof captureMethodSchema>;
export type CostElement = z.infer<typeof costElementSchema>;

export const createDataPointSchema = z.object({
  element: costElementSchema,
  fieldKey: z.string().min(1).max(200),
  label: z.string().min(1).max(300),
  unit: z.string().max(20).optional(),
  sourceArea: sourceAreaSchema,
  method: captureMethodSchema.default('manual'),
  valueNum: z.number().finite().optional(),
  valueJson: z.unknown().optional(),
  reason: z.string().min(1).max(500).optional(),
  evidenceId: z.string().uuid().optional(),
  fechaHecho: z.string().date().optional(),
  deviceInfo: z.string().max(300).optional(),
});
export type CreateDataPointInput = z.infer<typeof createDataPointSchema>;

export const addVersionSchema = z.object({
  sourceArea: sourceAreaSchema,
  method: captureMethodSchema.default('manual'),
  valueNum: z.number().finite().optional(),
  valueJson: z.unknown().optional(),
  reason: z.string().min(1).max(500), // obligatorio: toda corrección declara el porqué
  evidenceId: z.string().uuid().optional(),
  fechaHecho: z.string().date().optional(),
  deviceInfo: z.string().max(300).optional(),
});
export type AddVersionInput = z.infer<typeof addVersionSchema>;

export const validateDataPointSchema = z.object({
  sourceArea: sourceAreaSchema,
});

export const requestRevisionSchema = z.object({
  sourceArea: sourceAreaSchema,
  comment: z.string().min(1).max(1000),
});

export const imputacionSchema = z.object({
  sourceArea: sourceAreaSchema,
  periodo: z.string().regex(/^\d{4}-\d{2}$/, 'Formato de período: YYYY-MM'),
});

export const evidenceSchema = z.object({
  kind: z.string().min(1).max(80),
  reference: z.string().min(1).max(200),
  counterparty: z.string().max(200).optional(),
  fileUrl: z.string().url().optional(),
});
export type EvidenceInput = z.infer<typeof evidenceSchema>;
