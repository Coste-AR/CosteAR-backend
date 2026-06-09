import { buildApp } from './app.js';
import { getEnv } from '../config/env.js';
import { startMacroSyncWorker } from '../workers/macro-sync.worker.js';
import { startRecalculateWorker } from '../workers/recalculate.worker.js';
import { macroSyncQueue } from '../workers/queues.js';
import { scheduleMacroSync } from '../workers/scheduler.js';

/**
 * Punto de entrada del servidor HTTP. Carga y valida el entorno, construye la
 * app con toda la cadena de seguridad y escucha. Maneja shutdown ordenado.
 *
 * Workers y scheduler BullMQ son opcionales: si Redis no está disponible el
 * servidor arranca igual en modo degradado (sin recálculo automático).
 */
async function main(): Promise<void> {
  const env = getEnv();
  const app = await buildApp();

  // --- Arrancar workers BullMQ (degradable si Redis no disponible) ---
  let macroWorker: Awaited<ReturnType<typeof startMacroSyncWorker>> | null = null;
  let recalcWorker: Awaited<ReturnType<typeof startRecalculateWorker>> | null = null;

  try {
    macroWorker = startMacroSyncWorker();
    recalcWorker = startRecalculateWorker();
    app.log.info('Workers BullMQ activos: macro-sync, recalculate');
  } catch (err) {
    app.log.warn({ err }, 'Workers BullMQ no pudieron iniciarse — servidor en modo degradado (sin recálculo automático)');
  }

  // --- Programar cron de sincronización macro ---
  try {
    await scheduleMacroSync(macroSyncQueue, env.MACRO_SYNC_CRON);
    app.log.info(`Cron macro-sync programado: ${env.MACRO_SYNC_CRON}`);

    // Disparar sync inmediata al arrancar en producción para tener datos frescos
    if (env.NODE_ENV === 'production') {
      await macroSyncQueue.add('startup-sync', {}, { delay: 5_000 });
    }
  } catch (err) {
    app.log.warn({ err }, 'Scheduler BullMQ no pudo iniciarse — sync automática desactivada');
  }

  // --- Graceful shutdown ---
  const close = async (signal: string): Promise<void> => {
    app.log.info(`Recibido ${signal}, cerrando servidor...`);
    await Promise.all([
      macroWorker?.close(),
      recalcWorker?.close(),
    ]);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));

  // --- Escuchar (esto siempre ocurre, incluso si Redis falla) ---
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`CosteAR API escuchando en http://localhost:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
