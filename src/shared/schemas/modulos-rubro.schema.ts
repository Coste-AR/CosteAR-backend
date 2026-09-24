import { z } from 'zod';

const opcionParametroSchema = z.object({
  valor: z.string(),
  etiqueta: z.string(),
});

const parametroModuloSchema = z.object({
  clave: z.string(),
  descripcion: z.string(),
  opciones: z.array(opcionParametroSchema).optional(),
});

export const moduloRubroListadoSchema = z.object({
  clave: z.string(),
  nombre: z.string(),
  descripcion: z.string(),
  estado: z.enum(['prendido', 'apagado']),
  porDefecto: z.boolean(),
  dependeDe: z.array(z.string()),
  superficies: z.array(z.string()),
  parametros: z.array(parametroModuloSchema),
  alertas: z.array(z.string()),
});

export const modulosRubroEnvelopeSchema = z.object({
  data: z.array(moduloRubroListadoSchema),
});
