import { describe, it, expect } from 'vitest';
import { validateCAEStructure, extractCAE } from '@/infrastructure/classifier/utils/cae-validator.js';

describe('validateCAEStructure', () => {
  it('accepts a 14-digit string', () => {
    expect(validateCAEStructure('12345678901234')).toBe(true);
  });

  it('rejects strings shorter than 14 digits', () => {
    expect(validateCAEStructure('1234567890123')).toBe(false);
  });

  it('rejects strings longer than 14 digits', () => {
    expect(validateCAEStructure('123456789012345')).toBe(false);
  });

  it('rejects strings with non-digits', () => {
    expect(validateCAEStructure('1234567890123A')).toBe(false);
  });

  it('rejects all-zeros', () => {
    expect(validateCAEStructure('00000000000000')).toBe(false);
  });
});

describe('extractCAE', () => {
  it('extracts CAE from standard AFIP format', () => {
    const text = 'CAE Nº: 75123456789012\nFecha de Vto: 15/06/2026';
    expect(extractCAE(text)).toBe('75123456789012');
  });

  it('returns null when no CAE present', () => {
    expect(extractCAE('Factura sin CAE')).toBeNull();
  });

  it('ignores partial matches that are not 14 digits', () => {
    expect(extractCAE('CAE: 123456')).toBeNull();
  });
});
