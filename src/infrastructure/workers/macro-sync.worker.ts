import { Worker } from 'bullmq';
import * as Sentry from '@sentry/node';
import { getConnection, QUEUE_NAMES, recalculateQueue } from './queues.js';
import { BcraClient } from '../external-apis/bcra.js';
import { IndecClient } from '../external-apis/indec.js';
import { DolarApiClient } from '../external-apis/dolarapi.js';
import { MacroService } from '../../application/macro/macro-service.js';
import { prisma } from '../database/prisma.js';

/**
 * Worker de sincronización macro. Trae los últimos valores de BCRA e INDEC,
 * los persiste como snapshots y, si hay un cambio significativo (>1%) respecto
 * del valor previo, encola un recálculo de las estructuras afectadas.
 */
export function startMacroSyncWorker(): Worker {
  const macro = new MacroService();
  const bcra = new BcraClient();
  const indec = new IndecClient();
  const dolarapi = new DolarApiClient();

  const worker = new Worker(
    QUEUE_NAMES.macroSync,
    async (job) => {
      job.log?.('Iniciando sync macro');
      let significantChange = false;

      const usd = await bcra.fetchOfficialUsd();
      if (usd) {
        significantChange ||= await persistAndDetect(macro, 'BCRA', usd);
      }

      const ipc = await indec.fetchIpcNacional();
      if (ipc) {
        significantChange ||= await persistAndDetect(macro, 'INDEC', ipc);
      }

      // Dólar blue: solo se muestra en la vitrina de la landing, NO alimenta el
      // costeo (ese usa el oficial), así que no dispara recálculo.
      const blue = await dolarapi.fetchBlue();
      if (blue) {
        await macro.record({ source: 'DOLARAPI', ...blue });
      }

      if (significantChange) {
        await recalculateQueue.add('recalculate', { trigger: 'macro-sync' });
      }

      return { significantChange };
    },
    {
      connection: getConnection(),
      // Sync macro: llama a 3 APIs externas. 2 min es generoso para redes lentas.
      lockDuration: 2 * 60 * 1000,
      maxStalledCount: 1,
    },
  );
  worker.on('failed', (job, err) => {
    console.error(`[macro-sync] Job ${job?.id} falló:`, err);
    Sentry.captureException(err, { tags: { worker: 'macro-sync', jobId: job?.id } });
  });
  worker.on('error', (err) => console.warn('[worker] macro-sync error:', err.message));
  return worker;
}

async function persistAndDetect(
  macro: MacroService,
  source: 'BCRA' | 'INDEC',
  indicator: { indicatorCode: string; value: number; effectiveDate: Date },
): Promise<boolean> {
  // Valor previo para comparar variación.
  const prev = await prisma.macroSnapshot.findFirst({
    where: { source, indicatorCode: indicator.indicatorCode },
    orderBy: { effectiveDate: 'desc' },
  });

  await macro.record({ source, ...indicator });

  if (!prev) return true; // primer valor: tratar como cambio
  const prevValue = Number(prev.value);
  if (prevValue === 0) return true;
  const changePct = Math.abs((indicator.value - prevValue) / prevValue) * 100;
  return changePct > 1; // umbral de 1%
}
