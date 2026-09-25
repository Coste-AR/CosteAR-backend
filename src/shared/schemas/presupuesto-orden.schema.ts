import { z } from 'zod';

export const tiposVersionPresupuesto = ['BASE', 'ADICIONAL', 'REVISION'] as const;
export const estadosVersionPresupuesto = ['BORRADOR', 'PREPARADO', 'APROBADO', 'RECHAZADO', 'VENCIDO'] as const;
export const elementosPresupuesto = ['MP', 'MOD', 'CIP', 'TERCEROS', 'ENTREGA'] as const;

export const renglonPresupuestoInputSchema = z.object({
  elemento: z.enum(elementosPresupuesto), etapaId: z.string().uuid().nullable().optional(),
  cantidad: z.number().positive(), unidadId: z.string().uuid(), precio: z.number().nonnegative(),
});
export const presupuestoCreateSchema = z.object({
  tipo: z.enum(tiposVersionPresupuesto), vigenteDesde: z.string().date().optional(),
  vigenciaDias: z.number().int().positive().optional(), costoPrevisto: z.number().nonnegative(),
  precio: z.number().nonnegative(), plazoDias: z.number().int().nonnegative(),
  causaAdicional: z.string().trim().min(1).max(500).nullable().optional(),
  renglones: z.array(renglonPresupuestoInputSchema).min(1),
});
export const presupuestoRevalidarSchema = z.object({
  vigenteDesde: z.string().date().optional(), vigenciaDias: z.number().int().positive().optional(),
});
export type PresupuestoCreateInput = z.infer<typeof presupuestoCreateSchema>;
export type PresupuestoRevalidarInput = z.infer<typeof presupuestoRevalidarSchema>;

export const presupuestoSchema = z.object({
  id: z.string().uuid(), ordenId: z.string().uuid(), tipo: z.enum(tiposVersionPresupuesto),
  numero: z.number().int(), estado: z.enum(estadosVersionPresupuesto),
}).passthrough();
export const presupuestoEnvelopeSchema = z.object({ data: presupuestoSchema });
export const presupuestosEnvelopeSchema = z.object({
  data: z.object({ presupuestos: z.array(presupuestoSchema), precioContractual: z.number().optional(), costoPrevistoTotal: z.number() }),
});
