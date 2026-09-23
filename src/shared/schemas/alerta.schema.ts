import { z } from 'zod';

export const alertaPublicaSchema = z.object({
  id: z.string(),
  type: z.enum(['MARGIN_BELOW_THRESHOLD', 'MACRO_CHANGE', 'COST_SPIKE', 'INDICADOR_FISICO']),
  message: z.string(),
  severidad: z.enum(['INFO', 'ADVERTENCIA', 'CRITICA']).nullable(),
  indicador: z.string().nullable(),
  indicadorEtiqueta: z.string().nullable(),
  unidadValor: z.string().nullable(),
  unidadUmbral: z.string().nullable(),
  motivoNoEvaluada: z.string().nullable(),
}).passthrough();

export const alertasEnvelopeSchema = z.object({ data: z.array(alertaPublicaSchema) });

export const indicadorAlertaCatalogoSchema = z.object({
  clave: z.string(),
  etiqueta: z.string(),
  unidad: z.string(),
});

export const indicadoresAlertaCatalogoEnvelopeSchema = z.object({
  data: z.array(indicadorAlertaCatalogoSchema),
});

const evaluacionSinAlertaSchema = z.union([
  z.object({ estado: z.literal('INACTIVA'), alerta: z.null() }).passthrough(),
  z.object({ estado: z.literal('NORMAL'), alerta: z.null() }).passthrough(),
]);

const evaluacionNoEvaluableSchema = z.object({
  estado: z.literal('NO_EVALUABLE'),
  motivo: z.string(),
  alerta: alertaPublicaSchema,
}).passthrough();

const evaluacionConAlertaSchema = z.object({
  estado: z.literal('ALERTA'),
  hallazgo: z.object({
    reglaId: z.string(),
    indicador: z.string(),
    severidad: z.enum(['INFO', 'ADVERTENCIA', 'CRITICA']),
    valor: z.number(),
    umbral: z.number(),
    lecturasEnCondicion: z.number().int().positive(),
    mensaje: z.string(),
    explicacion: z.array(z.string()),
  }).passthrough(),
  alerta: alertaPublicaSchema,
  entrega: z.object({ canal: z.enum(['IN_APP', 'EMAIL']) }).passthrough().optional(),
}).passthrough();

export const evaluacionReglaAlertaEnvelopeSchema = z.object({
  data: z.union([
    evaluacionSinAlertaSchema,
    evaluacionNoEvaluableSchema,
    evaluacionConAlertaSchema,
  ]),
});
