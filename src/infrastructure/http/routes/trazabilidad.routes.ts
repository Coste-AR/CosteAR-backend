import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DataPointService } from '../../../application/trazabilidad/data-point-service.js';
import { CalculationRunService } from '../../../application/cost-structures/calculation-run-service.js';
import { authenticate } from '../plugins/authenticate.js';
import {
  createDataPointSchema,
  addVersionSchema,
  validateDataPointSchema,
  requestRevisionSchema,
  imputacionSchema,
} from '../../../shared/schemas/trazabilidad.schema.js';

const idParam = z.object({ id: z.string().uuid() });
const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
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

export async function registerTrazabilidadRoutes(app: FastifyInstance): Promise<void> {
  const service = new DataPointService();
  const runService = new CalculationRunService();

  app.post('/structures/:id/calculate', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const result = await runService.calculate(request.authUser!.id, id, actorFrom(request, 'costista'));
    return {
      data: {
        runId: result.run.id,
        runN: result.run.runN,
        results: result.results,
        tree: result.tree,
      },
    };
  });

  app.get('/calculation-runs/:id/tree', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const tree = await runService.getTree(request.authUser!.id, id);
    return { data: tree };
  });

  app.get('/structures/:id/runs', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const runs = await runService.listRuns(request.authUser!.id, id);
    return { data: runs };
  });

  // Crear un data point (bootstrap de un dato nuevo — la spec no numera este
  // endpoint explícitamente, pero sin él /versions no tiene sobre qué
  // corregir; ver DECISIONES.md).
  app.post('/structures/:id/data-points', { preHandler: authenticate }, async (request, reply) => {
    const { id: structureId } = idParam.parse(request.params);
    const input = createDataPointSchema.parse(request.body);
    const dp = await service.create(
      request.authUser!.id,
      structureId,
      input,
      actorFrom(request, input.sourceArea),
    );
    return reply.status(201).send({ data: dp });
  });

  app.get('/data-points/:id/trace', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const trace = await service.getTrace(request.authUser!.id, id);
    return { data: trace };
  });

  app.post('/data-points/:id/versions', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const input = addVersionSchema.parse(request.body);
    const result = await service.addVersion(
      request.authUser!.id,
      id,
      input,
      actorFrom(request, input.sourceArea),
    );
    return { data: result };
  });

  app.post('/data-points/:id/validate', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { sourceArea } = validateDataPointSchema.parse(request.body);
    const dp = await service.validate(
      request.authUser!.id,
      id,
      sourceArea,
      actorFrom(request, sourceArea),
    );
    return { data: dp };
  });

  app.post('/data-points/:id/pedir-revision', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { sourceArea, comment } = requestRevisionSchema.parse(request.body);
    await service.requestRevision(
      request.authUser!.id,
      id,
      comment,
      sourceArea,
      actorFrom(request, sourceArea),
    );
    return { data: { ok: true } };
  });

  app.post('/data-points/:id/imputacion', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { sourceArea, periodo } = imputacionSchema.parse(request.body);
    const dp = await service.imputar(
      request.authUser!.id,
      id,
      periodo,
      sourceArea,
      actorFrom(request, sourceArea),
    );
    return { data: dp };
  });

  app.get('/structures/:id/audit', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { page, pageSize } = paginationQuery.parse(request.query);
    const audit = await service.getAudit(request.authUser!.id, id, page, pageSize);
    return { data: audit };
  });
}
