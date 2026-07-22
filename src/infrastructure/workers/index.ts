import { getEnv } from '../config/env.js';
import { macroSyncQueue } from './queues.js';
import { startMacroSyncWorker } from './macro-sync.worker.js';
import { startRecalculateWorker } from './recalculate.worker.js';
import { startNightlyLearningWorker } from './nightly-learning.worker.js';
import { nightlyLearningQueue } from './queues.js';

/**
 * Bootstrap de los workers. Levanta los procesadores de colas y programa el
 * cron de sincronización macro (lun-vie 18:00 ART por defecto).
 */
async function main(): Promise<void> {
  const env = getEnv();

  const macroWorker = startMacroSyncWorker();
  const recalcWorker = startRecalculateWorker();
  const nightlyWorker = startNightlyLearningWorker();

  // Job recurrente: sync macro según el cron configurado.
  await macroSyncQueue.add(
    'scheduled-sync',
    {},
    {
      repeat: { pattern: env.MACRO_SYNC_CRON, tz: 'America/Argentina/Buenos_Aires' },
      jobId: 'scheduled-macro-sync', // evita duplicados al reiniciar
    },
  );

  // Job recurrente: Nightly Learning (ej. a las 02:00 AM)
  await nightlyLearningQueue.add(
    'nightly-pipeline',
    {},
    {
      repeat: { pattern: '0 2 * * *', tz: 'America/Argentina/Buenos_Aires' },
      jobId: 'scheduled-nightly-learning',
    }
  );

  console.info('Workers de CosteAR iniciados (macro-sync + recalculate + nightly-learning)');

  const shutdown = async (): Promise<void> => {
    await Promise.all([macroWorker.close(), recalcWorker.close(), nightlyWorker.close()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
