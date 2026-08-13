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

/**
 * Los seis tipos de comprobante del manual. Enum cerrado a propósito: el tipo
 * es lo primero que mira quien audita ("¿esto es una factura o un acta?"), y
 * un texto libre termina con 'Factura', 'factura ', 'FC' y 'fac' siendo la
 * misma cosa escrita de cuatro maneras.
 *
 * NO hay CHECK en la base: el vocabulario lo fija la API, para que el día que
 * la ingesta de documentos necesite un tipo más (una nota de crédito, por
 * ejemplo) alcance con tocar esta línea y no una migración.
 */
export const evidenceKindSchema = z.enum([
  'factura',
  'contrato',
  'remito',
  'acta',
  'lista_precios',
  'asiento',
]);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

/**
 * Alta de un comprobante.
 *
 * `file` es OPCIONAL y lo es de verdad: el manual admite explícitamente un
 * comprobante "NULL si es referencia sin archivo". Un comprobante que existe
 * en el mundo (factura A 0001-00012345 de Proveedor SA) y del que no tenemos
 * el PDF sigue siendo infinitamente más auditable que no tener nada — así que
 * el alta no depende de que haya almacenamiento configurado.
 */
export const evidenceSchema = z.object({
  kind: evidenceKindSchema,
  reference: z.string().trim().min(1).max(200),
  counterparty: z.string().trim().max(200).optional(),
  /** URL ya resuelta por quien llama (p. ej. la ingesta, que sube por su cuenta). */
  fileUrl: z.string().url().max(2000).optional(),
  /**
   * Archivo crudo en base64. El tope NO es arbitrario: el `bodyLimit` global
   * de la app es 1 MiB, así que un base64 más grande que esto lo corta Fastify
   * con un 413 crudo antes de llegar acá. Cortarlo nosotros primero deja un
   * mensaje en castellano en vez de un error de infraestructura.
   * 700.000 caracteres de base64 ≈ 512 KB de archivo.
   */
  file: z
    .object({
      data: z
        .string()
        .min(1)
        .max(700_000, 'El archivo es muy grande (máximo 500 KB). Subí una versión más liviana.'),
      mimeType: z.string().min(1).max(120),
      fileName: z.string().trim().min(1).max(200),
    })
    .optional(),
});
export type EvidenceInput = z.infer<typeof evidenceSchema>;

/**
 * Adjuntar un comprobante YA creado a un dato existente. Nunca pisa la versión
 * vigente: crea una versión nueva que la lleva (R1). Por eso `reason` es
 * obligatorio, igual que en cualquier otra corrección.
 */
export const attachEvidenceSchema = z.object({
  evidenceId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
  sourceArea: sourceAreaSchema.default('costista'),
});
export type AttachEvidenceInput = z.infer<typeof attachEvidenceSchema>;
