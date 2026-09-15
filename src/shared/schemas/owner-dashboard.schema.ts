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

// `costoPorCajon.fijo` (MX-02): un costo fijo unitario no es una magnitud
// económica válida (R10, `AM4`) — se conserva por compatibilidad pero marcado.
const numeroTableroFijoSchema = numeroTableroSchema.extend({
  esUnitarioDeFijo: z.literal(true),
});

// `diferenciaPorVariacionDeInventarios` (M0-03): además del importe, la
// explicación en castellano de por qué absorción y costeo variable difieren.
const numeroTableroConExplicacionSchema = numeroTableroSchema.extend({
  explicacion: z.string().nullable(),
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

const rubroSchema = z.object({
  clave: z.string(),
  icons: z.record(z.string()),
});

export const ownerDashboardResponseSchema = z.object({
  periodo: periodoRefSchema,
  corrida: z
    .object({ id: z.string(), validada: z.boolean(), ejecutadaEn: z.string() })
    .nullable(),
  // La unidad de gestión que declaró la empresa (#274/#252). `null` explícito
  // cuando no hay una declarada — nunca un default inventado.
  unidadGestion: unidadGestionSchema.nullable(),
  // El paquete asociado a la empresa declara tanto la clave estable como sus
  // íconos. `null` evita inferir el rubro desde `Company.industry`.
  rubro: rubroSchema.nullable(),
  pendientes: z.array(pendienteCierreSchema),
  costoPorCajon: z.object({
    variable: numeroTableroSchema,
    fijo: numeroTableroFijoSchema,
    total: numeroTableroSchema,
  }),
  // Total de costos fijos del período, SIN dividir por unidades (R10, MX-02).
  costosFijosDelPeriodo: numeroTableroSchema,
  // Cuántas unidades de gestión cubren el fijo total = CF / contribución
  // marginal unitaria. La pregunta real detrás de "costo fijo por cajón".
  cajonesQueTapanLosFijos: numeroTableroSchema,
  precioPromedioVenta: numeroTableroSchema,
  contribucionMarginalPorCajon: numeroTableroSchema,
  puntoEquilibrioCajones: numeroTableroSchema.extend({
    fechaUltimoRecalculo: z.string().nullable(),
  }),
  producidoCajones: numeroTableroSchema,
  // Resultado por costeo COMPLETO (absorción) — se conserva íntegro, RT 17.
  resultadoPeriodo: numeroTableroSchema,
  // Resultado por costeo VARIABLE (M0-03) — la cifra destacada del tablero.
  resultadoPeriodoCosteoVariable: numeroTableroSchema,
  diferenciaPorVariacionDeInventarios: numeroTableroConExplicacionSchema,
});

export const ownerDashboardEnvelopeSchema = z.object({ data: ownerDashboardResponseSchema });
