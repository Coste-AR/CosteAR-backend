import { Decimal } from 'decimal.js';
import { Money } from '../value-objects/money.js';

/**
 * HOJA 1 · MATERIA PRIMA
 * Lote Óptimo de Wilson, políticas de stock y valuación por
 * Precio Promedio Ponderado (PPP).
 *
 * Replica celda por celda la metodología de la Cátedra de Costos (UNT),
 * tal como está modelada en `motor de cálculo v3.0.xlsx`.
 */

export interface WilsonParams {
  /** R — Demanda / consumo anual previsto (unidades/año) */
  annualDemand: Decimal.Value;
  /** S — Costo de emitir una orden de compra ($/orden) */
  orderCost: Decimal.Value;
  /** K — Tasa de costo de mantener inventario (% anual, fracción: 0.30) */
  holdingRate: Decimal.Value;
  /** C — Costo unitario de adquisición de la MP ($/unidad) */
  unitCost: Decimal.Value;
}

export interface StockPolicyParams {
  /** Cm — Consumo mínimo (unid/día) */
  minConsumption: Decimal.Value;
  /** CM — Consumo máximo (unid/día) */
  maxConsumption: Decimal.Value;
  /** Pm — Plazo mínimo de reposición (días) */
  minLeadTime: Decimal.Value;
  /** PM — Plazo máximo de reposición (días) */
  maxLeadTime: Decimal.Value;
  /** Sr — Stock de reserva (unidades) */
  safetyStock: Decimal.Value;
}

export interface StockPolicyResult {
  /** CP — Consumo promedio = (CM + Cm) / 2 */
  avgConsumption: Decimal;
  /** LE — Lote óptimo de compra = √(2·R·S / K·C) */
  optimalLot: Decimal;
  /** sm — Stock mínimo = CM·PM + Sr */
  minStock: Decimal;
  /** P.Ped — Punto de pedido = CM·PM − Sr + sm */
  reorderPoint: Decimal;
  /** SM — Stock máximo = sm + Cm·Pm + LE */
  maxStock: Decimal;
}

/**
 * Lote Óptimo de Wilson:  LE = √(2·R·S / (K·C))
 */
export function calcOptimalLot(p: WilsonParams): Decimal {
  const R = new Decimal(p.annualDemand);
  const S = new Decimal(p.orderCost);
  const K = new Decimal(p.holdingRate);
  const C = new Decimal(p.unitCost);

  const denominator = K.times(C);
  if (denominator.isZero()) {
    throw new Error('Wilson: K·C no puede ser cero (división por cero)');
  }
  return R.times(S).times(2).dividedBy(denominator).sqrt();
}

/**
 * Políticas de stock completas. `optimalLot` se inyecta para no recalcular
 * Wilson dos veces y mantener consistencia.
 */
export function calcStockPolicies(
  p: StockPolicyParams,
  optimalLot: Decimal,
): StockPolicyResult {
  const Cm = new Decimal(p.minConsumption);
  const CM = new Decimal(p.maxConsumption);
  const Pm = new Decimal(p.minLeadTime);
  const PM = new Decimal(p.maxLeadTime);
  const Sr = new Decimal(p.safetyStock);

  const avgConsumption = CM.plus(Cm).dividedBy(2);
  const minStock = CM.times(PM).plus(Sr);
  const reorderPoint = CM.times(PM).minus(Sr).plus(minStock);
  const maxStock = minStock.plus(Cm.times(Pm)).plus(optimalLot);

  return { avgConsumption, optimalLot, minStock, reorderPoint, maxStock };
}

// ---------------------------------------------------------------------------
// Ficha de Stock con valuación PPP (Precio Promedio Ponderado)
// ---------------------------------------------------------------------------

export type StockMovementType = 'purchase' | 'consumption';

export interface StockMovementInput {
  date: string; // ISO o "DD/MM"
  type: StockMovementType;
  detail: string;
  quantity: Decimal.Value;
  /** Solo para compras: costo unitario de la factura. */
  unitCost?: Decimal.Value;
}

