import { z } from 'zod';

export const costoDirectoCreateSchema = z.object({
  etapaId: z.string().uuid(),
  categoria: z.enum(['TERCEROS', 'TRANSPORTE', 'GRUA', 'VIATICOS', 'COMPRA_EXCLUSIVA', 'OTRO']),
  importe: z.number().positive(), documento: z.string().trim().min(1).max(500).nullable().optional(),
  periodoImputado: z.string().date(),
});

export const contingenciaCreateSchema = z.object({
  etapaId: z.string().uuid(), tipo: z.enum(['DESPERDICIO', 'SOBRANTE', 'ROTURA', 'FALLA', 'RETRABAJO']),
  cantidad: z.number().positive(), valor: z.number().nonnegative(), recupero: z.number().nonnegative().nullable().optional(),
  causa: z.string().trim().min(1).max(500), tratamiento: z.string().trim().min(1).max(500),
  versionPresupuestoId: z.string().uuid().nullable().optional(),
}).superRefine((value, context) => {
  if (value.tipo === 'FALLA' && value.recupero == null && !/reclamo/i.test(value.tratamiento)) {
    context.addIssue({ code: 'custom', path: ['tratamiento'], message: 'Una falla de proveedor exige recupero o reclamo' });
  }
});

const costoDirectoSchema = z.object({ id: z.string().uuid(), ordenId: z.string().uuid(), etapaId: z.string().uuid(), importe: z.coerce.number(), estadoValidacion: z.enum(['PENDIENTE', 'VALIDADO', 'MARCADO']), impactaCosto: z.boolean() }).passthrough();
const contingenciaSchema = z.object({ id: z.string().uuid(), ordenId: z.string().uuid(), etapaId: z.string().uuid(), cantidad: z.coerce.number(), valor: z.coerce.number(), recupero: z.coerce.number().nullable(), estadoValidacion: z.enum(['PENDIENTE', 'VALIDADO', 'MARCADO']) }).passthrough();
export const costoDirectoEnvelopeSchema = z.object({ data: costoDirectoSchema });
export const costosDirectosEnvelopeSchema = z.object({ data: z.array(costoDirectoSchema), resumen: z.object({ totalValidado: z.number(), entregaInstalacionValidada: z.number() }) });
export const contingenciaEnvelopeSchema = z.object({ data: contingenciaSchema });
export const contingenciasEnvelopeSchema = z.object({ data: z.array(contingenciaSchema), resumen: z.object({ perdidaPeriodoValidada: z.number(), cifPoolValidado: z.number(), adicionalValidado: z.number() }) });
export type CostoDirectoCreateInput = z.infer<typeof costoDirectoCreateSchema>;
export type ContingenciaCreateInput = z.infer<typeof contingenciaCreateSchema>;
