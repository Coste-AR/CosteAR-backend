import { z } from 'zod';

/**
 * Esquema de variables de entorno. Toda variable requerida se valida al
 * startup: si falta algo, la app NO arranca y se reporta con claridad.
 * Esto evita que un secreto faltante se descubra recién en runtime.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_VERSION: z.string().default('v1'),

  DATABASE_URL: z.string().min(1),
  // REDIS_URL puede ser una URL completa (redis://...) o host:port.
  // No forzamos .url() para no rechazar formatos válidos de Railway.
  REDIS_URL: z.string().min(1),

  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY_DAYS: z.coerce.number().int().positive().default(7),

  COOKIE_SECRET: z.string().min(32),
  TOTP_ENCRYPTION_KEY: z.string().length(32),
  ARGON2_PEPPER: z.string().min(1),

  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().email(),

  BCRA_API_URL: z.string().url().default('https://api.bcra.gob.ar'),
  INDEC_API_URL: z.string().url().default('https://apis.datos.gob.ar/series/api'),

  CORS_ORIGIN: z.string(),
  MACRO_SYNC_CRON: z.string().default('0 18 * * 1-5'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuración de entorno inválida:\n${issues}`);
  }
  return result.data;
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

/** Solo para tests: limpia el cache del entorno. */
export function resetEnvCache(): void {
  cached = null;
}
