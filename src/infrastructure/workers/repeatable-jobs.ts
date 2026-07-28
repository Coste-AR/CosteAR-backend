// src/infrastructure/workers/repeatable-jobs.ts
import type { Queue } from 'bullmq';
import { macroSyncQueue, nightlyLearningQueue } from './queues.js';

/**
 * Registro ÚNICO de los jobs recurrentes.
 *
 * Antes esto vivía duplicado y desalineado:
 *
 *   server.ts        → scheduleMacroSync() → nombre 'macro-sync-cron', SIN tz
 *   workers/index.ts → 'scheduled-sync', jobId 'scheduled-macro-sync', tz ART
 *
 * Dos problemas:
 *
 *  1. Son dos repetibles DISTINTOS en Redis. Con los dos procesos vivos, la sync
 *     macro corría dos veces por ciclo.
 *  2. El de server.ts no pasaba `tz`, así que BullMQ usaba la hora del proceso.
 *     Los contenedores corren en UTC → `0 18 * * 1-5` disparaba a las 18:00 UTC
 *     (15:00 ART), tres horas antes de lo que decía su propio comentario.
 *
 * `TIMEZONE` es explícito acá justamente para que la hora del contenedor no
 * pueda volver a cambiar cuándo corre un job de negocio.
 */

const TIMEZONE = 'America/Argentina/Buenos_Aires';
const NIGHTLY_CRON = '0 2 * * *';

interface RepeatableSpec {
  name: string;
  pattern: string;
  jobId: string;
}

/**
 * Converge la cola al spec dado: deja el repetible canónico si ya existe y borra
 * cualquier otro (nombres viejos, patrones viejos, tz distinto).
 *
 * Se borra lo que NO coincide en vez de "borrar todo y recrear" a propósito: así
 * el job bueno nunca deja de existir ni por un instante, y si el web y el worker
 * corren esto a la vez el resultado converge igual — el que llega último agrega
 * exactamente el mismo repeat key, que para BullMQ es un no-op.
 */
async function ensureRepeatable(
  queue: Queue | null,
  label: string,
  spec: RepeatableSpec,
): Promise<void> {
  if (!queue) {
    console.warn(`[repeatable-jobs] Cola de "${label}" no disponible — cron NO programado`);
    return;
  }

  const existing = await queue.getRepeatableJobs();
  let canonicalFound = false;

  for (const job of existing) {
    const isCanonical =
      job.name === spec.name && job.pattern === spec.pattern && job.tz === TIMEZONE;

    if (isCanonical) {
      canonicalFound = true;
      continue;
    }
    await queue.removeRepeatableByKey(job.key);
    console.info(`[repeatable-jobs] "${label}": removido repetible obsoleto (${job.name} @ ${job.pattern} tz=${job.tz ?? 'sistema'})`);
  }

  // Idempotente: si ya estaba, BullMQ no duplica (mismo repeat key).
  await queue.add(spec.name, {}, { repeat: { pattern: spec.pattern, tz: TIMEZONE }, jobId: spec.jobId });

  if (!canonicalFound) {
    console.info(`[repeatable-jobs] "${label}" programado: ${spec.pattern} (${TIMEZONE})`);
  }
}

/**
 * Debe llamarla el proceso que corre los workers. Es seguro que la llamen los
 * dos (web y worker): converge al mismo estado.
 */
export async function registerRepeatableJobs(macroCron: string): Promise<void> {
  await ensureRepeatable(macroSyncQueue, 'macro-sync', {
    name: 'macro-sync',
    pattern: macroCron,
    jobId: 'scheduled-macro-sync',
  });

  await ensureRepeatable(nightlyLearningQueue, 'nightly-learning', {
    name: 'nightly-pipeline',
    pattern: NIGHTLY_CRON,
    jobId: 'scheduled-nightly-learning',
  });
}
