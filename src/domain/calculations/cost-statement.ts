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
 *   7  = COSTO NORMAL DE PRODUCCIÓN DEL PERÍODO
 *   7b Variación presupuesto               (±)
 *   7c = COSTO REAL DE PRODUCCIÓN
 *   8  Inv. Inicial Productos en Proceso   (+)
 *   9  Inv. Final Productos en Proceso     (−)
 *   10 = COSTO DE PRODUCTOS TERMINADOS
 *   11 Inv. Inicial Productos Terminados   (+)
 *   12 Inv. Final Productos Terminados     (−)
 *   13 = COSTO DE LOS PRODUCTOS VENDIDOS
 *
 * NORMAL vs. REAL (clase 28): «normal = MP + MO + CIF aplicados; real = normal +
 * variación presupuesto». El renglón (7) se calculaba y se trataba como si fuera
 * el real, y no lo era: sin la variación presupuesto el estado nunca llega al
 * costo real y todo lo que sigue arrastra la diferencia (issue #90).
 *
 * LAS DOS VARIACIONES TIENEN DESTINOS DISTINTOS, y confundirlas es el error que
 * la cátedra marca como el que más se olvida (clase 26):
 *
 *   - Variación PRESUPUESTO → acá, al costo del producto. Es lo que costó de
 *     más (o de menos) hacer lo que se hizo.
 *   - Variación VOLUMEN → al estado de RESULTADOS, como pérdida del período. Es
 *     capacidad ociosa: una pérdida de la empresa, no un costo del producto.
 *     **No entra a este estado, y que hoy no esté es correcto.**
 *
 * SIGNO: `budgetVariance` viene de `actualCip − budgetAtActual`. Positivo = el
 * CIP real superó al presupuesto ajustado a la actividad real = pérdida, y
 * ENCARECE el costo real. Negativo = ahorro, y lo abarata. Por eso se suma tal
 * cual, sin invertir nada.
 */

export interface CostStatementInput {
  initialRawMaterial: Money;
  rawMaterialPurchases: Money;
  finalRawMaterial: Money;

  directLabor: Money;
  indirectCostsApplied: Money;

  /**
   * Σ variación presupuesto de los centros que CERRARON el período.
   *
   * Opcional: si falta se toma cero, y entonces el costo real es igual al
   * normal. Eso es lo correcto para un período sin cerrar —donde todavía no hay
   * CIP real contra el cual comparar— y además deja intacto el resultado de
   * cualquier cálculo anterior a que este renglón existiera.
   */
  budgetVariance?: Money;

  initialWorkInProcess: Money;
  finalWorkInProcess: Money;

  initialFinishedGoods: Money;
  finalFinishedGoods: Money;
}

export interface CostStatementResult {
  rawMaterialConsumed: Money; // (4)
  /**
   * (7) Costo NORMAL de producción = MP + MOD + CIP aplicados.
   *
   * Se sigue llamando `productionCost` para no romper a los consumidores, pero
   * es el normal: el que NO incluye la variación presupuesto.
   */
  productionCost: Money;
  /** (7b) La variación presupuesto que se incorporó al costo. Cero si no se pasó. */
  budgetVariance: Money;
  /** (7c) Costo REAL de producción = normal + variación presupuesto. */
  realProductionCost: Money;
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

  // (7) Costo NORMAL de producción = MP + MOD + CIP aplicados
  const productionCost = rawMaterialConsumed
    .add(input.directLabor)
    .add(input.indirectCostsApplied);

  // (7b–7c) Costo REAL = normal ± variación presupuesto.
  const budgetVariance = input.budgetVariance ?? Money.zero();
  const realProductionCost = productionCost.add(budgetVariance);

  // (10) Costo de productos terminados = Costo REAL + Inv.Inicial PP − Inv.Final PP.
  // Parte del real y no del normal: si partiera del normal, la variación
  // presupuesto no llegaría nunca al costo del producto vendido.
  const finishedGoodsCost = realProductionCost
    .add(input.initialWorkInProcess)
    .subtract(input.finalWorkInProcess);

  // (13) CPV = Terminados + Inv.Inicial PT − Inv.Final PT
  const costOfGoodsSold = finishedGoodsCost
    .add(input.initialFinishedGoods)
    .subtract(input.finalFinishedGoods);

  return {
    rawMaterialConsumed,
    productionCost,
    budgetVariance,
    realProductionCost,
    finishedGoodsCost,
    costOfGoodsSold,
  };
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
