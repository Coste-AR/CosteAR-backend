import type { Decimal } from 'decimal.js';
import { Money } from '../../domain/value-objects/money.js';
import {
  calcOptimalLot,
  calcStockLedgerPPP,
  type StockLedgerResult,
} from '../../domain/calculations/raw-material.js';
import { calcDirectLabor, type DirectLaborResult } from '../../domain/calculations/direct-labor.js';
import {
  primaryProration,
  secondaryProration,
  secondaryProrationStepwise,
  calcPredeterminedQuota,
  calcVarianceAnalysis,
  fvZero,
  type CostCenter,
  type IndirectCostConcept,
  type FixedVariable,
  type ServiceClosure,
  type PredeterminedQuota,
  type VarianceAnalysis,
} from '../../domain/calculations/indirect-costs.js';
import { MissingAllocationBaseError } from '../../domain/errors/calculation-errors.js';
import {
  calcCostStatement,
  calcGrossMargin,
  type CostStatementResult,
  type MarginResult,
} from '../../domain/calculations/cost-statement.js';
import type {
  RawMaterialConfig,
  RawMaterialSection,
  DirectLaborConfig,
  IndirectCostConfig,
  InventoryInput,
} from '../../shared/schemas/cost.schema.js';

/**
 * Versión del motor de cálculo. Sube con cada cambio de fórmula (no con cada
 * cambio de código): permite saber, mirando un `calculation_run` viejo, con
 * qué lógica se calculó. Ver DECISIONES.md.
 */
export const ENGINE_VERSION = 'v1.0.0';

/**
 * Orquesta el motor de cálculo completo (Hojas 1-4) a partir de la
 * configuración persistida de una estructura de costos. Es una función PURA:
 * recibe configuración + datos de venta, devuelve el resultado consolidado.
 * No toca base de datos ni red — eso vive en el servicio que la invoca.
 */

export interface CalculationInput {
  rawMaterial: RawMaterialSection;
  directLabor: DirectLaborConfig;
  indirectCosts: IndirectCostConfig;
  inventory: InventoryInput;
  sales: { unitPrice: number; quantity: number };
}

/** Resultado por materia prima (Parte 3.1: N materias primas). */
export interface MaterialResult {
  config: RawMaterialConfig;
  optimalLot: Decimal;
  ledger: StockLedgerResult;
}

export interface CalculationOutput {
  rawMaterialConsumed: number;
  directLaborTotal: number;
  indirectCostsApplied: number;
  productionCost: number;
  costOfGoodsSold: number;
  grossMargin: number;
  grossMarginPct: number;
  detail: {
    rawMaterial: {
      // Agregados (compat con la vista de resultado): lote del primer material,
      // stock final sumado de todas las materias primas.
      optimalLot: number;
      finalStockQty: number;
      finalStockValue: number;
      // Detalle por materia prima (Parte 3.1).
      materials: Array<{
        id?: string;
        code?: string;
        name?: string;
        unit?: string;
        optimalLot: number;
        finalStockQty: number;
        finalStockValue: number;
        consumed: number;
      }>;
    };
    directLabor: { workingDays: number; paidDays: number; itcsPercent: number; iapPercent: number; hourlyRates: Record<string, number> };
    indirectCosts: {
      perDepartment: Record<
        string,
        {
          cipTotal: number;
          appliedCip: number;
          budgetVariance: number;
          volumeVariance: number;
          normalCapacity: number;
          actualActivity: number;
          quota: number;
          actualCip: number;
          // Split fijo/variable del presupuesto derivado y de la cuota (Parte 3.3):
          // permiten mostrar la ficha del centro con su fórmula (presup ÷ cap. normal).
          budgetFixed: number;
          budgetVariable: number;
          quotaFixed: number;
          quotaVariable: number;
          overUnderApplied: number; // aplicado − real (sobre/subaplicación)
        }
      >;
    };
  };
  /**
   * Objetos intermedios YA calculados por las funciones puras (ledger,
   * departamentos, cuotas/variaciones por centro, estado de costos). El
   * tree-builder de F2 arma el árbol de `calculation_nodes` a partir de ESTOS
   * objetos — nunca recalcula — para que el árbol persistido y el número
   * final sean, por construcción, la misma fuente de verdad.
   */
  raw: {
    materials: MaterialResult[];
    labor: DirectLaborResult;
    indirectPerDepartment: Record<
      string,
      {
        quota: PredeterminedQuota;
        variance: VarianceAnalysis;
        budget: FixedVariable;
        normalCapacity: number;
        actualActivity: number;
        actualCip: Money;
      }
    >;
    statement: CostStatementResult;
    margin: MarginResult;
  };
}

/**
 * Calcula el PRESUPUESTO (fijo/variable) de cada centro PRODUCTIVO a partir del
 * prorrateo primario + cierre del secundario. Es la "auto-carga" del presupuesto
 * que pide la metodología: el usuario nunca lo tipea a mano. Se usa al guardar la
 * sección de Costos Indirectos para persistir el valor y mostrarlo (solo lectura).
 */
