import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MacroService } from '../../../application/macro/macro-service.js';
import { authenticate } from '../plugins/authenticate.js';

const historyQuery = z.object({
  source: z.enum(['BCRA', 'INDEC', 'ARCA', 'PARITARIA']).optional(),
  indicator: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
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
}
