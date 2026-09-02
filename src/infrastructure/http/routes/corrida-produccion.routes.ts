import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CorridaProduccionService } from '../../../application/operacion/corrida-produccion-service.js';
import { authenticate } from '../plugins/authenticate.js';
import { corridaCreateSchema, consumoCreateSchema } from '../../../shared/schemas/corrida-produccion.schema.js';
const companyParams = z.object({ companyId: z.string().uuid() });
const corridaParams = z.object({ corridaId: z.string().uuid() });
const actor = (r: FastifyRequest) => ({ id: r.authUser!.id, role: r.authUser!.role, jobTitle: r.authUser!.jobTitle, area: 'costista', method: 'manual', device: `${r.headers['user-agent'] ?? 'desconocido'} · ${r.ip}` });
export async function registerCorridaProduccionRoutes(app: FastifyInstance): Promise<void> {
  const service = new CorridaProduccionService();
  app.post('/companies/:companyId/corridas-produccion', { preHandler: authenticate }, async (request, reply) => { const { companyId } = companyParams.parse(request.params); return reply.code(201).send({ data: await service.create(request.authUser!.id, companyId, corridaCreateSchema.parse(request.body), actor(request)) }); });
  app.post('/corridas-produccion/:corridaId/consumos', { preHandler: authenticate }, async (request, reply) => { const { corridaId } = corridaParams.parse(request.params); return reply.code(201).send({ data: await service.consumo(request.authUser!.id, corridaId, consumoCreateSchema.parse(request.body), actor(request)) }); });
  app.get('/corridas-produccion/:corridaId/resultado', { preHandler: authenticate }, async (request) => { const { corridaId } = corridaParams.parse(request.params); return { data: await service.resultado(request.authUser!.id, corridaId) }; });
}
