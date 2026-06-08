import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MacroService } from '../../../application/macro/macro-service.js';
import { authenticate } from '../plugins/authenticate.js';
import { macroSyncQueue } from '../../workers/queues.js';

const historyQuery = z.object({
  source: z.enum(['BCRA', 'INDEC', 'ARCA', 'PARITARIA']).optional(),
  indicator: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const manualEntrySchema = z.object({
  source: z.enum(['BCRA', 'INDEC', 'ARCA', 'PARITARIA']),
  indicatorCode: z.string().min(1).max(80),
  value: z.number().finite(),
  effectiveDate: z.coerce.date(),
  label: z.string().max(120).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const propagationPreviewSchema = z.object({
  changeFactor: z.number().min(0.01).max(10),
  indicatorLabel: z.string().min(1).max(120),
});

export async function registerMacroRoutes(app: FastifyInstance): Promise<void> {
  const service = new MacroService();

  app.get('/macro/latest', { preHandler: authenticate }, async () => {
    const data = await service.latest();
    return { data };
  });

  app.get('/macro/history', { preHandler: authenticate }, async (request) => {
    const q = historyQuery.parse(request.query);
    const data = await service.history({
      source: q.source,
      indicatorCode: q.indicator,
      from: q.from,
      to: q.to,
    });
    return { data };
  });

  /**
   * Preview de propagación: el costista ve el impacto ANTES de confirmar.
   * No persiste nada, solo simula.
   */
  app.post('/macro/propagation-preview', { preHandler: authenticate }, async (request) => {
    const { changeFactor, indicatorLabel } = propagationPreviewSchema.parse(request.body);
    const data = await service.propagationPreview(request.authUser!.id, changeFactor, indicatorLabel);
    return { data };
  });

  /**
   * Carga manual de variable macro (paritarias, tarifas, ajustes propios).
   * Registra el snapshot y dispara recálculo automático.
   */
  app.post('/macro/manual-entry', { preHandler: authenticate }, async (request, reply) => {
    const input = manualEntrySchema.parse(request.body);
    const snapshot = await service.recordManual(input);
    return reply.status(201).send({ data: snapshot });
  });

  /**
   * Forzar sincronización BCRA+INDEC inmediata (útil para actualizar manualmente).
   */
  app.post('/macro/sync-now', { preHandler: authenticate }, async (request, reply) => {
    await macroSyncQueue.add('manual-sync', {}, { priority: 1 });
    return reply.send({ data: { queued: true, message: 'Sincronización encolada' } });
  });
}
