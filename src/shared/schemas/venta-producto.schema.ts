import { z } from 'zod';

export const ventaProductoCreateSchema = z.object({
  fecha: z.string().date(),
  canal: z.string().trim().min(1, 'Indicá el canal').max(120),
  variante: z.string().trim().min(1, 'Indicá la variante').max(120),
  cantidad: z.number().finite().positive('La cantidad debe ser mayor a cero'),
  precioUnitario: z.number().finite().nonnegative('El precio no puede ser negativo'),
  unidadId: z.string().uuid(),
});

export type VentaProductoCreateInput = z.infer<typeof ventaProductoCreateSchema>;
