import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { JointCostService } from '../../../application/cost-structures/process-costing/joint-cost-service.js';
import { authenticate } from '../plugins/authenticate.js';
import { jointCostInputSchema } from '../../../shared/schemas/joint-cost.schema.js';

/**
 * Reparto de costos conjuntos (Costeo por Procesos, B16). Solo aplica a
 * estructuras con `costingSystem = 'PROCESSES'`; el servicio devuelve un 422
 * accionable si se llama sobre una de Ã“rdenes.
 *
 * El path se scopea por estructura + perÃ­odo; el departamento (punto de
 * separaciÃ³n) viaja como query en el GET y en el body del PUT â€” ver DECISIONES.md
 * (B16). Un reparto es Ãºnico por departamento + perÃ­odo.
 */

const routeParams = z.object({
  id: z.string().uuid(),
  periodId: z.string().uuid(),
});

const getQuery = z.object({ deptId: z.string().uuid() });

/** Actor de trazabilidad: rol del JWT, Ã¡rea del body, dispositivo de la request. */
function actorFrom(request: FastifyRequest, area: string) {
  const ua = request.headers['user-agent'] ?? 'desconocido';
  return {
    id: request.authUser!.id,
    role: request.authUser!.role,
    // El puesto declarado, para estamparlo en la version del dato (I5c).
    jobTitle: request.authUser!.jobTitle,
    area,
    device: `${ua} Â· ${request.ip}`,
  };
}

export async function registerJointCostRoutes(app: FastifyInstance): Promise<void> {
  const service = new JointCostService();
  const base = '/structures/:id/process/periods/:periodId/joint-costs';

  app.get(base, { preHandler: authenticate }, async (request) => {
    const { id, periodId } = routeParams.parse(request.params);
    const { deptId } = getQuery.parse(request.query);
    const data = await service.get(request.authUser!.id, id, deptId, periodId);
    return { data };
  });

  app.put(base, { preHandler: authenticate }, async (request) => {
    const { id, periodId } = routeParams.parse(request.params);
    const body = jointCostInputSchema.parse(request.body);
    const data = await service.save(
      request.authUser!.id,
      id,
      body.deptId,
      periodId,
      body,
      actorFrom(request, body.sourceArea),
    );
    return { data };
  });
}
