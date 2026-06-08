import { describe, it, expect } from 'vitest';
import { Money } from '@/domain/value-objects/money.js';
import { Percentage } from '@/domain/value-objects/percentage.js';

describe('Money', () => {
  it('suma sin error de floating point (0.1 + 0.2 = 0.3)', () => {
    const result = Money.of('0.1').add(Money.of('0.2'));
    expect(result.toFixed(2)).toBe('0.30');
  });

  it('resta correctamente', () => {
    expect(Money.of(1000).subtract(Money.of(250)).toNumber()).toBe(750);
  });

  it('multiplica por un factor', () => {
    expect(Money.of(800).multiply(500).toNumber()).toBe(400000);
  });

  it('divide y mantiene precisión (PPP)', () => {
    // 665.000 / 800 unidades = 831.25 (caso real de la ficha de stock)
    expect(Money.of(665000).divide(800).toFixed(2)).toBe('831.25');
  });

  it('aplica una tasa', () => {
    expect(Money.of(100000).applyRate(0.3).toNumber()).toBe(30000);
  });

  it('lanza error al dividir por cero', () => {
    expect(() => Money.of(100).divide(0)).toThrow(/cero/);
  });

  it('suma una lista de montos', () => {
    const total = Money.sum([Money.of(100), Money.of(200), Money.of(300)]);
    expect(total.toNumber()).toBe(600);
  });

  it('compara montos', () => {
    expect(Money.of(500).greaterThan(Money.of(300))).toBe(true);
    expect(Money.of(100).lessThan(Money.of(300))).toBe(true);
  });

  it('usa redondeo bancario a 2 decimales', () => {
    expect(Money.of('2.345').toFixed(2)).toBe('2.34'); // half-even baja
    expect(Money.of('2.355').toFixed(2)).toBe('2.36'); // half-even sube
  });
});

describe('Percentage', () => {
  it('convierte desde notación humana', () => {
    expect(Percentage.fromPercent(30).toFraction().toNumber()).toBe(0.3);
  });

  it('da el factor multiplicador para agregar cargas', () => {
    // 80% de cargas sociales → multiplicar sueldo por 1.80
    expect(Percentage.fromPercent(80).asMultiplier().toNumber()).toBe(1.8);
  });

  it('suma componentes (ITCS)', () => {
    const itcs = Percentage.sum([
      Percentage.fromPercent(17), // aportes
      Percentage.fromPercent(8), // ART
      Percentage.fromPercent(33), // aguinaldo + vacaciones prorrateadas
    ]);
    expect(itcs.toPercent()).toBe(58);
  });

  it('aplica un porcentaje a un monto', () => {
    const itcs = Percentage.fromPercent(58);
    const sueldo = Money.of(500000);
    expect(sueldo.applyRate(itcs.toFraction()).toNumber()).toBe(290000);
  });
});
