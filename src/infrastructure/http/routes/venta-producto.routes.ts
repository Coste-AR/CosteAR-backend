import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { VentaProductoService } from '../../../application/operacion/venta-producto-service.js';
import { ventaProductoCreateSchema } from '../../../shared/schemas/venta-producto.schema.js';
import { authenticate } from '../plugins/authenticate.js';

const structureParams = z.object({ structureId: z.string().uuid() });
const periodParams = z.object({ periodId: z.string().uuid() });
const promedioQuery = z.object({ unidadId: z.string().uuid() });

function actorFrom(request: FastifyRequest) {
  return { id: request.authUser!.id, role: request.authUser!.role, area: 'costista', method: 'manual' } as const;
}

export async function registerVentaProductoRoutes(app: FastifyInstance): Promise<void> {
  const service = new VentaProductoService();
  app.post('/cost-structures/:structureId/ventas-producto', { preHandler: authenticate }, async (request, reply) => {
    const { structureId } = structureParams.parse(request.params);
    const input = ventaProductoCreateSchema.parse(request.body);
    return reply.code(201).send({ data: await service.create(request.authUser!.id, structureId, input, actorFrom(request)) });
  });
  app.get('/periods/:periodId/precio-promedio-venta', { preHandler: authenticate }, async (request) => {
    const { periodId } = periodParams.parse(request.params);
    const { unidadId } = promedioQuery.parse(request.query);
    return { data: await service.precioPromedio(request.authUser!.id, periodId, unidadId) };
  });
}
