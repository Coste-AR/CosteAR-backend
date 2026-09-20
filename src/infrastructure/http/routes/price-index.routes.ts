import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { PriceIndexSeriesService } from '../../../application/parametros/price-index-series-service.js';
import { priceIndexSeriesEnvelopeSchema, savePriceIndexSeriesSchema } from '../../../shared/schemas/price-index.schema.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';
import { authenticate } from '../plugins/authenticate.js';

const paramsSchema = z.object({ companyId: z.string().uuid() });

function actorFrom(request: FastifyRequest) {
  return {
    id: request.authUser!.id,
    role: request.authUser!.role,
    jobTitle: request.authUser!.jobTitle,
    area: 'costista',
    method: 'manual',
    device: `${request.headers['user-agent'] ?? 'desconocido'} · ${request.ip}`,
  };
}

export async function registerPriceIndexRoutes(app: FastifyInstance): Promise<void> {
  app.setSerializerCompiler(serializerCompiler);
  const service = new PriceIndexSeriesService();
  const contract = app.withTypeProvider<ZodTypeProvider>();

  contract.get('/companies/:companyId/price-index-series', {
    preHandler: authenticate,
    schema: { response: { 200: priceIndexSeriesEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => {
    const { companyId } = paramsSchema.parse(request.params);
    return { data: await service.get(request.authUser!.id, companyId) };
  });

  contract.put('/companies/:companyId/price-index-series', {
    preHandler: authenticate,
    schema: { response: { 200: priceIndexSeriesEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => {
    const { companyId } = paramsSchema.parse(request.params);
    const input = savePriceIndexSeriesSchema.parse(request.body);
    return { data: await service.save(request.authUser!.id, companyId, input, actorFrom(request)) };
  });
}
