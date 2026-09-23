import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { PuntoIndiferenciaService } from '../../../application/parametros/punto-indiferencia-service.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';
import { puntoIndiferenciaEnvelopeSchema, puntoIndiferenciaInputSchema } from '../../../shared/schemas/punto-indiferencia.schema.js';
import { authenticate } from '../plugins/authenticate.js';

const paramsSchema = z.object({ companyId: z.string().uuid() });

export async function registerPuntoIndiferenciaRoutes(app: FastifyInstance): Promise<void> {
  app.setSerializerCompiler(serializerCompiler);
  app.setValidatorCompiler(validatorCompiler);
  const contract = app.withTypeProvider<ZodTypeProvider>();
  const service = new PuntoIndiferenciaService();
  contract.post('/companies/:companyId/analisis/punto-indiferencia', {
    preHandler: authenticate,
    schema: {
      body: puntoIndiferenciaInputSchema,
      response: { 200: puntoIndiferenciaEnvelopeSchema, ...apiErrorResponses },
    },
  }, async (request) => {
    const { companyId } = paramsSchema.parse(request.params);
    return { data: await service.calcular(request.authUser!.id, companyId, request.body) };
  });
}
