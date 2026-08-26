import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ActivoAmortizableService } from '../../../application/parametros/activo-amortizable-service.js';
import { authenticate } from '../plugins/authenticate.js';
import {
  activoAmortizableCreateSchema,
  activoAmortizableUpdateSchema,
} from '../../../shared/schemas/activo-amortizable.schema.js';

/**
 * ACTIVOS AMORTIZABLES (issue #116). Alta, baja y consulta del plantel u otro
 * activo que se compra una vez y produce durante meses.
 */

const companyParams = z.object({ companyId: z.string().uuid() });
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

export async function registerActivoAmortizableRoutes(app: FastifyInstance): Promise<void> {
  const service = new ActivoAmortizableService();

  app.get(
    '/companies/:companyId/activos-amortizables',
    { preHandler: authenticate },
    async (request) => {
      const { companyId } = companyParams.parse(request.params);
      const data = await service.list(request.authUser!.id, companyId);
      return { data };
    },
  );

  app.post(
    '/companies/:companyId/activos-amortizables',
    { preHandler: authenticate },
    async (request, reply) => {
      const { companyId } = companyParams.parse(request.params);
      const body = activoAmortizableCreateSchema.parse(request.body);
      const data = await service.create(request.authUser!.id, companyId, body, actorFrom(request));
      return reply.code(201).send({ data });
    },
  );

  app.patch('/activos-amortizables/:id', { preHandler: authenticate }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = activoAmortizableUpdateSchema.parse(request.body);
    const data = await service.update(request.authUser!.id, id, body, actorFrom(request));
    return { data };
  });

  app.delete('/activos-amortizables/:id', { preHandler: authenticate }, async (request) => {
    const { id } = idParams.parse(request.params);
    const data = await service.remove(request.authUser!.id, id, actorFrom(request));
    return { data };
  });
}
