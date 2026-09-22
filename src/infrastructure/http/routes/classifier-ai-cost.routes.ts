import type { FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ClassifierAiCostService } from '../../../application/classifier/classifier-ai-cost-service.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';
import { classifierCostSummaryEnvelopeSchema } from '../../../shared/schemas/classifier-ai-cost.schema.js';
import { authenticate, requireRole } from '../plugins/authenticate.js';

const querySchema = z.object({
  desde: z.coerce.date(),
  hasta: z.coerce.date(),
}).refine(({ desde, hasta }) => desde <= hasta, { message: 'desde debe ser anterior o igual a hasta', path: ['desde'] });

export async function registerClassifierAiCostRoutes(app: FastifyInstance): Promise<void> {
  const service = new ClassifierAiCostService();
  app.withTypeProvider<ZodTypeProvider>().get('/admin/classifier/costos', {
    preHandler: [authenticate, requireRole('SUPER_ADMIN')],
    schema: {
      querystring: querySchema,
      response: { 200: classifierCostSummaryEnvelopeSchema, ...apiErrorResponses },
    },
  }, async (request) => {
    const { desde, hasta } = request.query;
    return {
      data: {
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
        proveedores: await service.summarize(desde, hasta),
      },
    };
  });
}
