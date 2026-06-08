import Decimal from 'decimal.js';

// Configuración global de decimal.js: 28 dígitos de precisión, redondeo
// bancario (ROUND_HALF_EVEN) para minimizar sesgo acumulado en cálculos.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export type Currency = 'ARS';

/**
 * Money — value object inmutable para montos monetarios.
 *
 * Toda la aritmética financiera del motor de costos pasa por aquí.
 * Internamente usa decimal.js: NUNCA `number` nativo, porque 0.1 + 0.2
 * en floating point da 0.30000000000000004 y eso es inaceptable en un
 * software que decide precios reales.
 */
export class Money {
  private readonly amount: Decimal;
  readonly currency: Currency;

  private constructor(amount: Decimal, currency: Currency) {
    this.amount = amount;
    this.currency = currency;
  }

  static of(value: Decimal.Value, currency: Currency = 'ARS'): Money {
    return new Money(new Decimal(value), currency);
  }

  static zero(currency: Currency = 'ARS'): Money {
    return new Money(new Decimal(0), currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `No se pueden operar montos de distinta moneda: ${this.currency} vs ${other.currency}`,
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  multiply(factor: Decimal.Value): Money {
    return new Money(this.amount.times(factor), this.currency);
  }

  divide(divisor: Decimal.Value): Money {
    const d = new Decimal(divisor);
    if (d.isZero()) {
      throw new Error('División por cero en cálculo monetario');
    }
    return new Money(this.amount.dividedBy(d), this.currency);
  }

  /** Aplica un porcentaje: money.applyRate(0.30) = 30% del monto. */
  applyRate(rate: Decimal.Value): Money {
    return new Money(this.amount.times(rate), this.currency);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.greaterThan(other.amount);
  }

  lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.lessThan(other.amount);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }

  /** Valor Decimal crudo, sin redondear. Para encadenar cálculos internos. */
  toDecimal(): Decimal {
    return this.amount;
  }

  /** Número redondeado a 2 decimales. Para serializar a la API/DB. */
  toNumber(): number {
    return this.amount.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toNumber();
  }

  /** String con 2 decimales fijos. Para persistencia exacta. */
  toFixed(decimals = 2): string {
    return this.amount.toFixed(decimals, Decimal.ROUND_HALF_EVEN);
  }

  static sum(items: Money[], currency: Currency = 'ARS'): Money {
    return items.reduce((acc, m) => acc.add(m), Money.zero(currency));
  }
}
