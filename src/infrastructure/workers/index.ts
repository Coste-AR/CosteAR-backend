import { getEnv } from '../config/env.js';
import { startMacroSyncWorker } from './macro-sync.worker.js';
import { startRecalculateWorker } from './recalculate.worker.js';
import { startNightlyLearningWorker } from './nightly-learning.worker.js';
import { startDailyRunWorker } from './daily-run.worker.js';
import { registerRepeatableJobs } from './repeatable-jobs.js';

/**
 * Bootstrap de los workers. Levanta los procesadores de colas y programa los
 * jobs recurrentes (sync macro lun-vie 18:00 ART, pipeline nocturno 02:00 ART,
 * cálculo diario del período abierto 03:00 ART).
 *
 * Los crons se registran vía `registerRepeatableJobs`, el mismo lugar que usa
 * server.ts. Antes cada uno tenía su propia copia con nombres y timezone
 * distintos, lo que producía dos repetibles diferentes en Redis.
 */
async function main(): Promise<void> {
  const env = getEnv();

  const macroWorker = startMacroSyncWorker();
  const recalcWorker = startRecalculateWorker();
  const nightlyWorker = startNightlyLearningWorker();
  const dailyRunWorker = startDailyRunWorker();

  await registerRepeatableJobs(env.MACRO_SYNC_CRON);

  console.info(
    'Workers de CosteAR iniciados (macro-sync + recalculate + nightly-learning + daily-run)',
  );

  const shutdown = async (): Promise<void> => {
    await Promise.all([
      macroWorker.close(),
      recalcWorker.close(),
      nightlyWorker.close(),
      dailyRunWorker.close(),
    ]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
