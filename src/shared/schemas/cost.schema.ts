import { z } from 'zod';

/**
 * Schemas de la configuración de una estructura de costos. Definen la forma de
 * los campos JSONB persistidos y son la fuente de verdad para el motor de
 * cálculo. Todos los números se validan finitos y no-negativos donde aplica.
 */

const nonNeg = z.number().finite().nonnegative();
const positive = z.number().finite().positive();

// --- Materia Prima (Hoja 1) ---

export const stockMovementSchema = z.object({
  date: z.string().min(1),
  type: z.enum(['purchase', 'consumption']),
  detail: z.string().min(1).max(200),
  quantity: positive,
  unitCost: nonNeg.optional(),
});

export const rawMaterialConfigSchema = z.object({
  // Identidad de mercado (criterio C: "nunca una sola MP genérica"). Opcionales
  // para no romper la MP única legada, que no las tenía.
  id: z.string().max(60).optional(),
  code: z.string().max(60).optional(), // codificación real de mercado
  name: z.string().max(120).optional(),
  unit: z.string().max(20).optional(),
  supplier: z.string().max(160).optional(), // proveedor habitual
  wilson: z.object({
    annualDemand: nonNeg,
    orderCost: nonNeg,
    holdingRate: z.number().finite().min(0).max(10), // fracción (0.30 = 30%)
    unitCost: nonNeg,
  }),
  stockPolicy: z.object({
    minConsumption: nonNeg,
    maxConsumption: nonNeg,
    minLeadTime: nonNeg,
    maxLeadTime: nonNeg,
    safetyStock: nonNeg,
  }),
  initialStock: z.object({ quantity: nonNeg, unitCost: nonNeg }),
  movements: z.array(stockMovementSchema).max(500),
});
export type RawMaterialConfig = z.infer<typeof rawMaterialConfigSchema>;

/**
 * Sección de Materia Prima con N materias primas por estructura (Parte 3.1).
 * Acepta y normaliza la forma LEGADA (una sola MP como objeto plano con
 * `wilson`) envolviéndola en `{ materials: [ ... ] }`. Así las estructuras ya
 * cargadas siguen funcionando sin migración destructiva: se normalizan al leer
 * y quedan en la forma nueva al volver a guardar.
 */
export const rawMaterialSectionSchema = z.preprocess(
  (val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const o = val as Record<string, unknown>;
      if ('materials' in o) return o;
      if ('wilson' in o) return { materials: [o] }; // MP única legada
    }
    return val;
  },
  z.object({ materials: z.array(rawMaterialConfigSchema).min(1).max(50) }),
);
export type RawMaterialSection = z.infer<typeof rawMaterialSectionSchema>;

// --- Mano de Obra Directa (Hoja 2) ---

const namedCoefficient = z.object({
  name: z.string().min(1).max(120),
  coefficient: z.number().finite().min(0).max(10),
});

export const directLaborConfigSchema = z.object({
  workingDays: z.object({
    totalDaysPerYear: positive,
    unpaidAbsence: z.object({
      sundays: nonNeg,
      saturdays: nonNeg,
      unjustifiedAbsences: nonNeg,
      holidaysOnWeekend: nonNeg,
    }),
    paidAbsence: z.object({
      holidays: nonNeg,
      vacations: nonNeg,
      sickness: nonNeg,
      specialLeaves: nonNeg,
      workAccidents: nonNeg,
    }),
  }),
  itcs: z.object({
    derivationBase: z.number().finite().min(0).max(10),
    fixedArt: z.number().finite().min(0).max(10),
    sacFraction: z.number().finite().min(0).max(1).optional(),
    uncertainRemunerative: z.array(namedCoefficient).max(50),
    uncertainNonRemunerative: z.array(namedCoefficient).max(50),
  }),
  departments: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        basicRemuneration: nonNeg,
        // OJO: `hoursWorked` es histórico; conceptualmente son HORAS
        // PRESUPUESTADAS (capacidad normal) con las que se calcula la tarifa.
        hoursWorked: nonNeg,
        // Dato REAL de fin de mes (horas efectivamente trabajadas). Opcional y
        // NO usado por el motor: es solo para comparar real vs presupuestado
        // (Parte 3.2, criterio C). No afecta la tarifa ni el costo.
        realHours: nonNeg.optional(),
        // Modelo preparado para operarios individuales (extensión, ver
        // DECISIONES.md). Opcional; el motor no lo usa todavía.
        operators: z
          .array(
            z.object({
              name: z.string().max(120),
              category: z.string().max(80).optional(),
              bankedHours: nonNeg.optional(),
              individualAbsenceDays: nonNeg.optional(),
            }),
          )
          .max(500)
          .optional(),
      }),
    )
    .max(100),
});
export type DirectLaborConfig = z.infer<typeof directLaborConfigSchema>;

