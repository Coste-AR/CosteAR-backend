import type { FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MacroService } from '../../../application/macro/macro-service.js';
import { IndicadoresMacroService } from '../../../application/macro/indicadores-macro-service.js';
import { authenticate } from '../plugins/authenticate.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';
import { indicadoresMacroEnvelopeSchema } from '../../../shared/schemas/indicador-macro.schema.js';

const historyQuery = z.object({
  source: z.enum(['BCRA', 'INDEC', 'ARCA', 'PARITARIA', 'DOLARAPI', 'CAPIA']).optional(),
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

const companyParams = z.object({ companyId: z.string().uuid() });

export async function registerMacroRoutes(app: FastifyInstance): Promise<void> {
  const service = new MacroService();
  const indicadoresService = new IndicadoresMacroService();

  app.withTypeProvider<ZodTypeProvider>().get(
    '/companies/:companyId/indicadores-macro',
    {
      preHandler: authenticate,
      schema: {
        params: companyParams,
        response: { 200: indicadoresMacroEnvelopeSchema, ...apiErrorResponses },
      },
    },
    async (request) => ({
      data: await indicadoresService.listar(request.authUser!.id, request.params.companyId),
    }),
  );

  /**
   * PÚBLICO (sin auth): métricas de la vitrina de la landing.
   * Solo expone dólar blue e IPC mensual, que son datos públicos.
   */
  app.get('/macro/landing', async () => {
    const data = await service.landingMetrics();
    return { data };
  });

  app.get('/macro/latest', { preHandler: authenticate }, async () => {
    const data = await service.latest();
    return { data };
  });

  app.get('/indicadores/capia/vigentes', { preHandler: authenticate }, async () => {
    const data = await service.latestCapia();
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
   *
   * A propósito, cualquier costista autenticado puede llamar esto — es una
   * pantalla colaborativa real (ver MacroPage.tsx en el frontend): cualquiera
   * puede cargar una paritaria o forzar un sync de BCRA/INDEC para que se
   * beneficien todos. MacroSnapshot es una tabla global, así que "cualquier
   * costista puede escribir estado compartido" ES el diseño, no un descuido.
   * Quedó marcado en la auditoría de aislamiento como caso ambiguo; se
   * revisó el uso real en el frontend y se confirma que es intencional — no
   * se restringe a SUPER_ADMIN.
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
    const { macroSyncQueue } = await import('../../workers/queues.js');
    await macroSyncQueue.add('manual-sync', {}, { priority: 1 });
    return reply.send({ data: { queued: true, message: 'Sincronización encolada' } });
  });
}
