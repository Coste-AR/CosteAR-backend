import { z } from 'zod';
const positive = z.number().finite().positive();
export const corridaCreateSchema = z.object({ referencia: z.string().trim().min(1).max(120), formula: z.string().trim().min(1).max(5000), kilosReales: positive, destino: z.enum(['propia', 'terceros']) });
export const consumoCreateSchema = z.object({ material: z.string().trim().min(1).max(200), cantidad: positive, costoUnitarioPpp: z.number().finite().nonnegative(), depositoId: z.string().uuid().nullable().optional() });
export type CorridaCreateInput = z.infer<typeof corridaCreateSchema>;
export type ConsumoCreateInput = z.infer<typeof consumoCreateSchema>;
