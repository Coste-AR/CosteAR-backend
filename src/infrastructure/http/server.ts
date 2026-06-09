import { buildApp } from './app.js';
import { getEnv } from '../config/env.js';
import { startMacroSyncWorker } from '../workers/macro-sync.worker.js';
import { startRecalculateWorker } from '../workers/recalculate.worker.js';
import { macroSyncQueue } from '../workers/queues.js';
import { scheduleMacroSync } from '../workers/scheduler.js';

/**
 * Punto de entrada del servidor HTTP.
 *
 * Redis/BullMQ es opcional: si no está disponible el servidor arranca en
 * modo degradado (sin recálculo automático). El healthcheck en /health
 * siempre responde para que Railway no marque el deploy como fallido.
 */
async function main(): Promise<void> {
  const env = getEnv();

  // buildApp puede fallar si faltan env vars críticas (JWT, DB, etc.)
  const app = await buildApp();

  // --- Workers BullMQ (degradable) ---
  let macroWorker: Awaited<ReturnType<typeof startMacroSyncWorker>> | null = null;
  let recalcWorker: Awaited<ReturnType<typeof startRecalculateWorker>> | null = null;

  try {
    macroWorker = startMacroSyncWorker();
    recalcWorker = startRecalculateWorker();
    app.log.info('Workers BullMQ activos: macro-sync, recalculate');
  } catch (err) {
    app.log.warn({ err }, 'Workers BullMQ no pudieron iniciarse — modo degradado (sin recálculo automático)');
  }

  // --- Cron + startup sync (degradable) ---
  if (macroSyncQueue) {
    try {
      await scheduleMacroSync(macroSyncQueue, env.MACRO_SYNC_CRON);
      app.log.info(`Cron macro-sync programado: ${env.MACRO_SYNC_CRON}`);

      if (env.NODE_ENV === 'production') {
        await macroSyncQueue.add('startup-sync', {}, { delay: 5_000 });
      }
    } catch (err) {
      app.log.warn({ err }, 'Scheduler BullMQ no pudo iniciarse — sync automática desactivada');
    }
  }

  // --- Graceful shutdown ---
  const close = async (signal: string): Promise<void> => {
    app.log.info(`Recibido ${signal}, cerrando servidor...`);
    await Promise.all([macroWorker?.close(), recalcWorker?.close()].filter(Boolean));
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));

  // --- HTTP listen (siempre, aunque Redis haya fallado) ---
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`CosteAR API escuchando en http://localhost:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
