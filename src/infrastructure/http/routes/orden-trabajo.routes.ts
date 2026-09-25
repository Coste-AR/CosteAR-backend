import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { OrdenTrabajoService } from '../../../application/ordenes/orden-trabajo-service.js';
import { etapasOrdenEnvelopeSchema, ordenTrabajoCreateSchema, ordenTrabajoEnvelopeSchema, ordenesTrabajoEnvelopeSchema, ordenTrabajoTransitionSchema, plantillasOrdenEnvelopeSchema } from '../../../shared/schemas/orden-trabajo.schema.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';
import { authenticate } from '../plugins/authenticate.js';

const companyParams = z.object({ companyId: z.string().uuid() });
const idParams = z.object({ id: z.string().uuid() });
const actorFrom = (request: FastifyRequest) => ({
  id: request.authUser!.id, role: request.authUser!.role, jobTitle: request.authUser!.jobTitle,
  area: 'costista', method: 'manual', device: `${request.headers['user-agent'] ?? 'desconocido'} · ${request.ip}`,
});

export async function registerOrdenTrabajoRoutes(app: FastifyInstance): Promise<void> {
  app.setSerializerCompiler(serializerCompiler);
  app.setValidatorCompiler(validatorCompiler);
  const contract = app.withTypeProvider<ZodTypeProvider>();
  const service = new OrdenTrabajoService();
  contract.post('/companies/:companyId/ordenes-trabajo', {
    preHandler: authenticate, schema: { body: ordenTrabajoCreateSchema, response: { 201: ordenTrabajoEnvelopeSchema, ...apiErrorResponses } },
  }, async (request, reply) => {
    const { companyId } = companyParams.parse(request.params);
    const data = await service.create(request.authUser!.id, companyId, ordenTrabajoCreateSchema.parse(request.body), actorFrom(request));
    return reply.code(201).send({ data });
  });
  contract.get('/companies/:companyId/ordenes-trabajo', { preHandler: authenticate, schema: { response: { 200: ordenesTrabajoEnvelopeSchema, ...apiErrorResponses } } }, async (request) => {
    const { companyId } = companyParams.parse(request.params);
    return { data: await service.list(request.authUser!.id, companyId) };
  });
  contract.get('/companies/:companyId/plantillas-orden', { preHandler: authenticate, schema: { response: { 200: plantillasOrdenEnvelopeSchema, ...apiErrorResponses } } }, async (request) => {
    const { companyId } = companyParams.parse(request.params);
    return { data: await service.listTemplates(request.authUser!.id, companyId) };
  });
  contract.get('/ordenes-trabajo/:id', { preHandler: authenticate, schema: { response: { 200: ordenTrabajoEnvelopeSchema, ...apiErrorResponses } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await service.get(request.authUser!.id, id) };
  });
  contract.get('/ordenes-trabajo/:id/etapas', { preHandler: authenticate, schema: { response: { 200: etapasOrdenEnvelopeSchema, ...apiErrorResponses } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await service.listStages(request.authUser!.id, id) };
  });
  contract.post('/ordenes-trabajo/:id/transiciones', {
    preHandler: authenticate, schema: { body: ordenTrabajoTransitionSchema, response: { 200: ordenTrabajoEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await service.transition(request.authUser!.id, id, ordenTrabajoTransitionSchema.parse(request.body), actorFrom(request)) };
  });
}
