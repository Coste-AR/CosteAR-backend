import { z } from 'zod';
import { sourceAreaSchema, captureMethodSchema } from './trazabilidad.schema.js';

/**
 * Schemas del reparto de costos conjuntos (Costeo por Procesos, B16).
 *
 * El cuerpo del PUT lleva la configuración del reparto de UN departamento que es
 * punto de separación, para UN período: el método elegido, el costo conjunto
 * total y las líneas de producto que salen del punto de separación. La matemática
 * de los cuatro métodos vive en el dominio (`allocateJointCosts`, B11); acá solo
 * se validan la FORMA y los rangos de los insumos que el usuario carga a mano.
 *
 * `method` es el MÉTODO DE REPARTO (no confundir con el método de captura de
 * trazabilidad, que viaja como `captureMethod`). `sourceArea`/`captureMethod`
 * acompañan cada insumo manual porque se persiste como un DataPoint trazable,
 * igual que en el resto de Trazabilidad (el JWT no lleva "área").
 */

/** Método de reparto elegido. Replica el enum `JointAllocationMethod` (B05/B11). */
export const jointAllocationMethodSchema = z.enum([
  'PHYSICAL_UNITS',
  'TECHNICAL_YIELD',
  'MARKET_VALUE',
  'NET_REALIZABLE_VALUE',
]);

/** Tipo de línea que sale del punto de separación. */
export const byProductKindSchema = z.enum(['coproduct', 'byproduct', 'waste']);

const amount = z.number().finite().nonnegative();
/** Fracción del precio (0,03 = 3 %), coherente con el resto del dominio. */
const fraction = z.number().finite().min(0).max(1);

/** Una línea de producto del punto de separación con sus insumos manuales. */
export const jointProductInputSchema = z
  .object({
    productName: z.string().min(1).max(120),
    kind: byProductKindSchema.default('coproduct'),
    /** Unidades buenas obtenidas: denominador del costo unitario, siempre > 0. */
    unitsObtained: z.number().finite().positive(),
    /** Rendimiento técnico (base proporcional) — método TECHNICAL_YIELD. */
    yieldPct: z.number().finite().nonnegative().optional(),
    /** Precio de mercado en el punto de separación — MARKET_VALUE y NET_REALIZABLE_VALUE. */
    marketPrice: amount.optional(),
    /** Gasto de comercialización variable, como fracción del precio — solo VNR. */
    sellingCostVarPct: fraction.optional(),
    /** Gasto de comercialización fijo por unidad ($/u) — solo VNR. */
    sellingCostFixedPerUnit: amount.optional(),
    /** Reconocimiento del subproducto ('at_sale' | 'at_production') — solo kind='byproduct'. */
    byproductRecognition: z.enum(['at_sale', 'at_production']).optional(),
  })
  .strict();
export type JointProductInput = z.infer<typeof jointProductInputSchema>;

export const jointCostInputSchema = z
  .object({
    /**
     * Departamento (punto de separación) donde ocurre el reparto. Viaja en el
     * body porque el path del endpoint se scopea por estructura+período (ver
     * DECISIONES.md B16); un reparto pertenece a UN departamento y UN período.
     */
    deptId: z.string().uuid(),
    /** Método de REPARTO del costo conjunto (no el método de captura). */
    method: jointAllocationMethodSchema,
    /** Costo conjunto total (MP + conversión) acumulado hasta el punto de separación. */
    jointCostTotal: amount,
    products: z.array(jointProductInputSchema).min(1),
    // --- Trazabilidad del acto de carga ---
    sourceArea: sourceAreaSchema,
    /** Método de CAPTURA del dato (trazabilidad), separado del método de reparto. */
    captureMethod: captureMethodSchema.default('manual'),
  })
  .strict();
export type JointCostInputBody = z.infer<typeof jointCostInputSchema>;
