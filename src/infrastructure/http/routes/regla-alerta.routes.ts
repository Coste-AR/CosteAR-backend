import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ReglaAlertaService } from '../../../application/alerts/regla-alerta-service.js';
import { authenticate } from '../plugins/authenticate.js';
import {
  evaluarReglaAlertaSchema,
  reglaAlertaCreateSchema,
  reglaAlertaUpdateSchema,
} from '../../../shared/schemas/regla-alerta.schema.js';

const companyParams = z.object({ companyId: z.string().uuid() });
const ruleParams = z.object({ companyId: z.string().uuid(), id: z.string().uuid() });
const listQuery = z.object({ structureId: z.string().uuid().optional() });

function actorFrom(request: FastifyRequest) {
  return {
    id: request.authUser!.id,
    role: request.authUser!.role,
    jobTitle: request.authUser!.jobTitle,
    area: 'costista',
    method: 'manual',
    device: `${request.headers['user-agent'] ?? 'desconocido'} · ${request.ip}`,
  };
}

export async function registerReglaAlertaRoutes(app: FastifyInstance): Promise<void> {
  const service = new ReglaAlertaService();

  app.get('/companies/:companyId/alert-rules', { preHandler: authenticate }, async (request) => {
    const { companyId } = companyParams.parse(request.params);
    const { structureId } = listQuery.parse(request.query);
    return { data: await service.listar(request.authUser!.id, companyId, structureId) };
  });

  app.post('/companies/:companyId/alert-rules', { preHandler: authenticate }, async (request, reply) => {
    const { companyId } = companyParams.parse(request.params);
    const input = reglaAlertaCreateSchema.parse(request.body);
    const data = await service.crear(request.authUser!.id, companyId, input, actorFrom(request));
    return reply.code(201).send({ data });
  });

  app.patch('/companies/:companyId/alert-rules/:id', { preHandler: authenticate }, async (request) => {
    const { companyId, id } = ruleParams.parse(request.params);
    const input = reglaAlertaUpdateSchema.parse(request.body);
    const data = await service.actualizar(request.authUser!.id, companyId, id, input, actorFrom(request));
    return { data };
  });

  app.post('/companies/:companyId/alert-rules/:id/evaluate', { preHandler: authenticate }, async (request) => {
    const { companyId, id } = ruleParams.parse(request.params);
    const input = evaluarReglaAlertaSchema.parse(request.body);
    const data = await service.evaluar(request.authUser!.id, companyId, id, input, actorFrom(request));
    return { data };
  });
}
