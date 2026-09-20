import type { FastifyInstance } from 'fastify';
import { serializerCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { OwnerDashboardService } from '../../../application/cost-structures/owner-dashboard-service.js';
import { authenticate } from '../plugins/authenticate.js';
import { ownerDashboardEnvelopeSchema } from '../../../shared/schemas/owner-dashboard.schema.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';

const periodParams = z.object({ id: z.string().uuid() });

export async function registerOwnerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.setSerializerCompiler(serializerCompiler);
  const service = new OwnerDashboardService();
  app.withTypeProvider<ZodTypeProvider>().get(
    '/periods/:id/tablero-dueno',
    {
      preHandler: authenticate,
      schema: { response: { 200: ownerDashboardEnvelopeSchema, ...apiErrorResponses } },
    },
    async (request) => {
      const { id } = periodParams.parse(request.params);
      return { data: await service.get(request.authUser!.id, id) };
    },
  );
}
