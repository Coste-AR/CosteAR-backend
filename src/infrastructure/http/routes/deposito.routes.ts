import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DepositoService } from '../../../application/operacion/deposito-service.js';
import { authenticate } from '../plugins/authenticate.js';
import { depositoCreateSchema, movimientoDepositoCreateSchema } from '../../../shared/schemas/deposito.schema.js';
import { OperatorScopeService } from '../../../application/empresa/operator-scope-service.js';

const companyParams = z.object({ companyId: z.string().uuid() });
const depositoParams = z.object({ depositoId: z.string().uuid() });
const actor = (request: FastifyRequest) => ({ id: request.authUser!.id, role: request.authUser!.role, jobTitle: request.authUser!.jobTitle, area: 'costista', method: 'manual', device: `${request.headers['user-agent'] ?? 'desconocido'} · ${request.ip}` });

export async function registerDepositoRoutes(app: FastifyInstance): Promise<void> {
  const service = new DepositoService();
  const scopes = new OperatorScopeService();
  app.post('/companies/:companyId/depositos', { preHandler: authenticate }, async (request, reply) => {
    const { companyId } = companyParams.parse(request.params);
    const tenantId = request.authUser!.role === 'EMPRESA_OPERATOR'
      ? await scopes.tenantForCompany(request.authUser!.id, companyId, 'inventario.mover')
      : request.authUser!.id;
    return reply.code(201).send({ data: await service.create(tenantId, companyId, depositoCreateSchema.parse(request.body), actor(request)) });
  });
  app.get('/depositos/:depositoId/nivel', { preHandler: authenticate }, async (request) => {
    const { depositoId } = depositoParams.parse(request.params);
    const tenantId = request.authUser!.role === 'EMPRESA_OPERATOR'
      ? await scopes.tenantForDeposito(request.authUser!.id, depositoId, 'inventario.mover')
      : request.authUser!.id;
    return { data: await service.nivel(tenantId, depositoId) };
  });
  app.post('/depositos/:depositoId/movimientos', { preHandler: authenticate }, async (request, reply) => {
    const { depositoId } = depositoParams.parse(request.params);
    const tenantId = request.authUser!.role === 'EMPRESA_OPERATOR'
      ? await scopes.tenantForDeposito(request.authUser!.id, depositoId, 'inventario.mover')
      : request.authUser!.id;
    return reply.code(201).send({ data: await service.movimiento(tenantId, depositoId, movimientoDepositoCreateSchema.parse(request.body), actor(request)) });
  });
}
