import { z } from 'zod';

const accionTecnicaSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'Usá una clave técnica, sin texto libre');

const sinDuracion = (tipo: 'ACCION_TOCADA' | 'CARGA_INICIADA') => z.object({
  tipo: z.literal(tipo),
  accion: accionTecnicaSchema,
}).strict();

const conDuracion = (tipo: 'CARGA_ABANDONADA' | 'CARGA_COMPLETADA') => z.object({
  tipo: z.literal(tipo),
  accion: accionTecnicaSchema,
  duracionMs: z.number().int().nonnegative().max(86_400_000),
}).strict();

export const telemetriaPanelCreateSchema = z.discriminatedUnion('tipo', [
  sinDuracion('ACCION_TOCADA'),
  sinDuracion('CARGA_INICIADA'),
  conDuracion('CARGA_ABANDONADA'),
  conDuracion('CARGA_COMPLETADA'),
]);

export type TelemetriaPanelCreate = z.infer<typeof telemetriaPanelCreateSchema>;

export const telemetriaPanelEventSchema = z.object({
  id: z.string(),
  tipo: z.enum(['ACCION_TOCADA', 'CARGA_INICIADA', 'CARGA_ABANDONADA', 'CARGA_COMPLETADA']),
  accion: z.string(),
  duracionMs: z.number().int().nullable(),
  rolTecnico: z.string(),
  registradoEn: z.string().datetime(),
});

export const telemetriaPanelEnvelopeSchema = z.object({ data: telemetriaPanelEventSchema });
