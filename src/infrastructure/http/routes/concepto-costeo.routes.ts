import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ConceptoCosteoService } from '../../../application/parametros/concepto-costeo-service.js';
import { authenticate } from '../plugins/authenticate.js';
import {
  crearConceptoCosteoSchema,
  actualizarConceptoCosteoSchema,
} from '../../../shared/schemas/concepto-costeo.schema.js';

/**
 * CONCEPTOS DE COSTEO (M1-01, plan de análisis marginal v2).
 *
 * Clasificación de costos por debajo de los tres baldes de `ParametroCosteo`.
 * Mismo patrón que `parametros-costeo.routes.ts`, con `id` como identidad en
 * vez de `clave` porque acá `clave` no es un catálogo fijo: varios conceptos
 * de una misma empresa pueden compartir nombre en niveles distintos, y es el
 * `id` de la fila el que no cambia.
 */

const companyParams = z.object({ companyId: z.string().uuid() });
const conceptoParams = z.object({ companyId: z.string().uuid(), id: z.string().uuid() });
const alcanceQuery = z.object({
  structureId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  elemento: z.enum(['MP', 'MOD', 'CIP', 'VENTA']).optional(),
});

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

export async function registerConceptoCosteoRoutes(app: FastifyInstance): Promise<void> {
  const service = new ConceptoCosteoService();

  app.get(
    '/companies/:companyId/conceptos-costeo',
    { preHandler: authenticate },
    async (request) => {
      const { companyId } = companyParams.parse(request.params);
      const { structureId, periodId, elemento } = alcanceQuery.parse(request.query);
      const data = await service.listar(request.authUser!.id, companyId, { structureId, periodId, elemento });
      return { data };
    },
  );

  app.post(
    '/companies/:companyId/conceptos-costeo',
    { preHandler: authenticate },
    async (request, reply) => {
      const { companyId } = companyParams.parse(request.params);
      const body = crearConceptoCosteoSchema.parse(request.body);
      const data = await service.crear(request.authUser!.id, companyId, body, actorFrom(request));
      reply.code(201);
      return { data };
    },
  );

  app.put(
    '/companies/:companyId/conceptos-costeo/:id',
    { preHandler: authenticate },
    async (request) => {
      const { companyId, id } = conceptoParams.parse(request.params);
      const body = actualizarConceptoCosteoSchema.parse(request.body);
      const data = await service.actualizar(request.authUser!.id, companyId, id, body, actorFrom(request));
      return { data };
    },
  );

  app.delete(
    '/companies/:companyId/conceptos-costeo/:id',
    { preHandler: authenticate },
    async (request) => {
      const { companyId, id } = conceptoParams.parse(request.params);
      await service.eliminar(request.authUser!.id, companyId, id, actorFrom(request));
      return { data: null };
    },
  );
}
