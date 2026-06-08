import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * Test de la lógica de rotación e invalidación de familia del refresh token,
 * el mecanismo central contra robo de sesión. Se mockea Prisma para aislar la
 * lógica de seguridad sin depender de una base viva.
 */

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
  process.env.JWT_REFRESH_EXPIRY_DAYS = '7';
  process.env.COOKIE_SECRET = 'x'.repeat(32);
  process.env.TOTP_ENCRYPTION_KEY = 'x'.repeat(32);
  process.env.ARGON2_PEPPER = 'test-pepper';
  process.env.RESEND_API_KEY = 're_x';
  process.env.EMAIL_FROM = 'noreply@costear.com';
  process.env.CORS_ORIGIN = 'http://localhost:5173';
});

describe('AuthService.refresh — rotación y detección de reuso', () => {
  it('invalida toda la familia si se reusa un token ya revocado', async () => {
    const { AuthService } = await import('@/application/auth/auth-service.js');
    const { hashRefreshToken } = await import('@/infrastructure/crypto/tokens.js');

    const rawToken = 'token-robado';
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });

    const db = {
      refreshToken: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'rt1',
          userId: 'u1',
          familyId: 'fam1',
          tokenHash: hashRefreshToken(rawToken),
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
          revokedAt: new Date(), // YA fue revocado → reuso
        }),
        updateMany,
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    } as never;

    const service = new AuthService(db);
    await expect(service.refresh(rawToken, {})).rejects.toThrow();

    // Debe haber invalidado toda la familia.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ familyId: 'fam1' }),
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );
  });

  it('rechaza un refresh token inexistente', async () => {
    const { AuthService } = await import('@/application/auth/auth-service.js');
    const db = {
      refreshToken: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never;
    const service = new AuthService(db);
    await expect(service.refresh('no-existe', {})).rejects.toThrow();
  });

  it('rechaza un refresh token expirado', async () => {
    const { AuthService } = await import('@/application/auth/auth-service.js');
    const { hashRefreshToken } = await import('@/infrastructure/crypto/tokens.js');
    const db = {
      refreshToken: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'rt1',
          userId: 'u1',
          familyId: 'fam1',
          tokenHash: hashRefreshToken('expirado'),
          expiresAt: new Date(Date.now() - 1000), // ya venció
          revokedAt: null,
        }),
      },
    } as never;
    const service = new AuthService(db);
    await expect(service.refresh('expirado', {})).rejects.toThrow();
  });
});

describe('AuthService.login — anti-bruteforce', () => {
  it('bloquea la cuenta tras 5 intentos fallidos', async () => {
    const { AuthService } = await import('@/application/auth/auth-service.js');
    const { hashPassword } = await import('@/infrastructure/crypto/password.js');

    const realHash = await hashPassword('CorrectPass123');
    const update = vi.fn().mockResolvedValue({});

    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u1',
          email: 'a@b.com',
          passwordHash: realHash,
          name: 'Test',
          role: 'COSTISTA',
          twoFactorEnabled: false,
          isLocked: false,
          lockedUntil: null,
          failedLoginAttempts: 4, // este será el 5°
        }),
        update,
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    } as never;

    const service = new AuthService(db);
    await expect(
      service.login({ email: 'a@b.com', password: 'WrongPass999' }, {}),
    ).rejects.toThrow();

    // El 5° fallo debe disparar el bloqueo.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isLocked: true, failedLoginAttempts: 5 }),
      }),
    );
  });

  it('no revela si un email existe (mismo error genérico)', async () => {
    const { AuthService } = await import('@/application/auth/auth-service.js');
    const db = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    } as never;
    const service = new AuthService(db);
    await expect(
      service.login({ email: 'ghost@b.com', password: 'whatever123' }, {}),
    ).rejects.toThrow(/incorrectos/);
  });
});
