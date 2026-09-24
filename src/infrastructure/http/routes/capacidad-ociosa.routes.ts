import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../plugins/authenticate.js';
import { CapacidadOciosaService } from '../../../application/parametros/capacidad-ociosa-service.js';
import { capacidadOciosaEnvelopeSchema } from '../../../shared/schemas/capacidad-ociosa.schema.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';

const paramsSchema = z.object({ companyId: z.string().uuid() });

export async function registerCapacidadOciosaRoutes(app: FastifyInstance): Promise<void> {
  app.setSerializerCompiler(serializerCompiler);
  app.setValidatorCompiler(validatorCompiler);
  const contract = app.withTypeProvider<ZodTypeProvider>();
  const service = new CapacidadOciosaService();
  contract.get('/companies/:companyId/analisis/capacidad-ociosa', {
    preHandler: authenticate,
    schema: { response: { 200: capacidadOciosaEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => {
    const { companyId } = paramsSchema.parse(request.params);
    return { data: await service.calcular(request.authUser!.id, companyId) };
  });
}
