import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DesperdicioService } from '../../../application/cost-structures/desperdicio-service.js';
import { authenticate } from '../plugins/authenticate.js';
import {
  desperdicioCreateSchema,
  desperdicioUpdateSchema,
} from '../../../shared/schemas/desperdicio.schema.js';

/**
 * DESPERDICIO DEL PERÍODO (issue #92, regla R5).
 *
 * Por acá entra el dato que el motor ya sabía usar y nunca recibía. Los
 * registros cuelgan del PERÍODO, que es el recorte natural: el desperdicio es
 * de un mes, igual que el costo contra el que se imputa.
 */

const periodParams = z.object({ periodId: z.string().uuid() });
const idParams = z.object({ id: z.string().uuid() });

/** Actor de trazabilidad: rol del JWT, área fija (el costista carga esto), dispositivo. */
function actorFrom(request: FastifyRequest) {
  const ua = request.headers['user-agent'] ?? 'desconocido';
  return {
    id: request.authUser!.id,
    role: request.authUser!.role,
    jobTitle: request.authUser!.jobTitle,
    area: 'costista',
    method: 'manual',
    device: `${ua} · ${request.ip}`,
  };
}

export async function registerDesperdicioRoutes(app: FastifyInstance): Promise<void> {
  const service = new DesperdicioService();

  app.get('/periods/:periodId/desperdicios', { preHandler: authenticate }, async (request) => {
    const { periodId } = periodParams.parse(request.params);
    const data = await service.list(request.authUser!.id, periodId);
    return { data };
  });

  app.post(
    '/periods/:periodId/desperdicios',
    { preHandler: authenticate },
    async (request, reply) => {
      const { periodId } = periodParams.parse(request.params);
      const body = desperdicioCreateSchema.parse(request.body);
      const data = await service.create(request.authUser!.id, periodId, body, actorFrom(request));
      return reply.code(201).send({ data });
    },
  );

  app.patch('/desperdicios/:id', { preHandler: authenticate }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = desperdicioUpdateSchema.parse(request.body);
    const data = await service.update(request.authUser!.id, id, body, actorFrom(request));
    return { data };
  });

  app.delete('/desperdicios/:id', { preHandler: authenticate }, async (request) => {
    const { id } = idParams.parse(request.params);
    // Borrado lógico: devuelve el registro dado de baja, no un 204 mudo, para
    // que la pantalla pueda mostrar qué se sacó.
    const data = await service.remove(request.authUser!.id, id, actorFrom(request));
    return { data };
  });
}
