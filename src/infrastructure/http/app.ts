import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
import { getEnv } from '../config/env.js';
import { errorHandler } from './error-handler.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerAccessGateRoutes } from './routes/access-gate.routes.js';
import { registerCompanyRoutes } from './routes/company.routes.js';
import { registerCostStructureRoutes } from './routes/cost-structure.routes.js';
import { registerMacroRoutes } from './routes/macro.routes.js';
import { registerAlertRoutes } from './routes/alert.routes.js';
import { registerUserRoutes } from './routes/user.routes.js';
import { registerValidacionesRoutes } from './routes/validaciones.routes.js';
import { registerEmpresaPortalRoutes } from './routes/empresa-portal.routes.js';
import { registerCostitaChatRoutes } from './routes/costista-chat.routes.js';
import { registerAdvisorRoutes } from './routes/advisor.routes.js';

/**
 * Construye la instancia Fastify con toda la cadena de seguridad montada.
 * Separado de `listen()` para que los tests de integración puedan usar
 * `app.inject()` sin abrir un puerto real.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const env = getEnv();

  const app = Fastify({
    logger:
      env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty' } }
        : env.NODE_ENV === 'test'
          ? false
          : true,
    trustProxy: true, // detrás de un reverse proxy (Railway/Fly), para IP real
    bodyLimit: 1_048_576, // 1 MiB: un costeo no necesita más; corta payloads abusivos
  });

  app.setErrorHandler(errorHandler);

  // --- Seguridad de transporte y cabeceras ---
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  // --- CORS: lista blanca explícita, nunca '*' con credenciales ---
  // CORS_ORIGIN puede ser una lista separada por comas: "https://foo.vercel.app,http://localhost:5173"
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  // Dominios de Vercel del frontend (producción + previews) y localhost: se permiten
  // SIEMPRE, para no depender de que CORS_ORIGIN esté bien seteado en el deploy.
  // Cubre los dos nombres del proyecto ("costear-frontend" y "coste-ar-frontend")
  // y sus URLs de preview. Ej: coste-ar-frontend.vercel.app, coste-ar-frontend-xxx.vercel.app
  const alwaysAllowed = [
    /^https:\/\/costear-frontend[a-z0-9-]*\.vercel\.app$/,
    /^https:\/\/coste-ar-frontend[a-z0-9-]*\.vercel\.app$/,
    /^http:\/\/localhost:\d+$/,
  ];
  const isAllowed = (origin: string) =>
    allowedOrigins.includes(origin) || alwaysAllowed.some((re) => re.test(origin));
  await app.register(cors, {
    origin: (origin, cb) => {
      // Requests sin origin (curl, Postman, server-to-server) siempre pasan.
      if (!origin) return cb(null, true);
      if (isAllowed(origin)) return cb(null, true);
      app.log.warn({ origin, allowedOrigins }, 'CORS: origen rechazado');
      cb(new Error(`Origin ${origin} no permitido por CORS`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // --- Cookies firmadas (refresh token httpOnly) ---
  await app.register(cookie, {
    secret: env.COOKIE_SECRET,
    parseOptions: {},
  });

  // --- Rate limiting global respaldado por Redis ---
  // En test usamos el store en memoria para no requerir Redis.
  if (env.NODE_ENV !== 'test') {
    // retryStrategy: null → falla inmediato si no hay conexión, no reintenta.
    // connectTimeout: 4 000 ms → no bloquea el startup indefinidamente.
    const redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      lazyConnect: true,
      connectTimeout: 4_000,
    });
    await redis.connect().catch(() => {
      app.log.warn('Redis no disponible: rate limit usará memoria local');
    });
    await app.register(rateLimit, {
      global: true,
      max: 120,
      timeWindow: '1 minute',
      redis: redis.status === 'ready' ? redis : undefined,
    });
  } else {
    await app.register(rateLimit, { global: true, max: 1000, timeWindow: '1 minute' });
  }

  // --- Healthcheck ---
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  // --- Rutas de la API (versionadas) ---
  const prefix = `/api/${env.API_VERSION}`;
  await app.register(
    async (api) => {
      await registerAccessGateRoutes(api);
      await registerAuthRoutes(api);
      await registerCompanyRoutes(api);
      await registerCostStructureRoutes(api);
      await registerMacroRoutes(api);
      await registerAlertRoutes(api);
      await registerUserRoutes(api);
      await registerValidacionesRoutes(api);
      await registerEmpresaPortalRoutes(api);
      await registerCostitaChatRoutes(api);
      await registerAdvisorRoutes(api);
    },
    { prefix },
  );

  return app;
}
