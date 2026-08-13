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
const money = z.number().finite().nonnegative();

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
    // --- COSTOS DEL PERÍODO Y DE LA EI, por elemento ($) ---
    //
    // No entran al cuadro de unidades (B06 solo mueve unidades físicas): son los
    // importes con los que el motor valúa esa producción. Se cargan en el mismo
    // acto porque pertenecen al mismo (departamento, período). Un campo ausente
    // NO se pisa: los costos de la existencia inicial los escribe el arrastre
    // entre períodos (B18) y un guardado de unidades no debe borrarlos.
    /** Costo de materia prima incurrido en el período. */
    periodCostMp: money.optional(),
    /** Costo de mano de obra incurrido en el período. */
    periodCostMo: money.optional(),
    /** Carga fabril incurrida en el período. */
    periodCostCif: money.optional(),
    /** Materia prima contenida en la existencia inicial. */
    initialWipCostMp: money.optional(),
    /** Mano de obra contenida en la existencia inicial. */
    initialWipCostMo: money.optional(),
    /** Carga fabril contenida en la existencia inicial. */
    initialWipCostCif: money.optional(),
    // --- Trazabilidad del acto de carga ---
    /**
     * CUÁNDO PASÓ LO QUE SE ESTÁ CARGANDO (T-11).
     *
     * Es la fecha del HECHO —el corte de producción, el recuento de la planta—,
     * no la de la carga: esa la pone el servidor (`fecha_captación`) y no se
     * edita. Sin ella, la ficha de cada valor del cuadro mostraba "Hecho: —",
     * que es el mismo agujero que la trazabilidad viene a tapar.
     *
     * Es opcional: un cuadro cargado sin fecha se sigue guardando igual (y se
     * imputa al período del cuadro, como venía pasando). Cuando SÍ viene y cae
     * en otro mes, el dato queda pendiente de imputación y la pantalla pregunta
     * —misma regla que los movimientos de Materia Prima en Órdenes.
     */
    fechaHecho: z.string().date().optional(),
    sourceArea: sourceAreaSchema,
    method: captureMethodSchema.default('manual'),
  })
  .strict();

export type UnitMovementInputBody = z.infer<typeof unitMovementInputSchema>;