export interface StockLedgerRow {
  date: string;
  detail: string;
  type: StockMovementType;
  quantity: Decimal;
  /** Costo unitario del movimiento (PPP vigente en consumos). */
  movementUnitCost: Money;
  /** Importe total del movimiento. */
  movementTotal: Money;
  /** Saldo en unidades tras el movimiento. */
  balanceQty: Decimal;
  /** PPP del saldo tras el movimiento. */
  balanceUnitCost: Money;
  /** Valor total del saldo. */
  balanceTotal: Money;
}

export interface StockLedgerResult {
  rows: StockLedgerRow[];
  /** Σ de las salidas valuadas = Materia Prima Consumida. */
  rawMaterialConsumed: Money;
  /** Saldo final en unidades. */
  finalBalanceQty: Decimal;
  /** Valor del saldo final. */
  finalBalanceValue: Money;
}

/**
 * Procesa la ficha de stock con valuación PPP.
 *
 * Regla PPP: tras cada COMPRA, el costo unitario del saldo se recalcula como
 *   (valor del saldo previo + valor de la compra) / (unidades totales).
 * Los CONSUMOS salen valuados al PPP vigente y NO alteran el costo unitario.
 *
 * @param initialQty   Existencia inicial en unidades.
 * @param initialUnitCost Costo unitario de la existencia inicial.
 * @param movements    Movimientos en orden cronológico.
 */
export function calcStockLedgerPPP(
  initialQty: Decimal.Value,
  initialUnitCost: Decimal.Value,
  movements: StockMovementInput[],
): StockLedgerResult {
  let balanceQty = new Decimal(initialQty);
  let balanceUnitCost = Money.of(initialUnitCost);
  let balanceTotal = balanceUnitCost.multiply(balanceQty);

  const rows: StockLedgerRow[] = [];
  let consumed = Money.zero();

  for (const m of movements) {
    const qty = new Decimal(m.quantity);

    if (m.type === 'purchase') {
      if (m.unitCost === undefined) {
        throw new Error(`Compra "${m.detail}" sin costo unitario`);
      }
      const purchaseUnitCost = Money.of(m.unitCost);
      const purchaseTotal = purchaseUnitCost.multiply(qty);

      balanceQty = balanceQty.plus(qty);
      balanceTotal = balanceTotal.add(purchaseTotal);
      // Recalcular PPP del saldo.
      balanceUnitCost = balanceQty.isZero()
        ? Money.zero()
        : balanceTotal.divide(balanceQty);

      rows.push({
        date: m.date,
        detail: m.detail,
        type: 'purchase',
        quantity: qty,
        movementUnitCost: purchaseUnitCost,
        movementTotal: purchaseTotal,
        balanceQty,
        balanceUnitCost,
        balanceTotal,
      });
    } else {
      // Consumo: sale al PPP vigente.
      if (qty.greaterThan(balanceQty)) {
        throw new Error(
          `Consumo "${m.detail}" (${qty}) supera el saldo disponible (${balanceQty})`,
        );
      }
      const consumptionUnitCost = balanceUnitCost;
      const consumptionTotal = consumptionUnitCost.multiply(qty);

      balanceQty = balanceQty.minus(qty);
      balanceTotal = balanceTotal.subtract(consumptionTotal);
      consumed = consumed.add(consumptionTotal);

      rows.push({
        date: m.date,
        detail: m.detail,
        type: 'consumption',
        quantity: qty,
        movementUnitCost: consumptionUnitCost,
        movementTotal: consumptionTotal,
        balanceQty,
        balanceUnitCost, // el PPP no cambia en consumos
        balanceTotal,
      });
    }
  }

  return {
    rows,
    rawMaterialConsumed: consumed,
    finalBalanceQty: balanceQty,
    finalBalanceValue: balanceTotal,
  };
}
