import { z } from 'zod';

/**
 * Contrato de RESPUESTA de `GET /periods/:id/tablero-dueno` (#282, fase 1 de
 * la prueba de concepto del contrato tipado de #282).
 *
 * Espeja el shape real que arma `OwnerDashboardService.get` — no lo declara
 * antes de que exista, lo describe tal cual el servicio ya lo devuelve hoy.
 */

const numeroTableroSchema = z.object({
  valor: z.number().nullable(),
  completo: z.boolean(),
  parametrosSinConfirmar: z.boolean(),
  parametrosSinConfirmarDetalle: z.array(z.object({ id: z.string(), nombre: z.string() })),
  motivos: z.array(z.string()),
});

const periodoRefSchema = z.object({ id: z.string(), codigo: z.string() });

const pendienteCierreSchema = z.object({
  area: z.enum(['calculo', 'imputacion', 'configuracion', 'produccion', 'ventas', 'costeo']),
  dato: z.string(),
  periodo: periodoRefSchema,
});

const unidadGestionSchema = z.object({
  codigo: z.string(),
  nombre: z.string(),
  factor: z.number(),
});

export const ownerDashboardResponseSchema = z.object({
  periodo: periodoRefSchema,
  corrida: z
    .object({ id: z.string(), validada: z.boolean(), ejecutadaEn: z.string() })
    .nullable(),
  // La unidad de gestión que declaró la empresa (#274/#252). `null` explícito
  // cuando no hay una declarada — nunca un default inventado.
  unidadGestion: unidadGestionSchema.nullable(),
  pendientes: z.array(pendienteCierreSchema),
  costoPorCajon: z.object({
    variable: numeroTableroSchema,
    fijo: numeroTableroSchema,
    total: numeroTableroSchema,
  }),
  precioPromedioVenta: numeroTableroSchema,
  contribucionMarginalPorCajon: numeroTableroSchema,
  puntoEquilibrioCajones: numeroTableroSchema.extend({
    fechaUltimoRecalculo: z.string().nullable(),
  }),
  producidoCajones: numeroTableroSchema,
  resultadoPeriodo: numeroTableroSchema,
});

export const ownerDashboardEnvelopeSchema = z.object({ data: ownerDashboardResponseSchema });
