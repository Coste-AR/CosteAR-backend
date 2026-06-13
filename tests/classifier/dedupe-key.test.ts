import { describe, it, expect } from 'vitest';
import { buildStrongDedupeKey } from '../../src/infrastructure/classifier/utils/dedupe-key.js';

describe('buildStrongDedupeKey', () => {
  it('builds a key from supplier + invoice number', () => {
    const k = buildStrongDedupeKey({ supplier: 'Aceros SRL', invoiceNumber: '0001-00012345' });
    expect(k).toBe('acerossrl|000100012345');
  });

  it('is stable across accents, case and punctuation', () => {
    const a = buildStrongDedupeKey({ supplier: 'Almacén José', invoiceNumber: 'A-0001' });
    const b = buildStrongDedupeKey({ supplier: 'almacen jose', invoiceNumber: 'a0001' });
    expect(a).toBe(b);
  });

  it('returns null when invoice number is missing', () => {
    expect(buildStrongDedupeKey({ supplier: 'Aceros SRL', invoiceNumber: null })).toBeNull();
  });

  it('returns null when supplier is missing', () => {
    expect(buildStrongDedupeKey({ supplier: null, invoiceNumber: '0001-1' })).toBeNull();
  });

  it('returns null when both missing', () => {
    expect(buildStrongDedupeKey({})).toBeNull();
  });

  it('returns null on too-short values (avoids false matches)', () => {
    expect(buildStrongDedupeKey({ supplier: 'A', invoiceNumber: '1' })).toBeNull();
  });
});
