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
    directLabor: { workingDays: number; itcsPercent: number; hourlyRates: Record<string, number> };
    indirectCosts: {
      perDepartment: Record<
        string,
        { cipTotal: number; appliedCip: number; budgetVariance: number; volumeVariance: number }
      >;
    };
  };
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
    const budget: FixedVariable = {
      fixed: Money.of(setting.budget.fixed),
      variable: Money.of(setting.budget.variable),
    };
    const quota = calcPredeterminedQuota(budget, setting.normalCapacity);
    const variance = calcVarianceAnalysis(
      quota,
      budget,
      setting.normalCapacity,
      setting.actualActivity,
      Money.of(setting.actualCip),
    );
    indirectCostsApplied = indirectCostsApplied.add(variance.cipApplied);

    const cip = productiveCip[setting.centerId];
    const cipTotal = cip ? cip.fixed.add(cip.variable) : Money.zero();
    perDepartment[setting.centerId] = {
      cipTotal: cipTotal.toNumber(),
      appliedCip: variance.cipApplied.toNumber(),
      budgetVariance: variance.budgetVariance.toNumber(),
      volumeVariance: variance.volumeVariance.toNumber(),
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
        hourlyRates,
      },
      indirectCosts: { perDepartment },
    },
  };
}
