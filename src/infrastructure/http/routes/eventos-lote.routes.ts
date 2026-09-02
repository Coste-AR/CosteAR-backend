import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { EventosLoteService } from '../../../application/operacion/eventos-lote-service.js';
import { authenticate } from '../plugins/authenticate.js';
import { eventoLoteCreateSchema } from '../../../shared/schemas/eventos-lote.schema.js';

const loteParams = z.object({ loteId: z.string().uuid() });

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

export async function registerEventosLoteRoutes(app: FastifyInstance): Promise<void> {
  const service = new EventosLoteService();

  app.get('/lotes/:loteId/eventos', { preHandler: authenticate }, async (request) => {
    const { loteId } = loteParams.parse(request.params);
    return { data: await service.list(request.authUser!.id, loteId) };
  });

  app.post('/lotes/:loteId/eventos', { preHandler: authenticate }, async (request, reply) => {
    const { loteId } = loteParams.parse(request.params);
    const body = eventoLoteCreateSchema.parse(request.body);
    return reply.code(201).send({ data: await service.create(request.authUser!.id, loteId, body, actorFrom(request)) });
  });

  app.get('/lotes/:loteId/poblacion', { preHandler: authenticate }, async (request) => {
    const { loteId } = loteParams.parse(request.params);
    return { data: await service.poblacion(request.authUser!.id, loteId) };
  });
}
