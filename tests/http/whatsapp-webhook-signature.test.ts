import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { verifyMetaSignature } from '../../src/infrastructure/http/routes/whatsapp.routes.js';

const SECRET = 'test-whatsapp-app-secret';

function requestWith(rawBody: Buffer, signatureHeader?: string) {
  return {
    headers: signatureHeader ? { 'x-hub-signature-256': signatureHeader } : {},
    rawBody,
  } as never;
}

describe('verifyMetaSignature', () => {
  it('acepta una firma sha256= válida sobre el body crudo', () => {
    const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
    const hex = createHmac('sha256', SECRET).update(body).digest('hex');

    expect(verifyMetaSignature(requestWith(body, `sha256=${hex}`), SECRET)).toBe(true);
  });

  it('rechaza si falta el prefijo sha256=', () => {
    const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
    const hex = createHmac('sha256', SECRET).update(body).digest('hex');

    expect(verifyMetaSignature(requestWith(body, hex), SECRET)).toBe(false);
  });

  it('rechaza una firma inválida', () => {
    const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
    expect(verifyMetaSignature(requestWith(body, `sha256=${'ab'.repeat(32)}`), SECRET)).toBe(false);
  });

  it('rechaza cuando no viene ninguna firma', () => {
    const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
    expect(verifyMetaSignature(requestWith(body), SECRET)).toBe(false);
  });

  it('rechaza si el body fue manipulado después de firmarlo', () => {
    const original = Buffer.from(JSON.stringify({ object: 'a' }));
    const hex = createHmac('sha256', SECRET).update(original).digest('hex');
    const tampered = Buffer.from(JSON.stringify({ object: 'b' }));

    expect(verifyMetaSignature(requestWith(tampered, `sha256=${hex}`), SECRET)).toBe(false);
  });
});
