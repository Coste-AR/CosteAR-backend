import { z } from 'zod';

export const estadosOrdenTrabajo = [
  'BORRADOR', 'COTIZADA', 'APROBADA', 'EN_PRODUCCION', 'TERMINADA_TECNICA',
  'PENDIENTE_CIERRE', 'CERRADA', 'CANCELADA',
] as const;

export const estadoOrdenTrabajoSchema = z.enum(estadosOrdenTrabajo);

export const ordenTrabajoCreateSchema = z.object({
  codigo: z.string().trim().min(1).max(80),
  descripcion: z.string().trim().min(1).max(500),
  cliente: z.string().trim().min(1).max(200),
  plantillaId: z.string().uuid().nullable().optional(),
  fechaInicio: z.string().date().nullable().optional(),
});

export const ordenTrabajoTransitionSchema = z.object({
  estado: estadoOrdenTrabajoSchema,
  motivo: z.string().trim().min(1).max(500).optional(),
});

export type OrdenTrabajoCreateInput = z.infer<typeof ordenTrabajoCreateSchema>;
export type OrdenTrabajoTransitionInput = z.infer<typeof ordenTrabajoTransitionSchema>;

export const ordenTrabajoSchema = z.object({
  id: z.string().uuid(),
  codigo: z.string(),
  descripcion: z.string(),
  cliente: z.string(),
  estado: estadoOrdenTrabajoSchema,
  etiquetaEstado: z.string(),
}).passthrough();
export const ordenTrabajoEnvelopeSchema = z.object({ data: ordenTrabajoSchema });
export const ordenesTrabajoEnvelopeSchema = z.object({ data: z.array(ordenTrabajoSchema) });

export const etapaOrdenSchema = z.object({
  id: z.string().uuid(), clave: z.string(), nombre: z.string(), orden: z.number().int(), esEntrega: z.boolean(),
}).passthrough();
export const etapasOrdenEnvelopeSchema = z.object({ data: z.array(etapaOrdenSchema) });

export const plantillaOrdenSchema = z.object({
  id: z.string().uuid(), companyId: z.string().uuid().nullable(), nombre: z.string(),
  renglonesBase: z.array(z.unknown()), etapas: z.array(etapaOrdenSchema),
}).passthrough();
export const plantillasOrdenEnvelopeSchema = z.object({ data: z.array(plantillaOrdenSchema) });
