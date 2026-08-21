import { Worker, type Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import { QUEUE_NAMES, getConnection } from './queues.js';
import { DailyRunService } from '../../application/cost-structures/daily-run-service.js';

/**
 * Worker del cálculo diario del período abierto.
 *
 * El servicio ya aísla los errores por período y nunca tira: lo que llega acá
 * es el resumen de qué pasó con cada uno. Se loguea agrupado para que en los
 * logs se vea de un vistazo si el job está calculando algo o girando en el
 * vacío — un job que corre todos los días y nunca calcula nada es un bug
 * silencioso, y sin este resumen no se nota.
 */
export function startDailyRunWorker(): Worker {
  const connection = getConnection();
  const service = new DailyRunService();

  const worker = new Worker(
    QUEUE_NAMES.dailyRun,
    async (job: Job) => {
      console.info(`[daily-run] Iniciando job ${job.id}`);
      const outcomes = await service.runAll();

      const conteo = outcomes.reduce<Record<string, number>>((acc, o) => {
        acc[o.estado] = (acc[o.estado] ?? 0) + 1;
        return acc;
      }, {});
      console.info(
        `[daily-run] Job ${job.id} terminado — ${outcomes.length} período(s):`,
        JSON.stringify(conteo),
      );

      // Los que no se calcularon se listan uno por uno con su motivo: es lo que
      // alguien va a querer leer cuando pregunte por qué un costo no se movió.
      for (const o of outcomes) {
        if (o.estado === 'calculado' || o.estado === 'sin-cambios') continue;
        console.warn(`[daily-run] ${o.productName} · ${o.periodLabel} → ${o.estado}: ${o.motivo}`);
      }

      return conteo;
    },
    {
      connection,
      concurrency: 1,
      // El daily-run puede calcular docenas de estructuras: hasta 5 min es normal.
      // Sin lockDuration explícito BullMQ usa 30 s — demasiado corto y el job
      // quedaría stale antes de terminar.
      lockDuration: 5 * 60 * 1000,
      maxStalledCount: 1,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[daily-run] Job ${job?.id} falló:`, err);
    Sentry.captureException(err, { tags: { worker: 'daily-run', jobId: job?.id } });
  });
  // Sin este listener un error de conexión a Redis se propaga como
  // unhandledRejection y server.ts lo trata como fatal, tirando el proceso.
  worker.on('error', (err) => console.warn('[worker] daily-run error:', err.message));

  return worker;
}
