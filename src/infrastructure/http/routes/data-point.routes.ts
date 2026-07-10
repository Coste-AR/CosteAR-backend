import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DataPointService } from '../../../application/data-points/data-point-service.js';
import { authenticate } from '../plugins/authenticate.js';

const idParam = z.object({ id: z.string().uuid() });

export async function registerDataPointRoutes(app: FastifyInstance): Promise<void> {
  const service = new DataPointService();

  app.get(
    '/data-points/:id/trace',
    { preHandler: authenticate },
    async (request) => {
      const { id } = idParam.parse(request.params);
      const trace = await service.getTrace(id);
      return { data: trace };
    },
  );

  app.get(
    '/data-point-versions/:id/trace',
    { preHandler: authenticate },
    async (request) => {
      const { id } = idParam.parse(request.params);
      const trace = await service.getTraceByVersion(id);
      return { data: trace };
    },
  );
}
