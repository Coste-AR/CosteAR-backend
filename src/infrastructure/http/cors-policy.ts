import type { FastifyBaseLogger } from 'fastify';

const alwaysAllowed = [
  'https://coste-ar.com',
  'https://www.coste-ar.com',
  /^https:\/\/costear-frontend[a-z0-9-]*\.vercel\.app$/,
  /^https:\/\/coste-ar-frontend[a-z0-9-]*\.vercel\.app$/,
  /^http:\/\/localhost:\d+$/,
] as const;

export function isAllowed(origin: string, allowedOrigins: readonly string[] = []): boolean {
  return (
    allowedOrigins.includes(origin) ||
    alwaysAllowed.some((allowed) =>
      typeof allowed === 'string' ? allowed === origin : allowed.test(origin),
    )
  );
}

export function createCorsOriginHandler(
  allowedOrigins: readonly string[],
  log: Pick<FastifyBaseLogger, 'warn'>,
) {
  return (
    origin: string | undefined,
    cb: (error: Error | null, allowed: boolean) => void,
  ): void => {
    if (!origin || isAllowed(origin, allowedOrigins)) {
      cb(null, true);
      return;
    }

    log.warn({ origin, allowedOrigins }, 'CORS: origen rechazado');
    cb(null, false);
  };
}