export function computeProductiveBudgets(
  indirectCosts: IndirectCostConfig,
): Record<string, { fixed: number; variable: number }> {
  const productiveCip = resolveProductiveCip(indirectCosts);
  const out: Record<string, { fixed: number; variable: number }> = {};
  for (const [centerId, fv] of Object.entries(productiveCip)) {
    out[centerId] = { fixed: fv.fixed.toNumber(), variable: fv.variable.toNumber() };
  }
  return out;
}

/**
 * Resuelve el CIP acumulado (primario + secundario) de cada centro PRODUCTIVO.
 *
 * Si la config trae `closureOrder` (orden de cierre), usa el método ESCALONADO
 * (criterio A.3.c): un servicio puede repartir a otro que aún no cerró. Si no,
 * usa la pasada directa legada (retrocompatible con FX1/FX3 y estructuras ya
 * cargadas). Es la única fuente del presupuesto productivo: el usuario nunca lo
 * tipea (criterio A.3).
 */
export function resolveProductiveCip(
  indirectCosts: IndirectCostConfig,
): Record<string, FixedVariable> {
  const centers: CostCenter[] = indirectCosts.centers;
  const concepts: IndirectCostConcept[] = indirectCosts.concepts.map((c) => ({
    name: c.name,
    amount: { fixed: Money.of(c.amount.fixed), variable: Money.of(c.amount.variable) },
    distribution: c.distribution,
  }));
  const primary = primaryProration(centers, concepts);

  const order = indirectCosts.closureOrder ?? [];
  if (order.length === 0) {
    // Camino legado: pasada directa servicio→productivo.
    return secondaryProration(centers, primary, indirectCosts.serviceDistributions);
  }

  // Camino escalonado: construir los cierres en el orden pedido.
  const distById = new Map(
    indirectCosts.serviceDistributions.map((d) => [d.serviceCenterId, d]),
  );
  const closures: ServiceClosure[] = order.map((serviceCenterId) => {
    const d = distById.get(serviceCenterId);
    if (!d) {
      throw new MissingAllocationBaseError(
        serviceCenterId,
        `El centro de servicio "${serviceCenterId}" está en el orden de cierre pero no tiene base de distribución cargada. Asigná su base de distribución.`,
      );
    }
    return {
      serviceCenterId,
      distribution: d.toProductive ?? {},
      distributionFixed: d.toProductiveFixed,
      distributionVariable: d.toProductiveVariable,
      baseName: d.baseCode,
    };
  });

  const { byCenter } = secondaryProrationStepwise(centers, primary, closures);
  const out: Record<string, FixedVariable> = {};
  for (const c of centers) {
    if (c.type === 'productive') out[c.id] = byCenter[c.id] ?? fvZero();
  }
  return out;
}

