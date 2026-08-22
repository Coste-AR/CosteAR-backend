import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ProcessDepartmentService } from '../../../application/cost-structures/process-costing/process-department-service.js';
import { authenticate } from '../plugins/authenticate.js';
import {
  processDepartmentCreateSchema,
  processDepartmentUpdateSchema,
  processDepartmentReorderSchema,
  processDepartmentDeleteSchema,
} from '../../../shared/schemas/process-department.schema.js';

/**
 * Departamentos de proceso (Costeo por Procesos, B14). Solo aplican a
 * estructuras con `costingSystem = 'PROCESSES'`; el servicio devuelve un 422
 * accionable si se llama sobre una de Ã“rdenes.
 */

const structureParams = z.object({ id: z.string().uuid() });
const departmentParams = z.object({ id: z.string().uuid(), deptId: z.string().uuid() });

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

export async function registerProcessDepartmentRoutes(app: FastifyInstance): Promise<void> {
  const service = new ProcessDepartmentService();
  const base = '/structures/:id/process/departments';

  app.get(base, { preHandler: authenticate }, async (request) => {
    const { id } = structureParams.parse(request.params);
    const data = await service.list(request.authUser!.id, id);
    return { data };
  });

  app.post(base, { preHandler: authenticate }, async (request, reply) => {
    const { id } = structureParams.parse(request.params);
    const body = processDepartmentCreateSchema.parse(request.body);
    const data = await service.create(
      request.authUser!.id,
      id,
      body,
      actorFrom(request, body.sourceArea),
    );
    return reply.code(201).send({ data });
  });

  app.patch(`${base}/:deptId`, { preHandler: authenticate }, async (request) => {
    const { id, deptId } = departmentParams.parse(request.params);
    const body = processDepartmentUpdateSchema.parse(request.body);
    const data = await service.update(
      request.authUser!.id,
      id,
      deptId,
      body,
      actorFrom(request, body.sourceArea),
    );
    return { data };
  });

  app.delete(`${base}/:deptId`, { preHandler: authenticate }, async (request) => {
    const { id, deptId } = departmentParams.parse(request.params);
    const body = processDepartmentDeleteSchema.parse(request.body ?? { sourceArea: 'estructura' });
    const data = await service.remove(
      request.authUser!.id,
      id,
      deptId,
      actorFrom(request, body.sourceArea),
    );
    return { data };
  });

  // El reorden va sobre la cadena entera, no sobre un departamento: por eso
  // cuelga de la colecciÃ³n y no de un id.
  app.put(`${base}/order`, { preHandler: authenticate }, async (request) => {
    const { id } = structureParams.parse(request.params);
    const body = processDepartmentReorderSchema.parse(request.body);
    const data = await service.reorder(
      request.authUser!.id,
      id,
      body.orderedIds,
      actorFrom(request, body.sourceArea),
    );
    return { data };
  });
}
