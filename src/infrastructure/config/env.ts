import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_VERSION: z.string().default('v1'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_PRIVATE_KEY: z.string().min(1).default('placeholder-change-me'),
  JWT_PUBLIC_KEY: z.string().min(1).default('placeholder-change-me'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY_DAYS: z.coerce.number().int().positive().default(7),

  COOKIE_SECRET: z.string().min(1).default('changeme-32-chars-minimum-secret!'),
  // TOTP_ENCRYPTION_KEY: Railway puede enviarlo con espacios o longitud incorrecta.
  // Lo normalizamos a 32 chars rellennado o cortando.
  TOTP_ENCRYPTION_KEY: z.string().min(1).default('00000000000000000000000000000000'),
  ARGON2_PEPPER: z.string().min(1).default('changeme-pepper'),

  // Email: opcionales para no bloquear el startup si no están configurados.
  RESEND_API_KEY: z.string().min(1).default('re_placeholder'),
  EMAIL_FROM: z.string().default('noreply@costear.app'),

  BCRA_API_URL: z.string().url().default('https://api.bcra.gob.ar'),
  INDEC_API_URL: z.string().url().default('https://apis.datos.gob.ar/series/api'),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MACRO_SYNC_CRON: z.string().default('0 18 * * 1-5'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // Log pero NO crash: el servidor intenta arrancar de todas formas
    console.error(`[env] Variables de entorno con problemas:\n${issues}`);
    // Intentar con defaults forzados
    return envSchema.parse({ ...source });
  }
  // Normalizar TOTP_ENCRYPTION_KEY a exactamente 32 chars
  const data = result.data;
  if (data.TOTP_ENCRYPTION_KEY.length !== 32) {
    data.TOTP_ENCRYPTION_KEY = data.TOTP_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32);
  }
  return data;
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}
