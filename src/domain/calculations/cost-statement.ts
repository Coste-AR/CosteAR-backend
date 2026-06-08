import { Money } from '../value-objects/money.js';
import { Percentage } from '../value-objects/percentage.js';

/**
 * HOJA 4 · ESTADO DE COSTOS DE PRODUCTOS TERMINADOS Y VENDIDOS
 *
 * Consolida los tres elementos del costo (MP + MOD + CIP) y los lleva,
 * a través de los inventarios de proceso y de productos terminados, hasta
 * el Costo de los Productos Vendidos (CPV).
 *
 * Estructura (numeración igual a la hoja del Excel):
 *   1  Existencia Inicial de MP            (+)
 *   2  Compras Netas de MP                 (+)
 *   3  Existencia Final de MP              (−)
 *   4  = MATERIA PRIMA CONSUMIDA
 *   5  Mano de Obra Directa                (+)
 *   6  CIP Aplicados                       (+)
 *   7  = COSTO DE PRODUCCIÓN DEL PERÍODO
 *   8  Inv. Inicial Productos en Proceso   (+)
 *   9  Inv. Final Productos en Proceso     (−)
 *   10 = COSTO DE PRODUCTOS TERMINADOS
 *   11 Inv. Inicial Productos Terminados   (+)
 *   12 Inv. Final Productos Terminados     (−)
 *   13 = COSTO DE LOS PRODUCTOS VENDIDOS
 */

export interface CostStatementInput {
  initialRawMaterial: Money;
  rawMaterialPurchases: Money;
  finalRawMaterial: Money;

  directLabor: Money;
  indirectCostsApplied: Money;

  initialWorkInProcess: Money;
  finalWorkInProcess: Money;

  initialFinishedGoods: Money;
  finalFinishedGoods: Money;
}

export interface CostStatementResult {
  rawMaterialConsumed: Money; // (4)
  productionCost: Money; // (7)
  finishedGoodsCost: Money; // (10)
  costOfGoodsSold: Money; // (13)
}

/**
 * Calcula el Estado de Costos completo.
 *
 * Nota: la MP consumida puede provenir de dos lugares —
 *   (a) de la ficha de stock PPP (Hoja 1), o
 *   (b) del cálculo Ex.Inicial + Compras − Ex.Final.
 * Aquí usamos (b) para que el estado sea autocontenido y chequeable;
 * `checkRawMaterialConsistency` permite validarlo contra (a).
 */
export function calcCostStatement(input: CostStatementInput): CostStatementResult {
  // (4) MP consumida = Ex.Inicial + Compras − Ex.Final
  const rawMaterialConsumed = input.initialRawMaterial
    .add(input.rawMaterialPurchases)
    .subtract(input.finalRawMaterial);

  // (7) Costo de producción = MP + MOD + CIP
  const productionCost = rawMaterialConsumed
    .add(input.directLabor)
    .add(input.indirectCostsApplied);

  // (10) Costo de productos terminados = Producción + Inv.Inicial PP − Inv.Final PP
  const finishedGoodsCost = productionCost
    .add(input.initialWorkInProcess)
    .subtract(input.finalWorkInProcess);

  // (13) CPV = Terminados + Inv.Inicial PT − Inv.Final PT
  const costOfGoodsSold = finishedGoodsCost
    .add(input.initialFinishedGoods)
    .subtract(input.finalFinishedGoods);

  return { rawMaterialConsumed, productionCost, finishedGoodsCost, costOfGoodsSold };
}

/**
 * Chequeo de consistencia: la MP consumida del estado debe coincidir con la
 * MP consumida que calculó la ficha de stock (Hoja 1). Diferencia debe ser 0.
 */
export function checkRawMaterialConsistency(
  statementConsumed: Money,
  ledgerConsumed: Money,
): { matches: boolean; difference: Money } {
  const difference = statementConsumed.subtract(ledgerConsumed);
  return { matches: difference.isZero(), difference };
}

// ---------------------------------------------------------------------------
// Margen: el indicador que dispara las alertas de CosteAR
// ---------------------------------------------------------------------------

export interface MarginResult {
  /** Precio de venta total (unitario × cantidad). */
  salesRevenue: Money;
  /** Costo de los productos vendidos. */
  costOfGoodsSold: Money;
  /** Margen bruto = ventas − CPV. */
  grossMargin: Money;
  /** Margen bruto como % sobre ventas. */
  grossMarginPct: Percentage;
}

/**
 * Margen bruto. Es el corazón del sistema de alertas: cuando los datos macro
 * mueven el costo y el margen cae bajo el umbral del costista, se dispara
 * una alerta antes de que el cliente PyME venda a pérdida.
 */
export function calcGrossMargin(
  salesRevenue: Money,
  costOfGoodsSold: Money,
): MarginResult {
  const grossMargin = salesRevenue.subtract(costOfGoodsSold);
  const grossMarginPct = salesRevenue.isZero()
    ? Percentage.zero()
    : Percentage.fromFraction(
        grossMargin.toDecimal().dividedBy(salesRevenue.toDecimal()),
      );
  return { salesRevenue, costOfGoodsSold, grossMargin, grossMarginPct };
}
