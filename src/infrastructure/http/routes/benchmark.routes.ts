import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../plugins/authenticate.js';
import { BenchmarkService } from '../../../application/benchmarks/benchmark-service.js';

export async function registerBenchmarkRoutes(app: FastifyInstance): Promise<void> {
  const service = new BenchmarkService();

  app.get(
    '/benchmarks/general',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const result = await service.getGeneralBenchmark();
      if (!result) return reply.status(404).send({ error: 'No data available' });
      return reply.status(200).send({ data: result });
    },
  );

  app.get(
    '/benchmarks/:industry',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const params = z.object({ industry: z.string().min(1) }).parse(request.params);
      const result = await service.getIndustryBenchmark(params.industry);
      if (!result) return reply.status(404).send({ error: 'No data available for this industry' });
      return reply.status(200).send({ data: result });
    },
  );
}
