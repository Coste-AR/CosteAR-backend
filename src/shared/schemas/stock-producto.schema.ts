import { z } from 'zod';

export const egresoProductoCreateSchema = z.object({
  cantidad: z.number().finite().positive('La cantidad debe ser mayor que cero'),
  fecha: z.string().date(),
});

export type EgresoProductoCreateInput = z.infer<typeof egresoProductoCreateSchema>;
