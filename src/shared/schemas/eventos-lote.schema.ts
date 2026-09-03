import { z } from 'zod';

const cantidad = z.number().finite().positive('La cantidad debe ser mayor que cero');
const fecha = z.string().date();
export const motivoBajaLoteSchema = z.enum(['mortalidad', 'descarte', 'canibalismo', 'faena']);

/** La carga manual exige motivo en una baja; no hay un campo de saldo vivo. */
export const eventoLoteCreateSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('alta'), cantidad, fecha }),
  z.object({ tipo: z.literal('baja'), cantidad, fecha, motivo: motivoBajaLoteSchema }),
]);

export type EventoLoteCreateInput = z.infer<typeof eventoLoteCreateSchema>;