// --- Costos Indirectos (Hoja 3) ---

const fixedVariableSchema = z.object({ fixed: nonNeg, variable: nonNeg });

export const indirectCostConfigSchema = z.object({
  centers: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        name: z.string().min(1).max(120),
        type: z.enum(['productive', 'service']),
      }),
    )
    .min(1)
    .max(100),
  concepts: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        amount: fixedVariableSchema,
        distribution: z.record(z.string(), nonNeg),
        // Prorrateo PRIMARIO por concepto (Parte 4.3). Tres modos que conviven:
        //  - 'direct'  : importe ya asignado por centro (distribution = importes).
        //  - 'percent' : % manual por centro (lo de hoy; distribution = pesos).
        //  - 'base'    : base física del catálogo; los valores por centro se
        //                resuelven desde allocation_base_values y se vuelcan a
        //                `distribution` en la capa de servicio antes de calcular.
        allocationMode: z.enum(['direct', 'percent', 'base']).optional().default('percent'),
        baseCode: z.string().max(60).optional(),
      }),
    )
    .max(200),
  serviceDistributions: z
    .array(
      z.object({
        serviceCenterId: z.string().min(1),
        toProductive: z.record(z.string(), nonNeg).optional().default({}),
        toProductiveFixed: z.record(z.string(), nonNeg).optional().default({}),
        toProductiveVariable: z.record(z.string(), nonNeg).optional().default({}),
        // Cómo se arma el reparto secundario de este servicio:
        //  - 'manual' : el costista tipea los % por centro (toProductive*). Es el
        //               modo por defecto → todo lo ya cargado sigue igual.
        //  - 'base'   : el motor DERIVA el reparto desde las unidades de una base
        //               física (`baseCode`); los valores por centro se resuelven
        //               desde allocation_base_values y se vuelcan a `toProductive`
        //               en la capa de servicio antes de calcular. El costista no
        //               tipea porcentajes: salen de la base (trazable).
        distributionMode: z.enum(['manual', 'base']).optional().default('manual'),
        // Base física del secundario. Requerida en modo 'base'; en 'manual' es
        // opcional (solo etiqueta para mostrar en el árbol).
        baseCode: z.string().max(60).optional(),
      }),
    )
    .max(100),
  // ORDEN DE CIERRE del prorrateo secundario escalonado (Parte 4.4, criterio
  // A.3.c). Lista de `serviceCenterId` en el orden en que cierran. Si está
  // presente y no vacía, el motor usa el método ESCALONADO (un servicio puede
  // repartir a otro que aún no cerró). Si falta, se usa la pasada directa
  // legada (retrocompatible con FX1/FX3 y con estructuras ya cargadas).
  closureOrder: z.array(z.string().min(1)).max(100).optional().default([]),
  // Por depto productivo: capacidad normal, actividad real y CIP real (datos
  // manuales de fin de mes). El PRESUPUESTO no es manual: se deriva del prorrateo
  // y se persiste automáticamente (solo lectura en la UI).
  productiveSettings: z
    .array(
      z.object({
        centerId: z.string().min(1),
        budget: fixedVariableSchema.optional().default({ fixed: 0, variable: 0 }),
        normalCapacity: nonNeg,
        actualActivity: nonNeg,
        actualCip: nonNeg,
      }),
    )
    .max(100),
});
export type IndirectCostConfig = z.infer<typeof indirectCostConfigSchema>;

// --- Estructura de costos (crear / actualizar) ---

export const createCostStructureSchema = z.object({
  productName: z.string().min(1).max(160).trim(),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Formato de período: YYYY-MM'),
  costingSystem: z.enum(['ORDERS', 'PROCESSES']).default('ORDERS'),
});
export type CreateCostStructureInput = z.infer<typeof createCostStructureSchema>;

export const updateSalesSchema = z.object({
  salesUnitPrice: nonNeg,
  /** Unidades VENDIDAS: facturación (precio × cantidad) y margen. */
  salesQuantity: nonNeg,
  /**
   * Unidades PRODUCIDAS: con esto sale el COSTO UNITARIO. Opcional para no romper
   * lo ya cargado (ni el cliente viejo): si no viene, el costo unitario se cae a las
   * vendidas, que es lo que el sistema hacía antes de tener este campo.
   */
  productionQuantity: nonNeg.nullish(),
});

// Inventarios para el Estado de Costos (Hoja 4).
export const inventorySchema = z.object({
  initialWorkInProcess: nonNeg.default(0),
  finalWorkInProcess: nonNeg.default(0),
  initialFinishedGoods: nonNeg.default(0),
  finalFinishedGoods: nonNeg.default(0),
});
export type InventoryInput = z.infer<typeof inventorySchema>;
