import { describe, it, expect } from 'vitest';
import { validateCuit, extractCuits } from '../../infrastructure/classifier/utils/cuit-validator.js';

describe('validateCuit', () => {
  it('validates a known valid CUIT', () => {
    // 20-10000000-9 → verificador válido
    expect(validateCuit('20100000009')).toBe(true);
  });

  it('rejects CUIT with wrong verifier digit', () => {
    expect(validateCuit('20100000000')).toBe(false);
  });

  it('rejects if length !== 11', () => {
    expect(validateCuit('12345')).toBe(false);
  });

  it('accepts CUIT with hyphens', () => {
    expect(validateCuit('20-10000000-9')).toBe(true);
  });

  it('rejects when remainder is 1 (invalid by definition)', () => {
    expect(validateCuit('00000000001')).toBe(false);
  });
});

describe('extractCuits', () => {
  it('extracts CUITs from formatted text', () => {
    const text = 'Proveedor CUIT: 20-10000000-9 Comprador CUIT 30000000007';
    const result = extractCuits(text);
    expect(result).toContain('20100000009');
    expect(result).toContain('30000000007');
  });

  it('returns empty array when no CUIT present', () => {
    expect(extractCuits('Sin número de identificación')).toEqual([]);
  });
});
