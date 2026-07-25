import { z } from 'zod';
import { sourceAreaSchema, captureMethodSchema } from './trazabilidad.schema.js';

/**
 * Schemas del cuadro de movimiento de unidades (Costeo por Procesos, B15).
 *
 * El cuerpo del PUT lleva los insumos que el usuario carga a mano del cuadro
 * de UN departamento para UN período. Todas las cantidades van en unidades;
 * los grados de avance como FRACCIÓN (0,80 = 80 %), coherente con `normalLossPct`.
 *
 * `sourceArea`/`method` viajan en el body igual que en el resto de Trazabilidad
 * (el JWT no lleva "área"), porque cada valor ingresado se persiste como un
 * DataPoint trazable.
 */

const units = z.number().finite().nonnegative();
const fraction = z.number().finite().min(0).max(1);

export const unitMovementInputSchema = z
  .object({
    // --- ENTRADAS (unidades) ---
    initialWip: units.optional(),
    startedInProduction: units.optional(),
    receivedFromPrevious: units.optional(),
    unitIncrease: units.optional(),
    // --- SALIDAS (unidades) ---
    transferredOut: units.optional(),
    finishedInStock: units.optional(),
    /** % de pérdida normal admitido, como fracción (0,02 = 2 %). */
    normalLossPct: fraction.optional(),
    /** Pérdida real total del período (unidades). La extraordinaria se deriva. */
    totalLossReported: units.optional(),
    finalWip: units.optional(),
    // --- GRADOS DE AVANCE (para la producción equivalente, B07) ---
    /** Avance de la EF en Materia Prima (fracción). Default 1 (MP al inicio). */
    finalWipMpAvance: fraction.optional(),
    /** Avance de la EF en Conversión (fracción). */
    finalWipConvAvance: fraction.optional(),
    /** Avance de la EI en Materia Prima (fracción), arrastrado del período anterior. */
    initialWipMpAvance: fraction.optional(),
    /** Avance de la EI en Conversión (fracción), arrastrado del período anterior. */
    initialWipConvAvance: fraction.optional(),
    // --- Trazabilidad del acto de carga ---
    sourceArea: sourceAreaSchema,
    method: captureMethodSchema.default('manual'),
  })
  .strict();

export type UnitMovementInputBody = z.infer<typeof unitMovementInputSchema>;
