import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { RelacionReemplazoService } from '../../../application/parametros/relacion-reemplazo-service.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';
import { relacionReemplazoEnvelopeSchema, relacionReemplazoInputSchema } from '../../../shared/schemas/relacion-reemplazo.schema.js';
import { authenticate } from '../plugins/authenticate.js';

const paramsSchema = z.object({ companyId: z.string().uuid() });

export async function registerRelacionReemplazoRoutes(app: FastifyInstance): Promise<void> {
  app.setSerializerCompiler(serializerCompiler);
  app.setValidatorCompiler(validatorCompiler);
  const contract = app.withTypeProvider<ZodTypeProvider>();
  const service = new RelacionReemplazoService();

  contract.post('/companies/:companyId/analisis/relacion-reemplazo', {
    preHandler: authenticate,
    schema: {
      body: relacionReemplazoInputSchema,
      response: { 200: relacionReemplazoEnvelopeSchema, ...apiErrorResponses },
    },
  }, async (request) => {
    const { companyId } = paramsSchema.parse(request.params);
    return { data: await service.calcular(request.authUser!.id, companyId, request.body) };
  });
}
