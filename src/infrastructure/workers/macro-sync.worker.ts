import { Worker } from 'bullmq';
import { connection, QUEUE_NAMES, recalculateQueue } from './queues.js';
import { BcraClient } from '../external-apis/bcra.js';
import { IndecClient } from '../external-apis/indec.js';
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

  return new Worker(
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

      if (significantChange) {
        await recalculateQueue.add('recalculate', { trigger: 'macro-sync' });
      }

      return { significantChange };
    },
    { connection },
  );
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
