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
        hoursWorked: nonNeg,
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
        // Base física opcional del secundario (para mostrarla en el árbol).
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
  salesQuantity: nonNeg,
});

// Inventarios para el Estado de Costos (Hoja 4).
export const inventorySchema = z.object({
  initialWorkInProcess: nonNeg.default(0),
  finalWorkInProcess: nonNeg.default(0),
  initialFinishedGoods: nonNeg.default(0),
  finalFinishedGoods: nonNeg.default(0),
});
export type InventoryInput = z.infer<typeof inventorySchema>;