export function runCalculation(input: CalculationInput): CalculationOutput {
  // --- Hoja 1: Materia Prima (N materias primas, Parte 3.1) ---
  const materials: MaterialResult[] = input.rawMaterial.materials.map((m) => ({
    config: m,
    optimalLot: calcOptimalLot(m.wilson),
    ledger: calcStockLedgerPPP(m.initialStock.quantity, m.initialStock.unitCost, m.movements),
  }));
  // MP consumida total = Σ del consumo valuado a PPP de cada materia prima.
  const rawMaterialConsumed = Money.sum(materials.map((x) => x.ledger.rawMaterialConsumed));

  // --- Hoja 2: Mano de Obra Directa ---
  const labor = calcDirectLabor(input.directLabor);
  const directLaborTotal = labor.totalMod;

  // --- Hoja 3: Costos Indirectos ---
  // El CIP productivo (presupuesto) sale del prorrateo: escalonado si hay orden
  // de cierre, directo si no. El usuario nunca lo tipea (criterio A.3).
  const productiveCip = resolveProductiveCip(input.indirectCosts);

  const perDepartment: CalculationOutput['detail']['indirectCosts']['perDepartment'] = {};
  const indirectPerDepartment: CalculationOutput['raw']['indirectPerDepartment'] = {};
  let indirectCostsApplied = Money.zero();

  for (const setting of input.indirectCosts.productiveSettings) {
    // PRESUPUESTO del centro = resultado del prorrateo (primario + cierre del
    // secundario). NO es un dato manual: se deriva automáticamente. Si el centro
    // no figura en el prorrateo, se cae al valor manual persistido como respaldo.
    const prorated = productiveCip[setting.centerId];
    const budget: FixedVariable = prorated ?? {
      fixed: Money.of(setting.budget?.fixed ?? 0),
      variable: Money.of(setting.budget?.variable ?? 0),
    };
    const quota = calcPredeterminedQuota(budget, setting.normalCapacity);

    // CIP REAL = dato de cierre de mes ingresado por el usuario. Es lo que se
    // compara contra el presupuesto para obtener la variación de presupuesto.
    const actualCip = Money.of(setting.actualCip);

    const variance = calcVarianceAnalysis(
      quota,
      budget,
      setting.normalCapacity,
      setting.actualActivity,
      actualCip,
    );
    indirectCostsApplied = indirectCostsApplied.add(variance.cipApplied);

    perDepartment[setting.centerId] = {
      cipTotal: actualCip.toNumber(),
      appliedCip: variance.cipApplied.toNumber(),
      budgetVariance: variance.budgetVariance.toNumber(),
      volumeVariance: variance.volumeVariance.toNumber(),
      normalCapacity: setting.normalCapacity,
      actualActivity: setting.actualActivity,
      quota: quota.totalQuota.toNumber(),
      actualCip: actualCip.toNumber(),
      budgetFixed: budget.fixed.toNumber(),
      budgetVariable: budget.variable.toNumber(),
      quotaFixed: quota.fixedQuota.toNumber(),
      quotaVariable: quota.variableQuota.toNumber(),
      overUnderApplied: variance.overUnderApplied.toNumber(),
    };
    indirectPerDepartment[setting.centerId] = {
      quota,
      variance,
      budget,
      normalCapacity: setting.normalCapacity,
      actualActivity: setting.actualActivity,
      actualCip,
    };
  }

  // --- Hoja 4: Estado de Costos ---
  // MP: para el estado usamos la valuación de la ficha (Ex.Inicial + Compras − Ex.Final
  // equivale al consumo de la ficha PPP, ya validado por consistencia). Con N
  // materias primas, se suma cada componente entre todas.
  const initialRM = Money.sum(
    materials.map((x) =>
      Money.of(x.config.initialStock.unitCost).multiply(x.config.initialStock.quantity),
    ),
  );
  const purchases = Money.sum(
    materials.flatMap((x) =>
      x.config.movements
        .filter((m) => m.type === 'purchase')
        .map((m) => Money.of(m.unitCost ?? 0).multiply(m.quantity)),
    ),
  );
  const finalRM = Money.sum(materials.map((x) => x.ledger.finalBalanceValue));

  const statement = calcCostStatement({
    initialRawMaterial: initialRM,
    rawMaterialPurchases: purchases,
    finalRawMaterial: finalRM,
    directLabor: directLaborTotal,
    indirectCostsApplied,
    initialWorkInProcess: Money.of(input.inventory.initialWorkInProcess),
    finalWorkInProcess: Money.of(input.inventory.finalWorkInProcess),
    initialFinishedGoods: Money.of(input.inventory.initialFinishedGoods),
    finalFinishedGoods: Money.of(input.inventory.finalFinishedGoods),
  });

  // --- Margen ---
  const salesRevenue = Money.of(input.sales.unitPrice).multiply(input.sales.quantity);
  const margin = calcGrossMargin(salesRevenue, statement.costOfGoodsSold);

  const hourlyRates: Record<string, number> = {};
  for (const d of labor.departments) {
    hourlyRates[d.name] = d.hourlyRate.toNumber();
  }

  return {
    rawMaterialConsumed: rawMaterialConsumed.toNumber(),
    directLaborTotal: directLaborTotal.toNumber(),
    indirectCostsApplied: indirectCostsApplied.toNumber(),
    productionCost: statement.productionCost.toNumber(),
    costOfGoodsSold: statement.costOfGoodsSold.toNumber(),
    grossMargin: margin.grossMargin.toNumber(),
    grossMarginPct: margin.grossMarginPct.toPercent(),
    detail: {
      rawMaterial: {
        optimalLot: materials[0]?.optimalLot.toNumber() ?? 0,
        finalStockQty: materials.reduce((a, x) => a + x.ledger.finalBalanceQty.toNumber(), 0),
        finalStockValue: finalRM.toNumber(),
        materials: materials.map((x) => ({
          id: x.config.id,
          code: x.config.code,
          name: x.config.name,
          unit: x.config.unit,
          optimalLot: x.optimalLot.toNumber(),
          finalStockQty: x.ledger.finalBalanceQty.toNumber(),
          finalStockValue: x.ledger.finalBalanceValue.toNumber(),
          consumed: x.ledger.rawMaterialConsumed.toNumber(),
        })),
      },
      directLabor: {
        workingDays: labor.workingDays.effectiveWorkDays.toNumber(),
        // Días de ausentismo pago (numerador del IAP). Se expone para poder
        // mostrar la fórmula completa "IAP = días pagos / días efectivos".
        paidDays: labor.workingDays.totalPaidAbsence.toNumber(),
        itcsPercent: labor.itcs.itcs.toPercent(),
        // IAP — Índice de Ausentismo Pago (ya calculado en calcWorkingDays, se expone
        // para mostrarlo en el resultado). No cambia ninguna fórmula.
        iapPercent: labor.workingDays.iap.toPercent(),
        hourlyRates,
      },
      indirectCosts: { perDepartment },
    },
    raw: { materials, labor, indirectPerDepartment, statement, margin },
  };
}
