import { z } from 'zod';
import { sourceAreaSchema } from './trazabilidad.schema.js';

/**
 * Schemas de los departamentos de proceso (Costeo por Procesos, B14).
 *
 * Un departamento es una etapa del proceso productivo. `sourceArea` viaja en el
 * body igual que en el resto de Trazabilidad (el JWT no lleva "área"), porque
 * toda mutación queda auditada con quién, desde dónde y con qué dispositivo.
 */

export const processDepartmentCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'El departamento necesita un nombre.').max(120),
    /**
     * true = mano de obra y carga fabril comparten grado de avance, y el cuadro
     * lleva una sola columna "Conversión". false = se siguen por separado.
     */
    conversionUnified: z.boolean().optional(),
    sourceArea: sourceAreaSchema,
  })
  .strict();

export const processDepartmentUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    conversionUnified: z.boolean().optional(),
    sourceArea: sourceAreaSchema,
  })
  .strict();

/** El reorden manda la cadena COMPLETA: un orden parcial la dejaría ambigua. */
export const processDepartmentReorderSchema = z
  .object({
    orderedIds: z.array(z.string().uuid()).min(1),
    sourceArea: sourceAreaSchema,
  })
  .strict();

export const processDepartmentDeleteSchema = z
  .object({ sourceArea: sourceAreaSchema })
  .strict();

export type ProcessDepartmentCreateBody = z.infer<typeof processDepartmentCreateSchema>;
export type ProcessDepartmentUpdateBody = z.infer<typeof processDepartmentUpdateSchema>;
