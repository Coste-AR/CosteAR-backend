import { Money } from '../../domain/value-objects/money.js';
import {
  calcOptimalLot,
  calcStockLedgerPPP,
} from '../../domain/calculations/raw-material.js';
import { calcDirectLabor } from '../../domain/calculations/direct-labor.js';
import {
  primaryProration,
  secondaryProration,
  calcPredeterminedQuota,
  calcVarianceAnalysis,
  type CostCenter,
  type IndirectCostConcept,
  type FixedVariable,
} from '../../domain/calculations/indirect-costs.js';
import {
  calcCostStatement,
  calcGrossMargin,
} from '../../domain/calculations/cost-statement.js';
import type {
  RawMaterialConfig,
  DirectLaborConfig,
  IndirectCostConfig,
  InventoryInput,
} from '../../shared/schemas/cost.schema.js';

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
    directLabor: { workingDays: number; itcsPercent: number; iapPercent: number; hourlyRates: Record<string, number> };
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
  const centers: CostCenter[] = indirectCosts.centers;
  const concepts: IndirectCostConcept[] = indirectCosts.concepts.map((c) => ({
    name: c.name,
    amount: { fixed: Money.of(c.amount.fixed), variable: Money.of(c.amount.variable) },
    distribution: c.distribution,
  }));
  const primary = primaryProration(centers, concepts);
  const productiveCip = secondaryProration(centers, primary, indirectCosts.serviceDistributions);

  const out: Record<string, { fixed: number; variable: number }> = {};
  for (const [centerId, fv] of Object.entries(productiveCip)) {
    out[centerId] = { fixed: fv.fixed.toNumber(), variable: fv.variable.toNumber() };
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
  const centers: CostCenter[] = input.indirectCosts.centers;
  const concepts: IndirectCostConcept[] = input.indirectCosts.concepts.map((c) => ({
    name: c.name,
    amount: { fixed: Money.of(c.amount.fixed), variable: Money.of(c.amount.variable) },
    distribution: c.distribution,
  }));
  const primary = primaryProration(centers, concepts);
  const productiveCip = secondaryProration(
    centers,
    primary,
    input.indirectCosts.serviceDistributions,
  );

  const perDepartment: CalculationOutput['detail']['indirectCosts']['perDepartment'] = {};
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
        itcsPercent: labor.itcs.itcs.toPercent(),
        // IAP — Índice de Ausentismo Pago (ya calculado en calcWorkingDays, se expone
        // para mostrarlo en el resultado). No cambia ninguna fórmula.
        iapPercent: labor.workingDays.iap.toPercent(),
        hourlyRates,
      },
      indirectCosts: { perDepartment },
    },
  };
}

export interface CalcNode {
  ord: number;
  label: string;
  formula?: string;
  valueNum?: number;
  unit?: string;
  sourceDpVersionIds?: string[];
  children: CalcNode[];
}

export function buildCalculationTree(input: CalculationInput, output: CalculationOutput): CalcNode[] {
  let ord = 1;
  const nextOrd = () => ord++;

  return [
    {
      ord: nextOrd(),
      label: 'Materia Prima Consumida',
      valueNum: output.rawMaterialConsumed,
      formula: 'Inventario Inicial + Compras - Inventario Final',
      children: [
        { ord: nextOrd(), label: 'Inventario Inicial MP', valueNum: input.rawMaterial.initialStock.quantity * input.rawMaterial.initialStock.unitCost, children: [] },
        { ord: nextOrd(), label: 'Inventario Final MP', valueNum: output.detail.rawMaterial.finalStockValue, children: [] }
      ]
    },
    {
      ord: nextOrd(),
      label: 'Mano de Obra Directa (MOD)',
      valueNum: output.directLaborTotal,
      children: []
    },
    {
      ord: nextOrd(),
      label: 'Costos Indirectos de Producción (CIP)',
      valueNum: output.indirectCostsApplied,
      children: Object.values(output.detail.indirectCosts.perDepartment).map(d => ({
        ord: nextOrd(),
        label: 'CIP Aplicado Departamento',
        valueNum: d.appliedCip,
        formula: 'Actividad Real * Cuota Predeterminada',
        children: []
      }))
    },
    {
      ord: nextOrd(),
      label: 'Costo de Producción',
      valueNum: output.productionCost,
      formula: 'MP + MOD + CIP',
      children: []
    },
    {
      ord: nextOrd(),
      label: 'Costo de Productos Vendidos',
      valueNum: output.costOfGoodsSold,
      formula: 'Producción + Inv Inicial - Inv Final',
      children: []
    }
  ];
}
