// Capturar errores no manejados ANTES de cualquier otra cosa.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
  process.exit(1);
});

import { buildApp } from './app.js';
import { getEnv } from '../config/env.js';
import { startMacroSyncWorker } from '../workers/macro-sync.worker.js';
import { startRecalculateWorker } from '../workers/recalculate.worker.js';
import { startNightlyLearningWorker } from '../workers/nightly-learning.worker.js';
import { macroSyncQueue, nightlyLearningQueue } from '../workers/queues.js';
import { scheduleMacroSync } from '../workers/scheduler.js';

/**
 * Punto de entrada del servidor HTTP.
 *
 * El servidor escucha PRIMERO para que el healthcheck pase.
 * Workers y BullMQ se inician después, en modo degradado si Redis no está.
 */
async function main(): Promise<void> {
  console.log('[startup] Iniciando CosteAR backend...');

  const env = getEnv();
  console.log(`[startup] Entorno: ${env.NODE_ENV}, puerto: ${env.PORT}`);

  const app = await buildApp();

  // --- Escuchar PRIMERO — el healthcheck debe responder cuanto antes ---
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`CosteAR API escuchando en http://0.0.0.0:${env.PORT}`);

  // --- Workers BullMQ (degradable — no bloquea el startup) ---
  let macroWorker: Awaited<ReturnType<typeof startMacroSyncWorker>> | null = null;
  let recalcWorker: Awaited<ReturnType<typeof startRecalculateWorker>> | null = null;
  let nightlyWorker: Awaited<ReturnType<typeof startNightlyLearningWorker>> | null = null;

  try {
    macroWorker = startMacroSyncWorker();
    recalcWorker = startRecalculateWorker();
    // Sin este worker, /admin/nightly/run encola el job pero nadie lo procesa
    // (quedaba PENDING para siempre — ver docs/plans para el detalle del bug).
    nightlyWorker = startNightlyLearningWorker();
    app.log.info('Workers BullMQ activos: macro-sync, recalculate, nightly-learning');
  } catch (err) {
    app.log.warn({ err }, 'Workers BullMQ no pudieron iniciarse — modo degradado');
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

  // --- Cron del pipeline nocturno (degradable) ---
  if (nightlyLearningQueue) {
    try {
      await nightlyLearningQueue.add(
        'nightly-pipeline',
        {},
        {
          repeat: { pattern: '0 2 * * *', tz: 'America/Argentina/Buenos_Aires' },
          jobId: 'scheduled-nightly-learning',
        },
      );
      app.log.info('Cron nightly-learning programado: 0 2 * * *');
    } catch (err) {
      app.log.warn({ err }, 'Cron nightly-learning no pudo programarse');
    }
  }

  // --- Graceful shutdown ---
  const close = async (signal: string): Promise<void> => {
    app.log.info(`Recibido ${signal}, cerrando servidor...`);
    await Promise.all([macroWorker?.close(), recalcWorker?.close(), nightlyWorker?.close()].filter(Boolean));
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));
}

void main();
