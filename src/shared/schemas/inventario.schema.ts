import { z } from 'zod';

export const articuloCreateSchema = z.object({
  codigo: z.string().trim().min(1).max(80),
  descripcion: z.string().trim().min(1).max(300),
  unidadId: z.string().uuid(),
  almacenable: z.boolean().default(true),
});

export const movimientoInventarioCreateSchema = z.object({
  articuloId: z.string().uuid(), depositoId: z.string().uuid().nullable().optional(),
  tipo: z.enum(['INGRESO', 'SALIDA', 'AJUSTE']), cantidad: z.number().finite().positive(),
  costoUnitario: z.number().finite().nonnegative().optional(),
  gastosCompra: z.number().finite().nonnegative().default(0),
  fecha: z.string().date(), ordenId: z.string().uuid().nullable().optional(),
  documento: z.string().trim().max(300).nullable().optional(), periodoImputado: z.string().date(),
});

export type ArticuloCreateInput = z.infer<typeof articuloCreateSchema>;
export type MovimientoInventarioCreateInput = z.infer<typeof movimientoInventarioCreateSchema>;

export const articuloSchema = z.object({
  id: z.string().uuid(), codigo: z.string(), descripcion: z.string(), unidadId: z.string().uuid(),
  almacenable: z.boolean(), saldoCantidad: z.number(), saldoValor: z.number(), ppp: z.number(),
}).passthrough();
export const articuloCreadoSchema = z.object({
  id: z.string().uuid(), codigo: z.string(), descripcion: z.string(), unidadId: z.string().uuid(), almacenable: z.boolean(),
}).passthrough();
export const articuloEnvelopeSchema = z.object({ data: articuloCreadoSchema });
export const articulosEnvelopeSchema = z.object({ data: z.array(articuloSchema) });
export const movimientoInventarioEnvelopeSchema = z.object({ data: z.object({ id: z.string().uuid() }).passthrough() });
