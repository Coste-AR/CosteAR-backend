import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ProduccionDiariaService } from '../../../application/operacion/produccion-diaria-service.js';
import { authenticate } from '../plugins/authenticate.js';
import { produccionDiariaCreateSchema } from '../../../shared/schemas/produccion-diaria.schema.js';

const loteParams = z.object({ loteId: z.string().uuid() });
const fechaQuery = z.object({ fecha: z.string().date().optional() });

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

export async function registerProduccionDiariaRoutes(app: FastifyInstance): Promise<void> {
  const service = new ProduccionDiariaService();

  app.get('/lotes/:loteId/producciones', { preHandler: authenticate }, async (request) => {
    const { loteId } = loteParams.parse(request.params);
    const { fecha } = fechaQuery.parse(request.query);
    return { data: await service.list(request.authUser!.id, loteId, fecha) };
  });
  app.post('/lotes/:loteId/producciones', { preHandler: authenticate }, async (request, reply) => {
    const { loteId } = loteParams.parse(request.params);
    const input = produccionDiariaCreateSchema.parse(request.body);
    return reply.code(201).send({ data: await service.create(request.authUser!.id, loteId, input, actorFrom(request)) });
  });
  app.get('/lotes/:loteId/producciones/indicadores', { preHandler: authenticate }, async (request) => {
    const { loteId } = loteParams.parse(request.params);
    const { fecha } = z.object({ fecha: z.string().date() }).parse(request.query);
    return { data: await service.indicadores(request.authUser!.id, loteId, fecha) };
  });
}
