import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrecioTransferenciaService } from '../../../application/parametros/precio-transferencia-service.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';
import { precioTransferenciaEnvelopeSchema, precioTransferenciaQuerySchema } from '../../../shared/schemas/precio-transferencia.schema.js';
import { authenticate } from '../plugins/authenticate.js';

export async function registerPrecioTransferenciaRoutes(app: FastifyInstance): Promise<void> {
  app.setSerializerCompiler(serializerCompiler); app.setValidatorCompiler(validatorCompiler);
  const contract = app.withTypeProvider<ZodTypeProvider>(); const service = new PrecioTransferenciaService();
  contract.get('/companies/:companyId/analisis/precio-transferencia', {
    preHandler: authenticate, schema: { querystring: precioTransferenciaQuerySchema, response: { 200: precioTransferenciaEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => {
    const { companyId } = z.object({ companyId: z.string().uuid() }).parse(request.params);
    return { data: await service.calcular(request.authUser!.id, companyId, precioTransferenciaQuerySchema.parse(request.query)) };
  });
}
