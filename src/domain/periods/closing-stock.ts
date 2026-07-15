import { Decimal } from 'decimal.js';
import { calcStockLedgerPPP, type StockMovementInput } from '../calculations/raw-material.js';
import { ValidationError } from '../errors/domain-error.js';

/**
 * ARRASTRE DE EXISTENCIA (problema C — Fase 3).
 *
 * La regla contable que hoy el sistema no aplicaba:
 *
 *   🔑 La existencia FINAL de un período es la existencia INICIAL del siguiente,
 *      valuada al PPP con el que cerró.
 *
 * Antes se copiaba a mano; si se copiaba mal, el error se arrastraba todo el
 * año. Acá se deriva: se corre la ficha de stock del mes que cierra (misma
 * función que usa el motor, `calcStockLedgerPPP`) y el saldo final que queda es
 * lo que hereda el mes que abre.
 *
 * El PPP NO se redondea a dos decimales: un centavo por unidad, arrastrado mes
 * a mes sobre miles de unidades, deja de ser un centavo.
 */

/** Con cuánto y a qué precio cerró una materia prima. */
export interface MaterialClosingBalance {
  /** Nombre con el que se muestra (o el código, o "Materia prima N"). */
  name: string;
  /** Unidad de medida, si la ficha la tiene. */
  unit: string | null;
  /** Existencia final, en unidades. */
  quantity: number;
  /** PPP con el que cerró el período. */
  unitCost: number;
  /** Valor de la existencia final. */
  value: number;
}

interface MaterialLike {
  name?: string;
  code?: string;
  unit?: string;
  initialStock?: { quantity?: number; unitCost?: number };
  movements?: StockMovementInput[];
}

/**
 * Las materias primas de una config, tolerando la forma LEGADA (una sola MP como
 * objeto plano con `wilson`) además de la actual (`{ materials: [...] }`).
 * No valida con Zod a propósito: acá solo se lee lo necesario para el saldo, y
 * una config vieja incompleta no debe impedir abrir el mes siguiente.
 */
export function materialsOf(rawMaterialConfig: unknown): MaterialLike[] {
  if (!rawMaterialConfig || typeof rawMaterialConfig !== 'object') return [];
  const cfg = rawMaterialConfig as Record<string, unknown>;
  if (Array.isArray(cfg.materials)) return cfg.materials as MaterialLike[];
  if ('wilson' in cfg) return [cfg as MaterialLike]; // MP única legada
  return [];
}

/** Cómo llamar a una materia prima en un mensaje para el costista. */
function labelOf(m: MaterialLike, index: number): string {
  return m.name?.trim() || m.code?.trim() || `Materia prima ${index + 1}`;
}

/**
 * Existencia final de cada materia prima del período, valuada al PPP de cierre.
 *
 * Si la ficha de stock del mes no cuadra (un consumo mayor al saldo), NO se
 * inventa un saldo: se corta con un error que nombra la materia prima. Arrastrar
 * una existencia que no se pudo valuar sería ensuciar todos los meses que vengan.
 */
export function closingStockOf(rawMaterialConfig: unknown): MaterialClosingBalance[] {
  return materialsOf(rawMaterialConfig).map((m, i) => {
    const name = labelOf(m, i);

    let ledger;
    try {
      ledger = calcStockLedgerPPP(
        m.initialStock?.quantity ?? 0,
        m.initialStock?.unitCost ?? 0,
        m.movements ?? [],
      );
    } catch (e) {
      throw new ValidationError(
        `No se puede arrastrar la existencia de "${name}": la ficha de stock del período que cierra no cuadra ` +
          `(${(e as Error).message}). Corregila antes de abrir el período siguiente.`,
      );
    }

    const qty = ledger.finalBalanceQty;
    const value = ledger.finalBalanceValue;
    // Sin unidades no hay precio: el PPP de un saldo vacío es cero, no el último.
    const unitCost = qty.isZero()
      ? new Decimal(0)
      : value.toDecimal().dividedBy(qty);

    return {
      name,
      unit: m.unit?.trim() || null,
      quantity: qty.toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN).toNumber(),
      unitCost: unitCost.toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN).toNumber(),
      value: value.toNumber(),
    };
  });
}
