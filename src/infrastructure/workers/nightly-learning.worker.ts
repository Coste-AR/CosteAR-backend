import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, getConnection } from './queues.js';
import { NightlyLearningService } from '../../application/nightly-learning/nightly-learning-service.js';

export function startNightlyLearningWorker(): Worker {
  const connection = getConnection();
  const service = new NightlyLearningService();

  const worker = new Worker(
    QUEUE_NAMES.nightlyLearning,
    async (job: Job) => {
      console.info(`[nightly-learning] Iniciando job ${job.id}`);
      try {
        await service.runNightlyPipeline();
        console.info(`[nightly-learning] Job ${job.id} finalizado con éxito`);
      } catch (err) {
        console.error(`[nightly-learning] Error en job ${job.id}:`, err);
        throw err;
      }
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[nightly-learning] Job ${job?.id} falló:`, err);
  });
  // Sin este listener, un error de conexión a Redis (no de un job) queda sin
  // manejar: BullMQ/ioredis lo emite como 'error' del EventEmitter, y sin
  // oyentes eso se propaga como unhandledRejection — que server.ts trata como
  // fatal y tira todo el proceso abajo. Los otros dos workers (macro-sync,
  // recalculate) ya tenían este mismo listener; a este le faltaba.
  worker.on('error', (err) => console.warn('[worker] nightly-learning error:', err.message));

  return worker;
}
