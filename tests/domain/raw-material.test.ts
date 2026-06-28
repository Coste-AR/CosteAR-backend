import { describe, it, expect } from 'vitest';
import {
  calcOptimalLot,
  calcStockPolicies,
  calcStockLedgerPPP,
  type StockMovementInput,
} from '@/domain/calculations/raw-material.js';

/**
 * Ground truth: valores exactos de la hoja "1-MP Ejemplo" del Excel v3.0.
 * Si estos tests pasan, el motor replica la metodología de la cátedra.
 */
describe('Hoja 1 — Materia Prima', () => {
  const wilson = {
    annualDemand: 24000,
    orderCost: 3500,
    holdingRate: 0.3,
    unitCost: 800,
  };

  describe('Lote Óptimo de Wilson', () => {
    it('LE = √(2·R·S / K·C) ≈ 836.66', () => {
      const le = calcOptimalLot(wilson);
      expect(le.toDecimalPlaces(2).toNumber()).toBe(836.66);
    });

    it('retorna 0 si K·C es cero', () => {
      const le = calcOptimalLot({ ...wilson, unitCost: 0 });
      expect(le.toNumber()).toBe(0);
    });
  });

  describe('Políticas de stock', () => {
    const policy = {
      minConsumption: 40,
      maxConsumption: 90,
      minLeadTime: 8,
      maxLeadTime: 12,
      safetyStock: 200,
    };

    it('reproduce los 5 resultados del Excel', () => {
      const le = calcOptimalLot(wilson);
      const r = calcStockPolicies(policy, le);

      expect(r.avgConsumption.toNumber()).toBe(65); // CP = (90+40)/2
      expect(r.minStock.toNumber()).toBe(1280); // sm = 90·12 + 200
      expect(r.reorderPoint.toNumber()).toBe(2160); // P.Ped = 1080 − 200 + 1280
      expect(r.maxStock.toDecimalPlaces(0).toNumber()).toBe(2437); // SM ≈ 2437
    });
  });

  describe('Ficha de Stock PPP', () => {
    const movements: StockMovementInput[] = [
      { date: '02/05', type: 'purchase', detail: 'Factura A-101', quantity: 500, unitCost: 850 },
      { date: '08/05', type: 'consumption', detail: 'Orden Prod. 01', quantity: 400 },
      { date: '15/05', type: 'purchase', detail: 'Factura A-118', quantity: 600, unitCost: 900 },
      { date: '24/05', type: 'consumption', detail: 'Orden Prod. 02', quantity: 700 },
    ];

    it('recalcula el PPP tras cada compra', () => {
      const r = calcStockLedgerPPP(300, 800, movements);

      // Tras compra 1: (240000 + 425000) / 800 = 831.25
      expect(r.rows[0]!.balanceUnitCost.toFixed(2)).toBe('831.25');
      // Tras compra 2: (332500 + 540000) / 1000 = 872.50
      expect(r.rows[2]!.balanceUnitCost.toFixed(2)).toBe('872.50');
    });

    it('valúa los consumos al PPP vigente', () => {
      const r = calcStockLedgerPPP(300, 800, movements);
      expect(r.rows[1]!.movementTotal.toNumber()).toBe(332500); // 400 @ 831.25
      expect(r.rows[3]!.movementTotal.toNumber()).toBe(610750); // 700 @ 872.50
    });

    it('Materia Prima Consumida = 943.250 (Σ salidas)', () => {
      const r = calcStockLedgerPPP(300, 800, movements);
      expect(r.rawMaterialConsumed.toNumber()).toBe(943250);
    });

    it('deja saldo final de 300 unidades valuado en 261.750', () => {
      const r = calcStockLedgerPPP(300, 800, movements);
      expect(r.finalBalanceQty.toNumber()).toBe(300);
      expect(r.finalBalanceValue.toNumber()).toBe(261750);
    });

    it('rechaza un consumo que supere el saldo', () => {
      expect(() =>
        calcStockLedgerPPP(100, 800, [
          { date: '01/01', type: 'consumption', detail: 'X', quantity: 500 },
        ]),
      ).toThrow(/supera el saldo/);
    });

    it('rechaza una compra sin costo unitario', () => {
      expect(() =>
        calcStockLedgerPPP(0, 0, [
          { date: '01/01', type: 'purchase', detail: 'X', quantity: 10 },
        ]),
      ).toThrow(/sin costo unitario/);
    });
  });
});
