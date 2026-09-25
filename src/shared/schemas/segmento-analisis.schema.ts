import { z } from 'zod';

const coproductoSchema = z.object({
  nombre: z.string().min(1).max(120),
  precio: z.number().finite(),
  rendimiento: z.number().finite().positive(),
});

const camposSchema = z.object({
  nombre: z.string().min(1).max(120),
  nivel: z.enum(['empresa', 'division', 'canal', 'linea']),
  parentId: z.string().uuid().nullable().optional(),
  produccionConjunta: z.boolean().default(false),
  precioUnitario: z.number().finite().nonnegative().nullable().optional(),
  costoVariableUnitario: z.number().finite().nonnegative().nullable().optional(),
  participacion: z.number().finite().min(0).max(1),
  costoFijoDirecto: z.number().finite().nonnegative(),
  prorrateoIndirectos: z.number().finite().nonnegative(),
  coproductos: z.array(coproductoSchema).default([]),
});

export const crearSegmentoAnalisisSchema = camposSchema;
export const actualizarSegmentoAnalisisSchema = camposSchema.partial();
export type CrearSegmentoAnalisisInput = z.infer<typeof crearSegmentoAnalisisSchema>;
export type ActualizarSegmentoAnalisisInput = z.infer<typeof actualizarSegmentoAnalisisSchema>;

export const segmentoAnalisisSchema = camposSchema.extend({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  precioUnitario: z.number().nullable(),
  costoVariableUnitario: z.number().nullable(),
});
export const segmentoEnvelopeSchema = z.object({ data: segmentoAnalisisSchema });
export const segmentosEnvelopeSchema = z.object({ data: z.array(segmentoAnalisisSchema) });
export const segmentoEliminadoEnvelopeSchema = z.object({ data: z.object({ eliminado: z.literal(true) }) });

export const crearRotacionSegmentoSchema = z.object({ periodoId: z.string().uuid(), rotacion: z.number().finite().positive() });
export type CrearRotacionSegmentoInput = z.infer<typeof crearRotacionSegmentoSchema>;
export const rotacionSegmentoEnvelopeSchema = z.object({ data: z.object({
  id: z.string().uuid(), segmentoId: z.string().uuid(), periodoId: z.string().uuid(),
  rotacion: z.number().positive(), origen: z.literal('DECLARADA'), fecha: z.string().datetime(),
}) });
export const rankingRotacionEnvelopeSchema = z.object({ data: z.object({
  ranking: z.array(z.object({ producto: z.string(), margen: z.number(), rotacion: z.number().positive(), rendimiento: z.number(), rotacionOrigen: z.enum(['DECLARADA', 'DEFAULT']) })),
  criterio: z.enum(['rendimiento', 'margen']), advertencia: z.string().nullable(),
  excluidos: z.array(z.object({ producto: z.string(), motivo: z.literal('ROTACION_SIN_DECLARAR') })),
}) });

const vistaSchema = z.object({ resultado: z.number().nullable() });
export const equilibrioSectorialEnvelopeSchema = z.object({ data: z.object({
  equilibrioGeneral: z.number().nullable(),
  segmentos: z.array(z.object({
    id: z.string().uuid(), nombre: z.string(), contribucionMarginalUnitaria: z.number(),
    contribucionNeta: z.number().nullable(), equilibrioEspecifico: z.number().nullable(),
    equilibrioSectorial: z.number().nullable(), excedente: z.number().nullable(),
    vistaSinProrrateo: vistaSchema,
    vistaConProrrateo: vistaSchema.extend({ doctrinaria: z.literal(false), motivo: z.string() }),
    basadoEn: z.object({ participacion: z.number(), costoFijoDirecto: z.number(), prorrateoIndirectos: z.number(), produccionConjunta: z.boolean() }),
  })),
  controlIndirectos: z.object({ indirectos: z.number(), contribucionesNetas: z.number(), diferencia: z.number() }),
}) });
