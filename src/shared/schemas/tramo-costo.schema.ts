import { z } from 'zod';

export const guardarTramoCostoSchema = z.object({
  reemplazaId: z.string().uuid().optional(),
  conceptoId: z.string().uuid().optional(),
  segmentoId: z.string().uuid().optional(),
  desde: z.number().finite().nonnegative(),
  hasta: z.number().finite().positive().nullable().optional(),
  tipo: z.enum(['REEMPLAZA', 'ACUMULA']),
  importeFijo: z.number().finite().nonnegative(),
  cmUnitaria: z.number().finite().positive(),
  techoFisico: z.number().finite().positive().nullable().optional(),
  techoFuente: z.string().trim().min(1, 'techoFuente es obligatoria cuando se declara techoFisico.').max(500).nullable().optional(),
}).superRefine((value, ctx) => {
  if ((value.conceptoId ? 1 : 0) + (value.segmentoId ? 1 : 0) !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['conceptoId'], message: 'Declare exactamente conceptoId o segmentoId.' });
  }
  if (value.hasta !== undefined && value.hasta !== null && value.hasta <= value.desde) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hasta'], message: 'hasta tiene que ser mayor que desde.' });
  }
  if (value.techoFisico !== undefined && value.techoFisico !== null && !value.techoFuente) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['techoFuente'], message: 'techoFuente es obligatoria cuando se declara techoFisico.' });
  }
  if ((value.techoFisico === undefined || value.techoFisico === null) && value.techoFuente) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['techoFisico'], message: 'techoFisico es obligatorio cuando se declara techoFuente.' });
  }
});

export type GuardarTramoCostoInput = z.infer<typeof guardarTramoCostoSchema>;

export const tramoCostoSchema = z.object({
  id: z.string().uuid(),
  conceptoId: z.string().uuid().nullable(),
  segmentoId: z.string().uuid().nullable(),
  desde: z.number(),
  hasta: z.number().nullable(),
  tipo: z.enum(['REEMPLAZA', 'ACUMULA']),
  importeFijo: z.number(),
  cmUnitaria: z.number(),
  techoFisico: z.number().nullable(),
  techoFuente: z.string().nullable(),
  techoDeclaradoEn: z.string().datetime().nullable(),
  techoDeclaradoPorId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});

export const tramosCostoEnvelopeSchema = z.object({ data: z.array(tramoCostoSchema) });
export const tramoCostoEnvelopeSchema = z.object({ data: tramoCostoSchema });
export const equilibrioTramosEnvelopeSchema = z.object({
  data: z.object({
    calculoId: z.string().uuid().optional(),
    tramos: z.array(z.object({
      tramoId: z.string(), tipo: z.enum(['REEMPLAZA', 'ACUMULA']), desde: z.number(), hasta: z.number().nullable(),
      techo: z.number().nullable(), qAritmetico: z.number().nullable(), q: z.number().nullable(),
      resultadoMaximo: z.number().nullable(), motivoFueraDeTramo: z.string().optional(),
    })),
    transiciones: z.array(z.object({
      desdeTramoId: z.string(), haciaTramoId: z.string(), qIndiferencia: z.number().nullable(),
      binding: z.number().nullable(), margenHastaTecho: z.number().nullable(), porcentajeMargen: z.number().nullable(),
      alertaPegadoAlTecho: z.boolean(),
    })),
  }),
});
