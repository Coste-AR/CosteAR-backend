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
    annualDemand: positive,
    orderCost: nonNeg,
    holdingRate: z.number().finite().min(0).max(10), // fracción (0.30 = 30%)
    unitCost: positive,
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

export const directLaborConfigSchema = z.object({
  workingDays: z.object({
    totalDaysPerYear: positive,
    nonWorkingDays: nonNeg,
    vacationDays: nonNeg,
    averageAbsenceDays: nonNeg,
  }),
  socialCharges: z
    .array(z.object({ name: z.string().min(1).max(120), percent: nonNeg }))
    .max(50),
  departments: z
    .array(
      z.object({
        departmentName: z.string().min(1).max(120),
        workers: z.number().int().positive(),
        monthlyWage: positive,
        hoursPerDay: positive,
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
      }),
    )
    .max(200),
  serviceDistributions: z
    .array(
      z.object({
        serviceCenterId: z.string().min(1),
        toProductive: z.record(z.string(), nonNeg),
      }),
    )
    .max(100),
  // Por depto productivo: presupuesto y capacidad normal para cuotas/variaciones.
  productiveSettings: z
    .array(
      z.object({
        centerId: z.string().min(1),
        budget: fixedVariableSchema,
        normalCapacity: positive,
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
