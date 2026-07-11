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
  rawMaterial: RawMaterialConfig;
  directLabor: DirectLaborConfig;
  indirectCosts: IndirectCostConfig;
  inventory: InventoryInput;
  sales: { unitPrice: number; quantity: number };
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
    rawMaterial: { optimalLot: number; finalStockQty: number; finalStockValue: number };
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
    optimalLot: Decimal;
    ledger: StockLedgerResult;
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
  // --- Hoja 1: Materia Prima ---
  const optimalLot = calcOptimalLot(input.rawMaterial.wilson);
  const ledger = calcStockLedgerPPP(
    input.rawMaterial.initialStock.quantity,
    input.rawMaterial.initialStock.unitCost,
    input.rawMaterial.movements,
  );
  const rawMaterialConsumed = ledger.rawMaterialConsumed;

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
  // equivale al consumo de la ficha PPP, ya validado por consistencia).
  const initialRM = Money.of(input.rawMaterial.initialStock.unitCost).multiply(
    input.rawMaterial.initialStock.quantity,
  );
  const purchases = Money.sum(
    input.rawMaterial.movements
      .filter((m) => m.type === 'purchase')
      .map((m) => Money.of(m.unitCost ?? 0).multiply(m.quantity)),
  );

  const statement = calcCostStatement({
    initialRawMaterial: initialRM,
    rawMaterialPurchases: purchases,
    finalRawMaterial: ledger.finalBalanceValue,
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
        optimalLot: optimalLot.toNumber(),
        finalStockQty: ledger.finalBalanceQty.toNumber(),
        finalStockValue: ledger.finalBalanceValue.toNumber(),
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
    raw: { optimalLot, ledger, labor, indirectPerDepartment, statement, margin },
  };
}
