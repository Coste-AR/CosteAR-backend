import { Queue, type ConnectionOptions } from 'bullmq';
import { getEnv } from '../config/env.js';

/**
 * Parsea REDIS_URL en formato host/port para BullMQ.
 * Acepta:
 *   - redis://[:password@]host:port
 *   - rediss://[:password@]host:port  (TLS)
 *   - host:port  (sin scheme, formato interno Railway)
 *
 * Fail-fast: connectTimeout 4 s, sin reintentos.
 * Si Redis no está disponible BullMQ lanza en vez de colgar el proceso.
 */
function parseRedisConnection(): ConnectionOptions {
  const raw = getEnv().REDIS_URL;

  // Añadir scheme si falta para que URL() no tire.
  const normalized = /^rediss?:\/\//i.test(raw) ? raw : `redis://${raw}`;

  let host = 'localhost';
  let port = 6379;
  let password: string | undefined;
  let tls = false;

  try {
    const url = new URL(normalized);
    host = url.hostname || 'localhost';
    port = url.port ? Number(url.port) : 6379;
    password = url.password || undefined;
    tls = url.protocol === 'rediss:';
  } catch {
    // URL inválida — usar defaults y dejar que el error aparezca en los logs
    console.warn(`[queues] REDIS_URL inválida: "${raw}" — usando localhost:6379`);
  }

  return {
    host,
    port,
    ...(password ? { password } : {}),
    ...(tls ? { tls: {} } : {}),
    // Fail-fast: no reintentar si Redis no está disponible.
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    connectTimeout: 4_000,
  };
}

export const QUEUE_NAMES = {
  macroSync: 'macro-sync',
  recalculate: 'recalculate',
  nightlyLearning: 'nightly-learning',
  dailyRun: 'daily-run',
} as const;

/**
 * Crea una Queue con conexión fail-fast.
 * Si la creación falla (URL inválida, Redis caído) devuelve null para que
 * server.ts pueda arrancar en modo degradado.
 */
function createQueue(name: string): Queue | null {
  try {
    const connection = parseRedisConnection();
    const queue = new Queue(name, { connection });
    queue.on('error', (err) => console.warn(`[queues] Queue "${name}" error:`, err.message));
    return queue;
  } catch (err) {
    console.warn(`[queues] No se pudo crear la queue "${name}":`, err);
    return null;
  }
}

// Las queues se crean una sola vez al importar el módulo.
// Si Redis no está disponible quedan en null; server.ts maneja el modo degradado.
export const macroSyncQueue: Queue = createQueue(QUEUE_NAMES.macroSync) as Queue;
export const recalculateQueue: Queue = createQueue(QUEUE_NAMES.recalculate) as Queue;
export const nightlyLearningQueue: Queue = createQueue(QUEUE_NAMES.nightlyLearning) as Queue;
export const dailyRunQueue: Queue = createQueue(QUEUE_NAMES.dailyRun) as Queue;

export function getConnection(): ConnectionOptions {
  return parseRedisConnection();
}

export interface RecalculateJob {
  /** Indicador macro que cambió y disparó el recálculo. */
  trigger: string;
}
