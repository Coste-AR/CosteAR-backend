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

  return worker;
}
