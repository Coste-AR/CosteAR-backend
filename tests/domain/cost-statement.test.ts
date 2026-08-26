import { describe, it, expect } from 'vitest';
import { Money } from '@/domain/value-objects/money.js';
import {
  calcCostStatement,
  checkRawMaterialConsistency,
  calcGrossMargin,
} from '@/domain/calculations/cost-statement.js';

describe('Hoja 4 — Estado de Costos', () => {
  it('consolida MP + MOD + CIP hasta el CPV', () => {
    const r = calcCostStatement({
      initialRawMaterial: Money.of(240000),
      rawMaterialPurchases: Money.of(965000), // 425000 + 540000
      finalRawMaterial: Money.of(261750),
      directLabor: Money.of(500000),
      indirectCostsApplied: Money.of(300000),
      initialWorkInProcess: Money.of(0),
      finalWorkInProcess: Money.of(0),
      initialFinishedGoods: Money.of(0),
      finalFinishedGoods: Money.of(0),
    });

    // MP consumida = 240000 + 965000 − 261750 = 943250 (coincide con la ficha PPP)
    expect(r.rawMaterialConsumed.toNumber()).toBe(943250);
    // Producción = 943250 + 500000 + 300000 = 1743250
    expect(r.productionCost.toNumber()).toBe(1743250);
    // Sin inventarios de proceso ni terminados, CPV = producción
    expect(r.costOfGoodsSold.toNumber()).toBe(1743250);
  });

  it('descuenta inventarios de proceso y de terminados', () => {
    const r = calcCostStatement({
      initialRawMaterial: Money.of(100000),
      rawMaterialPurchases: Money.of(400000),
      finalRawMaterial: Money.of(50000),
      directLabor: Money.of(200000),
      indirectCostsApplied: Money.of(150000),
      initialWorkInProcess: Money.of(30000),
      finalWorkInProcess: Money.of(20000),
      initialFinishedGoods: Money.of(40000),
      finalFinishedGoods: Money.of(60000),
    });

    // MP consumida = 100000+400000−50000 = 450000
    // Producción = 450000+200000+150000 = 800000
    expect(r.productionCost.toNumber()).toBe(800000);
    // Terminados = 800000 + 30000 − 20000 = 810000
    expect(r.finishedGoodsCost.toNumber()).toBe(810000);
    // CPV = 810000 + 40000 − 60000 = 790000
    expect(r.costOfGoodsSold.toNumber()).toBe(790000);
  });

  it('valida consistencia de MP contra la ficha de stock', () => {
    const ok = checkRawMaterialConsistency(Money.of(943250), Money.of(943250));
    expect(ok.matches).toBe(true);
    expect(ok.difference.toNumber()).toBe(0);

    const bad = checkRawMaterialConsistency(Money.of(943250), Money.of(900000));
    expect(bad.matches).toBe(false);
    expect(bad.difference.toNumber()).toBe(43250);
  });

  it('#116 — la amortización de activos suma al costo real, separada de los CIP', () => {
    const r = calcCostStatement({
      initialRawMaterial: Money.of(0),
      rawMaterialPurchases: Money.of(0),
      finalRawMaterial: Money.of(0),
      directLabor: Money.of(0),
      indirectCostsApplied: Money.of(100000),
      assetDepreciation: Money.of(200000),
      initialWorkInProcess: Money.of(0),
      finalWorkInProcess: Money.of(0),
      initialFinishedGoods: Money.of(0),
      finalFinishedGoods: Money.of(0),
    });

    // No entra al costo NORMAL (que sigue siendo solo MP+MOD+CIP)...
    expect(r.productionCost.toNumber()).toBe(100000);
    expect(r.assetDepreciation.toNumber()).toBe(200000);
    // ...pero sí al REAL, igual que trabajos de terceros.
    expect(r.realProductionCost.toNumber()).toBe(300000);
  });

  it('sin activos amortizables, `assetDepreciation` da cero y el costo no cambia (DOM-05)', () => {
    const r = calcCostStatement({
      initialRawMaterial: Money.of(0),
      rawMaterialPurchases: Money.of(0),
      finalRawMaterial: Money.of(0),
      directLabor: Money.of(0),
      indirectCostsApplied: Money.of(100000),
      initialWorkInProcess: Money.of(0),
      finalWorkInProcess: Money.of(0),
      initialFinishedGoods: Money.of(0),
      finalFinishedGoods: Money.of(0),
    });

    expect(r.assetDepreciation.toNumber()).toBe(0);
    expect(r.realProductionCost.toNumber()).toBe(100000);
  });
});

describe('Margen bruto (motor de alertas)', () => {
  it('calcula margen absoluto y porcentual', () => {
    const m = calcGrossMargin(Money.of(2500000), Money.of(1743250));
    expect(m.grossMargin.toNumber()).toBe(756750);
    // 756750 / 2500000 = 30.27%
    expect(m.grossMarginPct.toPercent()).toBeCloseTo(30.27, 1);
  });

  it('detecta margen negativo (venta a pérdida)', () => {
    const m = calcGrossMargin(Money.of(1000000), Money.of(1200000));
    expect(m.grossMargin.isNegative()).toBe(true);
    expect(m.grossMarginPct.toPercent()).toBeCloseTo(-20, 1);
  });

  it('maneja ventas en cero sin dividir por cero', () => {
    const m = calcGrossMargin(Money.zero(), Money.of(500));
    expect(m.grossMarginPct.toPercent()).toBe(0);
  });
});
