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

  // SMTP Configuration (alternative to Resend)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.string().optional(), // 'true' or 'false'

  GROQ_API_KEY: z.string().min(1).default('groq_placeholder'),

  // IA — Voyage AI (embeddings para indexar la bóveda de costeo)
  VOYAGE_API_KEY: z.string().min(1).default('voyage_placeholder'),

  WHATSAPP_VERIFY_TOKEN: z.string().min(1).default('whatsapp_verify_placeholder'),
  WHATSAPP_API_TOKEN: z.string().min(1).default('whatsapp_api_placeholder'),

  BCRA_API_URL: z.string().url().default('https://api.bcra.gob.ar'),
  INDEC_API_URL: z.string().url().default('https://apis.datos.gob.ar/series/api'),
  // dolarapi.com: API pública sin key para el dólar blue (el BCRA no lo publica).
  DOLARAPI_URL: z.string().url().default('https://dolarapi.com'),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MACRO_SYNC_CRON: z.string().default('0 18 * * 1-5'),

  // Gate de acceso previo al login (mientras el producto está en construcción).
  // Es un HASH Argon2id de la contraseña del equipo — el texto plano nunca se
  // guarda. Se puede sobrescribir por env var en el deploy para rotarla.
  ACCESS_GATE_HASH: z
    .string()
    .default('$argon2id$v=19$m=65536,t=3,p=4$MPvy55gNDLwuV9DhPoRgbw$Z4Ag/77XbyG1OBrNA7rMiEG9dYt0/jkHwDRAEfplvVw'),

  SENTRY_DSN: z.string().optional(),
  // Firma HMAC-SHA256 del webhook de Sentry (header sentry-hook-signature).
  // Es el "Client Secret" que Sentry muestra al crear la integración interna
  // (Settings → Developer Settings → tu integración → Webhooks). Sin esto
  // configurado, el webhook rechaza todo (falla cerrado, no abierto).
  SENTRY_WEBHOOK_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`[env] Variables de entorno con problemas:\n${issues}`);
    throw new Error(`Configuración de entorno inválida:\n${issues}`);
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
