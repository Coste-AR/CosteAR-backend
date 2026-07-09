import { describe, it, expect } from 'vitest';
import { parseEnv } from '@/infrastructure/config/env.js';

const valid = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_PRIVATE_KEY: 'key',
  JWT_PUBLIC_KEY: 'key',
  COOKIE_SECRET: 'x'.repeat(32),
  TOTP_ENCRYPTION_KEY: 'x'.repeat(32),
  ARGON2_PEPPER: 'pepper',
  RESEND_API_KEY: 're_x',
  EMAIL_FROM: 'noreply@costear.com',
  CORS_ORIGIN: 'http://localhost:5173',
};

describe('parseEnv', () => {
  it('parsea un entorno válido y coacciona tipos', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('test');
    expect(env.JWT_REFRESH_EXPIRY_DAYS).toBe(7);
  });

  it('lanza error cuando falta una variable requerida', () => {
    expect(() => parseEnv({ NODE_ENV: 'test' })).toThrow(/inválida/);
  });

  it('acepta un cookie secret de menos de 32 caracteres', () => {
    const env = parseEnv({ ...valid, COOKIE_SECRET: 'short' });
    expect(env.COOKIE_SECRET).toBe('short');
  });

  it('normaliza una TOTP key que no tenga exactamente 32 caracteres', () => {
    const envShort = parseEnv({ ...valid, TOTP_ENCRYPTION_KEY: 'short' });
    expect(envShort.TOTP_ENCRYPTION_KEY).toBe('short000000000000000000000000000');

    const envLong = parseEnv({ ...valid, TOTP_ENCRYPTION_KEY: 'x'.repeat(40) });
    expect(envLong.TOTP_ENCRYPTION_KEY).toBe('x'.repeat(32));
  });

  it('acepta un EMAIL_FROM no estructurado como email', () => {
    const env = parseEnv({ ...valid, EMAIL_FROM: 'no-es-email' });
    expect(env.EMAIL_FROM).toBe('no-es-email');
  });
});
