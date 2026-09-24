import { Decimal } from 'decimal.js';
import {
  calcStockLedgerPPP,
  type StockLedgerResult,
  type StockMovementInput,
} from './raw-material.js';
import type { RawMaterialSection } from '../../shared/schemas/cost.schema.js';

export interface CurrencyMetadata {
  kind: 'NOMINAL' | 'HOMOGENEA';
  periodCode: string | null;
  index: number | null;
  seriesVersionId: string | null;
  missingPeriodCodes: string[];
}

export interface HomogeneousStockMovement extends StockMovementInput {
  /** Período económico del precio; no se infiere de un texto ni del rubro. */
  periodCode: string;
}

export interface HomogeneousStockInput {
  initialStock: {
    quantity: Decimal.Value;
    unitCost: Decimal.Value;
    periodCode: string;
  };
  movements: HomogeneousStockMovement[];
  indices: Readonly<Record<string, Decimal.Value>>;
  destinationPeriodCode: string;
  seriesVersionId: string;
}

/** R34: lleva un valor del índice de origen al poder adquisitivo del destino. */
export function reexpresar(
  value: Decimal.Value,
  sourceIndex: Decimal.Value,
  destinationIndex: Decimal.Value,
): Decimal {
  const origin = new Decimal(sourceIndex);
  const destination = new Decimal(destinationIndex);
  if (!origin.isFinite() || origin.lte(0) || !destination.isFinite() || destination.lte(0)) {
    throw new RangeError('Los índices de precios tienen que ser positivos y finitos.');
  }
  return new Decimal(value).times(destination).dividedBy(origin);
}

/** R33: tasa real exacta de Fisher; restar inflación es una aproximación prohibida. */
export function tasaReal(nominalRate: Decimal.Value, inflationRate: Decimal.Value): Decimal {
  const denominator = new Decimal(1).plus(inflationRate);
  if (!denominator.isFinite() || denominator.lte(0)) {
    throw new RangeError('La tasa de inflación tiene que ser mayor que -100%.');
  }
  return new Decimal(1).plus(nominalRate).dividedBy(denominator).minus(1);
}

/**
 * R35: reexpresa cada existencia antes de delegar el promedio a la ficha PPP
 * auditada. Si falta un solo coeficiente no mezcla monedas: conserva toda la
 * valuación nominal histórica y declara exactamente qué períodos faltan.
 */
export function calcularPPPEnMonedaHomogenea(input: HomogeneousStockInput): {
  ledger: StockLedgerResult;
  currency: CurrencyMetadata;
} {
  const required = new Set<string>([input.destinationPeriodCode]);
  if (!new Decimal(input.initialStock.quantity).isZero()) required.add(input.initialStock.periodCode);
  for (const movement of input.movements) {
    if (movement.type === 'purchase') required.add(movement.periodCode);
  }

  const missingPeriodCodes = [...required]
    .filter((periodCode) => input.indices[periodCode] === undefined)
    .sort();

  if (missingPeriodCodes.length > 0) {
    return {
      ledger: calcStockLedgerPPP(input.initialStock.quantity, input.initialStock.unitCost, input.movements),
      currency: {
        kind: 'NOMINAL',
        periodCode: null,
        index: null,
        seriesVersionId: null,
        missingPeriodCodes,
      },
    };
  }

  const destinationIndex = input.indices[input.destinationPeriodCode]!;
  const initialUnitCost = new Decimal(input.initialStock.quantity).isZero()
    ? input.initialStock.unitCost
    : reexpresar(
        input.initialStock.unitCost,
        input.indices[input.initialStock.periodCode]!,
        destinationIndex,
      );
  const movements = input.movements.map((movement): StockMovementInput => ({
    ...movement,
    unitCost: movement.type === 'purchase'
      ? reexpresar(movement.unitCost!, input.indices[movement.periodCode]!, destinationIndex)
      : movement.unitCost,
  }));

  return {
    ledger: calcStockLedgerPPP(input.initialStock.quantity, initialUnitCost, movements),
    currency: {
      kind: 'HOMOGENEA',
      periodCode: input.destinationPeriodCode,
      index: new Decimal(destinationIndex).toNumber(),
      seriesVersionId: input.seriesVersionId,
      missingPeriodCodes: [],
    },
  };
}

/**
 * Capa anterior al motor auditado: transforma solamente los precios de compra.
 * Si una fecha económica no fue declarada, devuelve el input byte-equivalente
 * en valores para preservar el comportamiento histórico.
 */
export function prepararMateriaPrimaHomogenea(
  rawMaterial: RawMaterialSection,
  context: {
    destinationPeriodCode: string;
    seriesVersionId: string;
    indices: Readonly<Record<string, number>>;
  } | null,
): { rawMaterial: RawMaterialSection; currency: CurrencyMetadata } {
  if (!context) {
    return {
      rawMaterial,
      currency: { kind: 'NOMINAL', periodCode: null, index: null, seriesVersionId: null, missingPeriodCodes: [] },
    };
  }

  const missing = new Set<string>();
  if (context.indices[context.destinationPeriodCode] === undefined) missing.add(context.destinationPeriodCode);
  for (const material of rawMaterial.materials) {
    if (new Decimal(material.initialStock.quantity).gt(0)) {
      if (!material.initialStock.periodCode) missing.add('existencia-inicial-sin-periodo');
      else if (context.indices[material.initialStock.periodCode] === undefined) missing.add(material.initialStock.periodCode);
    }
    for (const movement of material.movements) {
      if (movement.type !== 'purchase') continue;
      if (!movement.periodCode) missing.add('compra-sin-periodo');
      else if (context.indices[movement.periodCode] === undefined) missing.add(movement.periodCode);
    }
  }

  if (missing.size > 0) {
    return {
      rawMaterial,
      currency: {
        kind: 'NOMINAL', periodCode: null, index: null, seriesVersionId: null,
        missingPeriodCodes: [...missing].sort(),
      },
    };
  }

  const destinationIndex = context.indices[context.destinationPeriodCode]!;
  return {
    rawMaterial: {
      materials: rawMaterial.materials.map((material) => ({
        ...material,
        initialStock: {
          ...material.initialStock,
          unitCost: new Decimal(material.initialStock.quantity).isZero()
            ? material.initialStock.unitCost
            : reexpresar(
                material.initialStock.unitCost,
                context.indices[material.initialStock.periodCode!]!,
                destinationIndex,
              ).toNumber(),
        },
        movements: material.movements.map((movement) => ({
          ...movement,
          unitCost: movement.type === 'purchase'
            ? reexpresar(movement.unitCost!, context.indices[movement.periodCode!]!, destinationIndex).toNumber()
            : movement.unitCost,
        })),
      })),
    },
    currency: {
      kind: 'HOMOGENEA', periodCode: context.destinationPeriodCode, index: destinationIndex,
      seriesVersionId: context.seriesVersionId, missingPeriodCodes: [],
    },
  };
}
