import { z } from 'zod';

const estructuraBase = z.object({
  nombre: z.string().min(1).max(120),
  costosFijos: z.number().finite().nonnegative(),
  costoVariableUnitario: z.number().finite().nonnegative(),
}).strict();

const comunes = {
  unidadCantidad: z.string().min(1).max(80),
  moneda: z.string().min(1).max(20),
};

export const puntoIndiferenciaInputSchema = z.discriminatedUnion('tipoDecision', [
  z.object({
    tipoDecision: z.literal('comparar_estructuras'),
    estructuraA: estructuraBase,
    estructuraB: estructuraBase,
    ...comunes,
  }).strict(),
  z.object({
    tipoDecision: z.literal('dejar_de_fabricar'),
    estructuraA: estructuraBase.extend({
      costosFijosEvitables: z.number().finite().nonnegative(),
      costoVariableUnitarioLiquidacion: z.number().finite().nonnegative(),
    }),
    estructuraB: estructuraBase,
    ...comunes,
  }).strict(),
]);

const rangoSchema = z.object({ desde: z.number().nonnegative(), hasta: z.number().nonnegative().nullable() });

export const puntoIndiferenciaEnvelopeSchema = z.object({
  data: z.object({
    cantidadIndiferencia: z.number().nonnegative().nullable(),
    costoEnElPunto: z.number().nonnegative().nullable(),
    convieneA: rangoSchema.nullable(),
    convieneB: rangoSchema.nullable(),
    motivoSinPunto: z.string().nullable(),
    criterio: z.enum(['costos_totales', 'r25_fijo_evitable_y_liquidacion']),
    unidades: z.object({ cantidad: z.string(), costo: z.string() }),
  }),
});

export type PuntoIndiferenciaInput = z.infer<typeof puntoIndiferenciaInputSchema>;
