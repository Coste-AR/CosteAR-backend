import { describe, it, expect } from 'vitest';
import { runQualityGate } from '@/infrastructure/classifier/layers/layer0-quality-gate.js';

describe('runQualityGate', () => {
  it('returns PASS for clear, detailed text', () => {
    const result = runQualityGate({
      quality: 'legible',
      text: 'FACTURA A Nº 0001-00001234 CUIT 20-10000000-9 Subtotal $1000',
    });
    expect(result.gate).toBe('PASS');
    expect(result.confidenceCap).toBeNull();
  });

  it('returns PARTIAL and cap 65 for partially legible text', () => {
    const result = runQualityGate({ quality: 'parcial', text: 'FACTURA... borroso' });
    expect(result.gate).toBe('PARTIAL');
    expect(result.confidenceCap).toBe(65);
  });

  it('returns FAIL for illegible quality', () => {
    const result = runQualityGate({ quality: 'ilegible', text: '' });
    expect(result.gate).toBe('FAIL');
  });

  it('infers PARTIAL when text is very short (under 20 chars)', () => {
    const result = runQualityGate({ quality: 'legible', text: 'abc' });
    expect(result.gate).toBe('PARTIAL');
    expect(result.confidenceCap).toBe(65);
  });

  it('returns PASS when no Groq quality info but text is substantive', () => {
    const result = runQualityGate({
      quality: null,
      text: 'FACTURA A Nº 0001-00001234 Proveedor SRL CUIT 20-10000000-9 Total $5000',
    });
    expect(result.gate).toBe('PASS');
    expect(result.confidenceCap).toBeNull();
  });
});
