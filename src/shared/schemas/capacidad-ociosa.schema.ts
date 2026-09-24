import { z } from 'zod';

const numeroNullable = z.number().nullable();
const controlSchema = z.object({
  sobreSubaplicacion: z.number(), diferencia: z.number(), cierra: z.boolean(), formula: z.string(),
});
const desgloseModSchema = z.object({
  tipo: z.enum(['tiempos-perdidos-informados', 'improductividad-oculta']),
  label: z.string(), hours: z.number(), cost: z.number(),
  reasons: z.array(z.object({ reason: z.string(), hours: z.number(), cost: z.number() })),
});
const manoDeObraSchema = z.object({
  paidHours: z.number().optional(), productiveHours: z.number().optional(), chargeableHours: z.number().optional(),
  idleHours: z.number(), fullMod: z.number().optional(), idleCost: z.number(), applicableMod: z.number(),
  hasIdleCapacity: z.boolean().optional(),
  destination: z.enum(['absorbido-en-el-producto', 'perdida-del-periodo']),
  breakdown: z.array(desgloseModSchema),
  alert: z.object({
    level: z.enum(['advertencia', 'critico']), title: z.string(), message: z.string(),
    cost: z.number(), sharePercent: z.number(),
  }).nullable(),
});
export const capacidadOciosaEnvelopeSchema = z.object({ data: z.object({
  corrida: z.object({ id: z.string().uuid(), validada: z.boolean(), ejecutadaEn: z.string().datetime() }).nullable(),
  ociosidadR22: z.object({
    valor: numeroNullable, motivo: z.string().nullable(), capacidadNormal: numeroNullable.optional(),
    actividadReal: numeroNullable.optional(), unidad: z.string().nullable().optional(),
  }),
  manoDeObra: manoDeObraSchema.nullable(),
  cip: z.object({ variacionPresupuesto: z.number(), variacionVolumen: z.number(), controlDosVias: controlSchema }),
  tresVias: z.object({ bloqueada: z.literal(true), motivo: z.string() }),
}) });
