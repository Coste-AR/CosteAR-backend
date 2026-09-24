import { z } from 'zod';

const absoluto = z.object({ tipo: z.literal('resultado_absoluto'), importe: z.number().finite() }).strict();
const sobreCapital = z.object({
  tipo: z.literal('porcentaje_sobre_capital'),
  tasa: z.number().finite().nonnegative(),
  capitalFijo: z.number().finite().nonnegative(),
  capitalPorPesoCostoVariable: z.number().finite().nonnegative(),
}).strict();
const objetivoSobreVentas = z.object({ tipo: z.literal('porcentaje_sobre_ventas'), tasa: z.number().finite() }).strict();
const objetivoSobreCostos = z.object({ tipo: z.literal('porcentaje_sobre_costos'), tasa: z.number().finite() }).strict();
const objetivo = z.discriminatedUnion('tipo', [absoluto, sobreCapital, objetivoSobreVentas, objetivoSobreCostos]);

const comunes = { costosFijos: z.number().finite().nonnegative(), moneda: z.string().min(1).max(20), objetivo };
export const planeamientoResultadosInputSchema = z.discriminatedUnion('modalidad', [
  z.object({ modalidad: z.literal('fisica'), ...comunes, costoVariableUnitario: z.number().finite().nonnegative(), precioUnitario: z.number().finite().positive(), unidadCantidad: z.string().min(1).max(80) }).strict(),
  z.object({ modalidad: z.literal('monetaria'), ...comunes, margenMarcacion: z.number().finite() }).strict(),
]);

export const planeamientoResultadosEnvelopeSchema = z.object({ data: z.object({
  cantidadNecesaria: z.number().nullable(), ventasNecesarias: z.number().nullable(), resultadoLogrado: z.number().nullable(),
  basadoEn: z.enum(['resultado_absoluto', 'porcentaje_sobre_capital']),
  unidades: z.object({ cantidadNecesaria: z.string().nullable(), ventasNecesarias: z.string(), resultadoLogrado: z.string() }),
  motivo: z.string().optional(),
}) });

export type PlaneamientoResultadosInput = z.infer<typeof planeamientoResultadosInputSchema>;
