import { describe, it, expect } from 'vitest';
import { buildLedgerDraft } from '../../src/application/validaciones/ledger-builder.js';

function note(extractedData: Record<string, unknown>): string {
  return JSON.stringify({ extractedData });
}

describe('buildLedgerDraft', () => {
  it('usa el total y deriva el período de la fecha del comprobante', () => {
    const d = buildLedgerDraft({
      aiReviewNote: note({ totalAmount: 12500.5, date: '2026-03-15', supplier: 'Aceros SRL', invoiceNumber: '0001-12' }),
      documentType: 'FACTURA_COMPRA',
      fallbackDescription: 'fallback',
    });
    expect(d).not.toBeNull();
    expect(d!.amount).toBe(12500.5);
    expect(d!.period).toBe('2026-03');
    expect(d!.supplier).toBe('Aceros SRL');
    expect(d!.description).toContain('Aceros SRL');
  });

  it('cae al neto cuando no hay total', () => {
    const d = buildLedgerDraft({ aiReviewNote: note({ netAmount: 999 }), documentType: 'FACTURA_COMPRA', fallbackDescription: 'x' });
    expect(d!.amount).toBe(999);
  });

  it('devuelve null sin monto utilizable', () => {
    expect(buildLedgerDraft({ aiReviewNote: note({ supplier: 'X' }), documentType: 'FACTURA_COMPRA', fallbackDescription: 'x' })).toBeNull();
    expect(buildLedgerDraft({ aiReviewNote: note({ totalAmount: 0 }), documentType: 'FACTURA_COMPRA', fallbackDescription: 'x' })).toBeNull();
    expect(buildLedgerDraft({ aiReviewNote: note({ totalAmount: -50 }), documentType: 'FACTURA_COMPRA', fallbackDescription: 'x' })).toBeNull();
  });

  it('rechaza montos absurdos que desbordarían Decimal(18,4)', () => {
    expect(buildLedgerDraft({ aiReviewNote: note({ totalAmount: 1e15 }), documentType: 'FACTURA_COMPRA', fallbackDescription: 'x' })).toBeNull();
  });

  it('cae al mes actual cuando la fecha es inválida o falta', () => {
    const now = new Date();
    const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const d = buildLedgerDraft({ aiReviewNote: note({ totalAmount: 100, date: 'no-es-fecha' }), documentType: 'FACTURA_COMPRA', fallbackDescription: 'x' });
    expect(d!.period).toBe(expected);
  });

  it('no rompe con reviewNote nulo o JSON inválido', () => {
    expect(buildLedgerDraft({ aiReviewNote: null, documentType: 'X', fallbackDescription: 'x' })).toBeNull();
    expect(buildLedgerDraft({ aiReviewNote: 'no json {', documentType: 'X', fallbackDescription: 'x' })).toBeNull();
  });

  it('usa la descripción de fallback cuando no hay proveedor ni comprobante', () => {
    const d = buildLedgerDraft({ aiReviewNote: note({ totalAmount: 100 }), documentType: 'FACTURA_COMPRA', fallbackDescription: 'Compra de insumos' });
    expect(d!.description).toBe('Compra de insumos');
  });
});
