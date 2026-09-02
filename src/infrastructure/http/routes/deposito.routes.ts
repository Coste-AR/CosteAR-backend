import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DepositoService } from '../../../application/operacion/deposito-service.js';
import { authenticate } from '../plugins/authenticate.js';
import { depositoCreateSchema, movimientoDepositoCreateSchema } from '../../../shared/schemas/deposito.schema.js';

const companyParams = z.object({ companyId: z.string().uuid() });
const depositoParams = z.object({ depositoId: z.string().uuid() });
const actor = (request: FastifyRequest) => ({ id: request.authUser!.id, role: request.authUser!.role, jobTitle: request.authUser!.jobTitle, area: 'costista', method: 'manual', device: `${request.headers['user-agent'] ?? 'desconocido'} · ${request.ip}` });

export async function registerDepositoRoutes(app: FastifyInstance): Promise<void> {
  const service = new DepositoService();
  app.post('/companies/:companyId/depositos', { preHandler: authenticate }, async (request, reply) => {
    const { companyId } = companyParams.parse(request.params);
    return reply.code(201).send({ data: await service.create(request.authUser!.id, companyId, depositoCreateSchema.parse(request.body), actor(request)) });
  });
  app.get('/depositos/:depositoId/nivel', { preHandler: authenticate }, async (request) => {
    const { depositoId } = depositoParams.parse(request.params);
    return { data: await service.nivel(request.authUser!.id, depositoId) };
  });
  app.post('/depositos/:depositoId/movimientos', { preHandler: authenticate }, async (request, reply) => {
    const { depositoId } = depositoParams.parse(request.params);
    return reply.code(201).send({ data: await service.movimiento(request.authUser!.id, depositoId, movimientoDepositoCreateSchema.parse(request.body), actor(request)) });
  });
}
