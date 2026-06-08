import { describe, it, expect, beforeAll } from 'vitest';

// Setear entorno COMPLETO antes de importar los módulos que leen getEnv()
// (getEnv cachea en la primera llamada, así que todo debe estar listo aquí).
beforeAll(async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.JWT_PRIVATE_KEY = privateKey;
  process.env.JWT_PUBLIC_KEY = publicKey;
  process.env.JWT_ACCESS_EXPIRY = '15m';
  process.env.COOKIE_SECRET = 'x'.repeat(32);
  process.env.TOTP_ENCRYPTION_KEY = 'x'.repeat(32);
  process.env.ARGON2_PEPPER = 'test-pepper';
  process.env.RESEND_API_KEY = 're_x';
  process.env.EMAIL_FROM = 'noreply@costear.com';
  process.env.CORS_ORIGIN = 'http://localhost:5173';
});

describe('password (Argon2id + pepper)', () => {
  it('hashea y verifica correctamente', async () => {
    const { hashPassword, verifyPassword } = await import(
      '@/infrastructure/crypto/password.js'
    );
    const hash = await hashPassword('SuperSecret123!');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'SuperSecret123!')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('produce hashes distintos para el mismo password (salt aleatorio)', async () => {
    const { hashPassword } = await import('@/infrastructure/crypto/password.js');
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });

  it('no rompe ante un hash corrupto', async () => {
    const { verifyPassword } = await import('@/infrastructure/crypto/password.js');
    expect(await verifyPassword('no-es-un-hash', 'x')).toBe(false);
  });
});

describe('tokens (JWT RS256 + refresh opaco)', () => {
  it('firma y verifica un access token', async () => {
    const { signAccessToken, verifyAccessToken } = await import(
      '@/infrastructure/crypto/tokens.js'
    );
    const token = signAccessToken({ sub: 'u1', tenantId: 'u1', role: 'COSTISTA' });
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('u1');
    expect(payload.role).toBe('COSTISTA');
  });

  it('rechaza un token manipulado', async () => {
    const { signAccessToken, verifyAccessToken } = await import(
      '@/infrastructure/crypto/tokens.js'
    );
    const token = signAccessToken({ sub: 'u1', tenantId: 'u1', role: 'COSTISTA' });
    const tampered = token.slice(0, -3) + 'aaa';
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('genera refresh tokens opacos con hash determinístico', async () => {
    const { generateRefreshToken, hashRefreshToken } = await import(
      '@/infrastructure/crypto/tokens.js'
    );
    const { token, hash } = generateRefreshToken();
    expect(token.length).toBeGreaterThan(20);
    expect(hashRefreshToken(token)).toBe(hash); // determinístico
  });
});

describe('TOTP (2FA)', () => {
  it('cifra y descifra el secreto (AES-256-GCM round-trip)', async () => {
    const { generateTotpSecret, encryptSecret, decryptSecret } = await import(
      '@/infrastructure/crypto/totp.js'
    );
    const secret = generateTotpSecret();
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toBe(secret);
    expect(encrypted.split(':')).toHaveLength(3);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it('verifica un código TOTP válido', async () => {
    const { generateTotpSecret, verifyTotp } = await import(
      '@/infrastructure/crypto/totp.js'
    );
    const { authenticator } = await import('otplib');
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(secret, '000000')).toBe(false);
  });

  it('genera backup codes con formato legible', async () => {
    const { generateBackupCodes } = await import('@/infrastructure/crypto/totp.js');
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    expect(codes[0]).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
  });
});
