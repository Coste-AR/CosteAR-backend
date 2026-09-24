import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { MezclaOptimaService } from '../../../application/parametros/mezcla-optima-service.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';
import { mezclaOptimaEnvelopeSchema } from '../../../shared/schemas/mezcla-optima.schema.js';
import { authenticate } from '../plugins/authenticate.js';

const companyParams = z.object({ companyId: z.string().uuid() });

export async function registerMezclaOptimaRoutes(app: FastifyInstance): Promise<void> {
  app.setSerializerCompiler(serializerCompiler);
  app.setValidatorCompiler(validatorCompiler);
  const contract = app.withTypeProvider<ZodTypeProvider>();
  const service = new MezclaOptimaService();
  contract.get('/companies/:companyId/analisis/mezcla-optima', {
    preHandler: authenticate,
    schema: { response: { 200: mezclaOptimaEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => {
    const { companyId } = companyParams.parse(request.params);
    return { data: await service.calcular(request.authUser!.id, companyId) };
  });
}
