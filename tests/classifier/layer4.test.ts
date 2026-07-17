import { describe, it, expect } from 'vitest';
import { runLayer4 } from '@/infrastructure/classifier/layers/layer4-business-routing.js';

describe('runLayer4', () => {
  it('routes LIQUIDACION_MOD to MANO_DE_OBRA at 99', () => {
    const result = runLayer4('LIQUIDACION_MOD', '');
    expect(result.costSection).toBe('MANO_DE_OBRA');
    expect(result.confidence).toBe(99);
    expect(result.requiresAI).toBe(false);
  });

  it('routes PLANILLA_HORAS to MANO_DE_OBRA at 99', () => {
    const result = runLayer4('PLANILLA_HORAS', '');
    expect(result.costSection).toBe('MANO_DE_OBRA');
    expect(result.confidence).toBe(99);
  });

  it('routes NOTA_DEBITO to COSTOS_INDIRECTOS at 85', () => {
    const result = runLayer4('NOTA_DEBITO', '');
    expect(result.costSection).toBe('COSTOS_INDIRECTOS');
  });

  it('routes FACTURA_COMPRA with MP keywords to MATERIA_PRIMA', () => {
    const result = runLayer4('FACTURA_COMPRA', 'Insumo bobina de acero kg materia prima');
    expect(result.costSection).toBe('MATERIA_PRIMA');
    expect(result.requiresAI).toBe(false);
  });

  it('routes FACTURA_COMPRA with CIP keywords to COSTOS_INDIRECTOS', () => {
    const result = runLayer4('FACTURA_COMPRA', 'Alquiler mensual del galpón - Servicio de electricidad');
    expect(result.costSection).toBe('COSTOS_INDIRECTOS');
    expect(result.requiresAI).toBe(false);
  });

  it('marks FACTURA_COMPRA without keywords as requiresAI', () => {
    const result = runLayer4('FACTURA_COMPRA', 'Proveedor desconocido sin descripción clara');
    expect(result.requiresAI).toBe(true);
  });

  it('routes FACTURA_VENTA to VENTAS at 99', () => {
    const result = runLayer4('FACTURA_VENTA', '');
    expect(result.costSection).toBe('VENTAS');
    expect(result.confidence).toBe(99);
  });

  it('routes DESCONOCIDO to DESCONOCIDO and requiresAI', () => {
    const result = runLayer4('DESCONOCIDO', '');
    expect(result.costSection).toBe('DESCONOCIDO');
    expect(result.requiresAI).toBe(true);
  });

  // ── Gastos (no-costo) transversales ────────────────────────────────────────
  describe('gasto routing', () => {
    it('routes a strong comercialización match to GASTO_COMERCIALIZACION (no AI)', () => {
      const result = runLayer4(
        'FACTURA_COMPRA',
        'Factura por publicidad y campaña publicitaria en redes sociales',
      );
      expect(result.costSection).toBe('GASTO_COMERCIALIZACION');
      expect(result.requiresAI).toBe(false);
    });

    it('routes a strong administración match to GASTO_ADMINISTRACION (no AI)', () => {
      const result = runLayer4(
        'FACTURA_COMPRA',
        'Honorarios contador y papelería oficina del mes',
      );
      expect(result.costSection).toBe('GASTO_ADMINISTRACION');
      expect(result.requiresAI).toBe(false);
    });

    it('routes a strong financiero match to GASTO_FINANCIERO (no AI)', () => {
      const result = runLayer4(
        'FACTURA_COMPRA',
        'Resumen: gastos bancarios y comisión bancaria del período',
      );
      expect(result.costSection).toBe('GASTO_FINANCIERO');
      expect(result.requiresAI).toBe(false);
    });

    it('escalates to AI when MP and gasto signals are tied (ambiguous)', () => {
      // TEXTIL: 1 MP (tela) vs 1 gasto (campaña publicitaria) → ambiguo costo/gasto
      const result = runLayer4('FACTURA_COMPRA', 'compra de tela y campaña publicitaria', 'TEXTIL');
      expect(result.requiresAI).toBe(true);
      expect(result.costSection).toBe('DESCONOCIDO');
    });

    it('does not misfire on a pure CIP invoice (no gasto keywords)', () => {
      const result = runLayer4('FACTURA_COMPRA', 'Alquiler mensual del galpón - Servicio de electricidad');
      expect(result.costSection).toBe('COSTOS_INDIRECTOS');
      expect(result.requiresAI).toBe(false);
    });
  });
});
