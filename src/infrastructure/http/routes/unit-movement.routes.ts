import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { UnitMovementService } from '../../../application/cost-structures/process-costing/unit-movement-service.js';
import { authenticate } from '../plugins/authenticate.js';
import { unitMovementInputSchema } from '../../../shared/schemas/unit-movement.schema.js';

/**
 * Cuadro de movimiento de unidades (Costeo por Procesos, B15). Solo aplica a
 * estructuras con `costingSystem = 'PROCESSES'`; el servicio devuelve un 422
 * accionable si se llama sobre una de Órdenes.
 */

const movementParams = z.object({
  id: z.string().uuid(),
  deptId: z.string().uuid(),
  periodId: z.string().uuid(),
});

/** Actor de trazabilidad: rol del JWT, área del body, dispositivo de la request. */
function actorFrom(request: FastifyRequest, area: string) {
  const ua = request.headers['user-agent'] ?? 'desconocido';
  return {
    id: request.authUser!.id,
    role: request.authUser!.role,
    area,
    device: `${ua} · ${request.ip}`,
  };
}

export async function registerUnitMovementRoutes(app: FastifyInstance): Promise<void> {
  const service = new UnitMovementService();
  const base = '/structures/:id/process/departments/:deptId/periods/:periodId';

  app.get(`${base}/movement`, { preHandler: authenticate }, async (request) => {
    const { id, deptId, periodId } = movementParams.parse(request.params);
    const data = await service.get(request.authUser!.id, id, deptId, periodId);
    return { data };
  });

  app.put(`${base}/movement`, { preHandler: authenticate }, async (request) => {
    const { id, deptId, periodId } = movementParams.parse(request.params);
    const body = unitMovementInputSchema.parse(request.body);
    const data = await service.save(
      request.authUser!.id,
      id,
      deptId,
      periodId,
      body,
      actorFrom(request, body.sourceArea),
    );
    return { data };
  });

  app.get(`${base}/equivalent-production`, { preHandler: authenticate }, async (request) => {
    const { id, deptId, periodId } = movementParams.parse(request.params);
    const data = await service.getEquivalentProduction(request.authUser!.id, id, deptId, periodId);
    return { data };
  });
}
