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
