import { z } from 'zod';

const indicador = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9_]+$/, 'El indicador debe estar en snake_case');

const camposRegla = {
  indicador,
  descripcion: z.string().trim().min(5).max(240),
  condicion: z.enum(['MAYOR', 'MENOR', 'FUERA_DE_RANGO_PCT']),
  umbral: z.number().finite().nonnegative(),
  unidadId: z.string().uuid().nullable().optional(),
  lecturasSostenidas: z.number().int().min(1).max(365).default(1),
  severidad: z.enum(['INFO', 'ADVERTENCIA', 'CRITICA']).default('ADVERTENCIA'),
  destinatarios: z.array(z.string().email()).max(20).default([]),
  canal: z.enum(['IN_APP', 'EMAIL']).default('IN_APP'),
  activa: z.boolean().default(true),
};

export const reglaAlertaCreateSchema = z.object({
  ...camposRegla,
  structureId: z.string().uuid().nullable().optional(),
});

export const reglaAlertaUpdateSchema = z
  .object(camposRegla)
  .partial()
  .refine((input) => Object.keys(input).length > 0, 'Indicá al menos un campo para actualizar');

export const lecturaAlertaSchema = z.object({
  fecha: z.string().datetime({ offset: true }),
  valor: z.number().finite(),
  referencia: z.number().finite().nullable().optional(),
});

export const evaluarReglaAlertaSchema = z.object({
  lecturas: z.array(lecturaAlertaSchema).max(366),
});

export type ReglaAlertaCreateInput = z.infer<typeof reglaAlertaCreateSchema>;
export type ReglaAlertaUpdateInput = z.infer<typeof reglaAlertaUpdateSchema>;
export type EvaluarReglaAlertaInput = z.infer<typeof evaluarReglaAlertaSchema>;
