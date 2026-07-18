import { describe, it, expect } from 'vitest';
import { runLayer2 } from '@/infrastructure/classifier/layers/layer2-corroborating-signals.js';

describe('runLayer2', () => {
  it('accumulates points for factura signals', () => {
    const text = `
      PUNTO DE VENTA 0001
      CUIT: 30-71234567-9
      CONDICIÓN FRENTE AL IVA: Responsable Inscripto
      INICIO DE ACTIVIDADES: 01/01/2015
      INGRESOS BRUTOS: 12345
    `;
    const result = runLayer2(text);
    expect(result.winningType).toBe('FACTURA_COMPRA');
    expect(result.totalPts).toBeGreaterThanOrEqual(43);
  });

  it('accumulates points for liquidación signals', () => {
    const text = `
      OBRA SOCIAL: OSDE
      ANSES: Sí
      CUIL 20-12345678-9
      SUELDO BÁSICO: $450.000
    `;
    const result = runLayer2(text);
    expect(result.winningType).toBe('LIQUIDACION_MOD');
    expect(result.totalPts).toBeGreaterThanOrEqual(65);
  });

  it('finds REMITO_KEYWORD signal in remito text', () => {
    const text = 'REMITO de entrega';
    const result = runLayer2(text);
    expect(result.signals.find((s) => s.label === 'REMITO_KEYWORD')).toBeDefined();
  });

  it('returns empty signals for text with no recognizable patterns', () => {
    const result = runLayer2('texto libre sin nada');
    expect(result.signals).toHaveLength(0);
    expect(result.totalPts).toBe(0);
  });
});

describe('runLayer2 — targeted contradiction penalties', () => {
  const CAE = 'CAE N° 61234567890123'; // 14 dígitos válidos

  it('(a) REMITO+CAE lowers only REMITO, leaving FACTURA_COMPRA untouched', () => {
    const text = `
      REMITO de entrega
      PUNTO DE VENTA 0001
      CUIT 30-71234567-9
      ${CAE}
    `;
    const r = runLayer2(text);
    // FACTURA_COMPRA = PTO_VENTA_HEADER(15) + CUIT_FORMAT(12) = 27, SIN tocar.
    expect(r.scoreByType.FACTURA_COMPRA).toBe(27);
    // REMITO = REMITO_KEYWORD(25) − 30 = −5 (antes del fix quedaba en 25).
    expect(r.scoreByType.REMITO).toBe(-5);
    // El ganador legítimo es la factura de compra, no cae a revisión.
    expect(r.winningType).toBe('FACTURA_COMPRA');
    expect(r.signals.some((s) => s.label === 'CONTRADICTION:REMITO_KEYWORD+CAE_FOUND')).toBe(true);
  });

  it('(b) fires via Layer 2 own CAE detection even when Layer 1 winner was not CAE_FOUND', () => {
    const text = `REMITO ${CAE}`;
    // Layer 1 eligió FACTURA_VENTA_CTX como ganador; CAE_FOUND NO llega como label.
    const r = runLayer2(text, ['FACTURA_VENTA_CTX']);
    // La contradicción igual dispara porque Layer 2 detecta el CAE por su cuenta.
    expect(r.signals.some((s) => s.label === 'CONTRADICTION:REMITO_KEYWORD+CAE_FOUND')).toBe(true);
    expect(r.scoreByType.REMITO).toBe(-5); // 25 − 30
  });

  it('(c1) ANSES+PTO_VENTA_HEADER lowers only LIQUIDACION_MOD', () => {
    const text = 'ANSES OBRA SOCIAL PUNTO DE VENTA 0001';
    const r = runLayer2(text);
    // FACTURA_COMPRA = PTO_VENTA_HEADER(15), intacto.
    expect(r.scoreByType.FACTURA_COMPRA).toBe(15);
    // LIQUIDACION_MOD = ANSES(20) + OBRA_SOCIAL(18) = 38 − 25 = 13.
    expect(r.scoreByType.LIQUIDACION_MOD).toBe(13);
    expect(r.signals.some((s) => s.label === 'CONTRADICTION:ANSES+PTO_VENTA_HEADER')).toBe(true);
  });

  it('(c2) CUIL+CAE lowers only LIQUIDACION_MOD, leaving FACTURA_COMPRA untouched', () => {
    const text = `CUIL 20-12345678-9 CUIT 30-71234567-9 ${CAE}`;
    const r = runLayer2(text);
    // FACTURA_COMPRA = CUIT_FORMAT(12), intacto.
    expect(r.scoreByType.FACTURA_COMPRA).toBe(12);
    // LIQUIDACION_MOD = CUIL_KEYWORD(15) − 15 = 0.
    expect(r.scoreByType.LIQUIDACION_MOD).toBe(0);
    expect(r.winningType).toBe('FACTURA_COMPRA');
    expect(r.signals.some((s) => s.label === 'CONTRADICTION:CUIL_KEYWORD+CAE_FOUND')).toBe(true);
  });

  it('does not add CAE_FOUND (nor fire contradictions) when no valid CAE is present', () => {
    const text = 'REMITO de entrega FECHA DE ENTREGA 10/10';
    const r = runLayer2(text);
    expect(r.signals.some((s) => s.label.startsWith('CONTRADICTION:'))).toBe(false);
    // REMITO_KEYWORD(25) + FECHA_ENTREGA(18) = 43, sin penalización.
    expect(r.scoreByType.REMITO).toBe(43);
  });
});
