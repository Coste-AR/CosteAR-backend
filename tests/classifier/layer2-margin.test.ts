import { describe, it, expect } from 'vitest';
import { runLayer2, AMBIGUITY_MARGIN } from '../../src/infrastructure/classifier/layers/layer2-corroborating-signals.js';

describe('runLayer2 — margin & ambiguity', () => {
  it('reports a clear winner with a wide margin as non-ambiguous', () => {
    // Texto con señales fuertes de LIQUIDACION_MOD y nada de factura
    const text = 'ANSES OBRA SOCIAL JUBILACION CUIL 20-12345678-9';
    const r = runLayer2(text);
    expect(r.winningType).toBe('LIQUIDACION_MOD');
    expect(r.margin).toBeGreaterThanOrEqual(AMBIGUITY_MARGIN);
    expect(r.ambiguous).toBe(false);
  });

  it('flags ambiguity when top two types score within the margin', () => {
    // Mezcla: señales de factura de compra Y de liquidación, parejas
    // CUIT_FORMAT(12) para FACTURA_COMPRA vs CUIL_KEYWORD(15) para LIQUIDACION_MOD
    const text = 'CUIT 20-12345678-9 ... CUIL del empleado';
    const r = runLayer2(text);
    expect(r.runnerUpType).not.toBeNull();
    expect(r.margin).toBeLessThan(AMBIGUITY_MARGIN);
    expect(r.ambiguous).toBe(true);
  });

  it('is not ambiguous when only one type has signals', () => {
    const text = 'PUNTO DE VENTA 0001 CONDICION FRENTE AL IVA';
    const r = runLayer2(text);
    expect(r.winningType).toBe('FACTURA_COMPRA');
    expect(r.runnerUpType).toBeNull();
    expect(r.ambiguous).toBe(false);
  });

  it('returns empty result with no signals', () => {
    const r = runLayer2('texto cualquiera sin señales contables');
    expect(r.winningType).toBeNull();
    expect(r.ambiguous).toBe(false);
    expect(r.margin).toBe(0);
  });
});
