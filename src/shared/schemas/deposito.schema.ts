import { z } from 'zod';

const cantidad = z.number().finite().nonnegative();
export const depositoCreateSchema = z.object({
  referencia: z.string().trim().min(1).max(120),
  capacidad: z.number().finite().positive(),
  unidadId: z.string().uuid(),
  umbralBajo: cantidad,
}).refine((v) => v.umbralBajo <= v.capacidad, { path: ['umbralBajo'], message: 'El umbral no puede superar la capacidad' });
export const movimientoDepositoCreateSchema = z.object({
  tipo: z.enum(['ingreso', 'egreso']),
  cantidad: z.number().finite().positive(),
  fecha: z.string().date(),
});
export type DepositoCreateInput = z.infer<typeof depositoCreateSchema>;
export type MovimientoDepositoCreateInput = z.infer<typeof movimientoDepositoCreateSchema>;
