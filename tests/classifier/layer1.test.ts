import { describe, it, expect } from 'vitest';
import { runLayer1 } from '@/infrastructure/classifier/layers/layer1-definitive-signals.js';

describe('runLayer1', () => {
  it('detects CAE and returns FACTURA_COMPRA at confidence 97', () => {
    const text = 'FACTURA A\nCAE Nº: 75123456789012\nFecha Vto: 15/06/2026';
    const result = runLayer1(text);
    expect(result).not.toBeNull();
    expect(result!.documentType).toBe('FACTURA_COMPRA');
    expect(result!.confidence).toBe(97);
    expect(result!.label).toBe('CAE_FOUND');
  });

  it('detects RECIBO DE SUELDO at confidence 98', () => {
    const text = 'RECIBO DE SUELDO\nEmpleado: Juan Pérez CUIL 20-12345678-9';
    const result = runLayer1(text);
    expect(result).not.toBeNull();
    expect(result!.documentType).toBe('LIQUIDACION_MOD');
    expect(result!.confidence).toBe(98);
  });

  it('detects NOTA DE DÉBITO A at confidence 96', () => {
    const result = runLayer1('NOTA DE DÉBITO A\nCUIT 30-71234567-9');
    expect(result).not.toBeNull();
    expect(result!.documentType).toBe('NOTA_DEBITO');
    expect(result!.confidence).toBe(96);
  });

  it('detects REMITO without CAE at confidence 93', () => {
    const result = runLayer1('REMITO\nFecha de entrega: 10/06/2026');
    expect(result).not.toBeNull();
    expect(result!.documentType).toBe('REMITO');
    expect(result!.confidence).toBe(93);
  });

  it('does NOT match REMITO when CAE is present (CAE wins instead)', () => {
    const text = 'REMITO\nCAE Nº: 75123456789012';
    const result = runLayer1(text);
    // REMITO_HEADER is excluded when CAE present; CAE_FOUND wins
    expect(result?.label).toBe('CAE_FOUND');
  });

  it('returns null for unrecognizable text', () => {
    const result = runLayer1('Texto libre sin señales conocidas');
    expect(result).toBeNull();
  });

  it('does NOT match FACTURA ABC without CUIT present', () => {
    const result = runLayer1('FACTURA A\nProducto X $500');
    expect(result).toBeNull();
  });
});
