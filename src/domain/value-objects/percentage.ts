import Decimal from 'decimal.js';

/**
 * Percentage — value object inmutable para porcentajes (tasas, márgenes, ITCS).
 *
 * Se almacena como fracción decimal: 30% → 0.30 internamente.
 * Evita la ambigüedad de "¿es 30 o 0.30?" que causa errores caros.
 */
export class Percentage {
  private readonly fraction: Decimal;

  private constructor(fraction: Decimal) {
    this.fraction = fraction;
  }

  /** Crea desde la notación humana: fromPercent(30) = 30%. */
  static fromPercent(percent: Decimal.Value): Percentage {
    return new Percentage(new Decimal(percent).dividedBy(100));
  }

  /** Crea desde una fracción: fromFraction(0.3) = 30%. */
  static fromFraction(fraction: Decimal.Value): Percentage {
    return new Percentage(new Decimal(fraction));
  }

  static zero(): Percentage {
    return new Percentage(new Decimal(0));
  }

  /** Suma porcentajes (ej. componentes del ITCS). */
  add(other: Percentage): Percentage {
    return new Percentage(this.fraction.plus(other.fraction));
  }

  /** Fracción decimal: 30% → 0.30. Para multiplicar montos. */
  toFraction(): Decimal {
    return this.fraction;
  }

  /** Notación humana: 0.30 → 30. */
  toPercent(): number {
    return this.fraction.times(100).toDecimalPlaces(4).toNumber();
  }

  /** Factor multiplicador: 30% → 1.30. Útil para "agregar cargas". */
  asMultiplier(): Decimal {
    return this.fraction.plus(1);
  }

  static sum(items: Percentage[]): Percentage {
    return items.reduce((acc, p) => acc.add(p), Percentage.zero());
  }
}
