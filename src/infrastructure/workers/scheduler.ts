import type { Queue } from 'bullmq';

/**
 * Programa el job de sincronización macro en un cron BullMQ.
 * BullMQ soporta expresiones cron nativas — el job se encola automáticamente
 * según el patrón. Si ya existe un job con ese nombre se reemplaza para evitar
 * duplicados al reiniciar el servidor.
 *
 * Default env: '0 18 * * 1-5' → lunes a viernes a las 18:00 (UTC-3 = 21:00 UTC).
 * En desarrollo se puede usar '* * * * *' para sincronizar cada minuto.
 */
export async function scheduleMacroSync(queue: Queue, cronExpression: string): Promise<void> {
  // Eliminar jobs repetibles anteriores para evitar duplicados
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    if (job.name === 'macro-sync-cron') {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  await queue.add('macro-sync-cron', {}, { repeat: { pattern: cronExpression } });
}
