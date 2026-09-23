import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { PlaneamientoResultadosService } from '../../../application/parametros/planeamiento-resultados-service.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';
import { planeamientoResultadosEnvelopeSchema, planeamientoResultadosInputSchema } from '../../../shared/schemas/planeamiento-resultados.schema.js';
import { authenticate } from '../plugins/authenticate.js';

const paramsSchema = z.object({ companyId: z.string().uuid() });

export async function registerPlaneamientoResultadosRoutes(app: FastifyInstance): Promise<void> {
  app.setSerializerCompiler(serializerCompiler);
  app.setValidatorCompiler(validatorCompiler);
  const contract = app.withTypeProvider<ZodTypeProvider>();
  const service = new PlaneamientoResultadosService();
  contract.post('/companies/:companyId/analisis/planeamiento-resultados', {
    preHandler: authenticate,
    schema: { body: planeamientoResultadosInputSchema, response: { 200: planeamientoResultadosEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => {
    const { companyId } = paramsSchema.parse(request.params);
    return { data: await service.calcular(request.authUser!.id, companyId, request.body) };
  });
}
