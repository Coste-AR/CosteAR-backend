import { z } from 'zod';

export const parteHorasCreateSchema = z.object({
  personaId: z.string().uuid(),
  etapaId: z.string().uuid(),
  fecha: z.string().date(),
  horasNormales: z.number().nonnegative(),
  horasExtra: z.number().nonnegative(),
  tarifaId: z.string().uuid(),
  causaExtra: z.object({
    texto: z.string().trim().min(1).max(500),
    versionPresupuestoId: z.string().uuid().optional(),
  }).nullable().optional(),
}).refine((value) => value.horasNormales + value.horasExtra > 0, {
  message: 'El parte debe informar al menos una hora', path: ['horasNormales'],
});

export type ParteHorasCreateInput = z.infer<typeof parteHorasCreateSchema>;

export const parteHorasSchema = z.object({
  id: z.string().uuid(), ordenId: z.string().uuid(), personaId: z.string().uuid(), etapaId: z.string().uuid(),
  fecha: z.coerce.date(), horasNormales: z.coerce.number(), horasExtra: z.coerce.number(),
  tarifaId: z.string().uuid(), estado: z.enum(['CARGADO', 'APROBADO']),
}).passthrough();
export const parteHorasEnvelopeSchema = z.object({ data: parteHorasSchema });
export const partesHorasEnvelopeSchema = z.object({ data: z.array(parteHorasSchema) });
