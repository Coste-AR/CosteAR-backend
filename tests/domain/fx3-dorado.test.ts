import { describe, it, expect } from 'vitest';
import { Money } from '@/domain/value-objects/money.js';
import { calcStockLedgerPPP } from '@/domain/calculations/raw-material.js';
import {
  primaryProration,
  secondaryProration,
  calcPredeterminedQuota,
  calcVarianceAnalysis,
  type CostCenter,
} from '@/domain/calculations/indirect-costs.js';

/**
 * FX3 — Caso "Dorado Muebles" (costeo por órdenes).
 *
 * Fixture verificado a mano en la spec. Ejercita el prorrateo secundario
 * DIRECTO (un único centro de servicio → dos productivos), que el motor
 * actual ya resuelve. Se agrega en F0 como test de caracterización del
 * estado actual: prueba que la matemática de MP + CIP del caso Dorado ya
 * está bien ANTES de tocar nada (R5, regresión cero).
 *
 * No se testean Wilson ni el Costo de producción total porque la spec no
 * trae los insumos completos de MOD para este caso; sí PPP, consumo, stock
 * final y todo el bloque de Costos Indirectos.
 */
describe('FX3 — Dorado Muebles', () => {
  describe('Materia Prima — PPP', () => {
    // EI 100u × 1.000 + compra 400u × 1.200; consumo 300u.
    const ledger = calcStockLedgerPPP(100, 1000, [
      { date: '01', type: 'purchase', detail: 'Compra', quantity: 400, unitCost: 1200 },
      { date: '02', type: 'consumption', detail: 'Consumo', quantity: 300 },
    ]);

    it('PPP = (100×1.000 + 400×1.200) / 500 = 1.160', () => {
      expect(ledger.rows[0]!.balanceUnitCost.toNumber()).toBe(1160);
    });

    it('MP consumida = 300 × 1.160 = 348.000', () => {
      expect(ledger.rawMaterialConsumed.toNumber()).toBe(348000);
    });

    it('Stock final = 200 × 1.160 = 232.000', () => {
      expect(ledger.finalBalanceValue.toNumber()).toBe(232000);
    });
  });

  describe('Costos Indirectos — prorrateo, cuotas, aplicado y variaciones', () => {
    const centers: CostCenter[] = [
      { id: 'corte', name: 'Corte', type: 'productive' },
      { id: 'ensamblaje', name: 'Ensamblaje', type: 'productive' },
      { id: 'mantenimiento', name: 'Mantenimiento', type: 'service' },
    ];

    // Primario ya repartido (600.000 total) — se ingresa como un único concepto
    // con la distribución fija/variable resuelta por centro.
    const primary = {
      corte: { fixed: Money.of(120000), variable: Money.of(100000) },
      ensamblaje: { fixed: Money.of(120000), variable: Money.of(60000) },
      mantenimiento: { fixed: Money.of(60000), variable: Money.of(140000) },
    };

    // Secundario: Mantenimiento reparte 60/40 a Corte/Ensamblaje.
    const productiveCip = secondaryProration(centers, primary, [
      {
        serviceCenterId: 'mantenimiento',
        toProductive: { corte: 60, ensamblaje: 40 },
      },
    ]);

    it('presupuesto Corte = 156.000f / 184.000v (340.000)', () => {
      expect(productiveCip.corte!.fixed.toNumber()).toBe(156000);
      expect(productiveCip.corte!.variable.toNumber()).toBe(184000);
    });

    it('presupuesto Ensamblaje = 144.000f / 116.000v (260.000)', () => {
      expect(productiveCip.ensamblaje!.fixed.toNumber()).toBe(144000);
      expect(productiveCip.ensamblaje!.variable.toNumber()).toBe(116000);
    });

    const corteQuota = calcPredeterminedQuota(productiveCip.corte!, 160);
    const ensQuota = calcPredeterminedQuota(productiveCip.ensamblaje!, 160);

    it('cuota Corte = 2.125 (975f + 1.150v)', () => {
      expect(corteQuota.fixedQuota.toNumber()).toBe(975);
      expect(corteQuota.variableQuota.toNumber()).toBe(1150);
      expect(corteQuota.totalQuota.toNumber()).toBe(2125);
    });

    it('cuota Ensamblaje = 1.625 (900f + 725v)', () => {
      expect(ensQuota.fixedQuota.toNumber()).toBe(900);
      expect(ensQuota.variableQuota.toNumber()).toBe(725);
      expect(ensQuota.totalQuota.toNumber()).toBe(1625);
    });

    // Corte: actividad real 150 (< 160 → hay variación volumen), CIP real 350.000.
    const corteVar = calcVarianceAnalysis(corteQuota, productiveCip.corte!, 160, 150, Money.of(350000));
    // Ensamblaje: actividad real = capacidad normal 160 → aplicado = presupuesto.
    const ensVar = calcVarianceAnalysis(ensQuota, productiveCip.ensamblaje!, 160, 160, Money.of(260000));

    it('CIP aplicado = 318.750 (Corte) + 260.000 (Ensamblaje) = 578.750', () => {
      expect(corteVar.cipApplied.toNumber()).toBe(318750);
      expect(ensVar.cipApplied.toNumber()).toBe(260000);
      expect(corteVar.cipApplied.add(ensVar.cipApplied).toNumber()).toBe(578750);
    });

    it('Var. presupuesto Corte = 21.500 (350.000 − (156.000 + 1.150×150))', () => {
      expect(corteVar.budgetVariance.toNumber()).toBe(21500);
    });

    it('Var. volumen Corte = 9.750 (975 × (160 − 150))', () => {
      expect(corteVar.volumeVariance.toNumber()).toBe(9750);
    });
  });
});
