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
});
