import { Queue, type ConnectionOptions } from 'bullmq';
import { getEnv } from '../config/env.js';

/**
 * Conexión a Redis para BullMQ expresada como opciones (host/port), no como
 * instancia de ioredis: así evitamos el conflicto de tipos entre la copia de
 * ioredis de la app y la que bundlea BullMQ. BullMQ crea su propia conexión.
 *
 * Fail-fast: si Redis no está disponible BullMQ lanza en vez de reintentar
 * indefinidamente, lo que colgaría el proceso antes de que el servidor escuche.
 */
function parseRedisConnection(): ConnectionOptions {
  const url = new URL(getEnv().REDIS_URL);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.password ? { password: url.password } : {}),
    // null = reintentos infinitos (cuelga el proceso) → 0 = falla inmediato
    maxRetriesPerRequest: 0,
    // Sin retryStrategy BullMQ reintenta con backoff exponencial para siempre.
    // Retornando null se desactiva: el error llega al caller.
    retryStrategy: () => null,
    // Aborta el intento de conexión TCP a los 4 s.
    connectTimeout: 4_000,
    // No esperar a que la conexión esté lista antes de devolver el cliente.
    enableOfflineQueue: false,
  };
}

export const connection: ConnectionOptions = parseRedisConnection();

export const QUEUE_NAMES = {
  macroSync: 'macro-sync',
  recalculate: 'recalculate',
} as const;

export const macroSyncQueue = new Queue(QUEUE_NAMES.macroSync, { connection });
export const recalculateQueue = new Queue(QUEUE_NAMES.recalculate, { connection });

export interface RecalculateJob {
  /** Indicador macro que cambió y disparó el recálculo. */
  trigger: string;
}
