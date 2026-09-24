import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ModulosRubroService } from '../../../application/operacion/modulos-rubro-service.js';
import { authenticate } from '../plugins/authenticate.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';
import { modulosRubroEnvelopeSchema } from '../../../shared/schemas/modulos-rubro.schema.js';

const companyParams = z.object({ companyId: z.string().uuid() });
const moduleParams = companyParams.extend({ moduleId: z.string().min(1).max(120) });
const estadoModuloSchema = z.object({ activo: z.boolean() });

function actorFrom(request: FastifyRequest) {
  const ua = request.headers['user-agent'] ?? 'desconocido';
  return { id: request.authUser!.id, role: request.authUser!.role, jobTitle: request.authUser!.jobTitle, area: 'costista', method: 'manual', device: `${ua} · ${request.ip}` };
}

export async function registerModulosRubroRoutes(app: FastifyInstance): Promise<void> {
  const service = new ModulosRubroService();
  app.withTypeProvider<ZodTypeProvider>().get(
    '/companies/:companyId/modulos-rubro',
    {
      preHandler: authenticate,
      schema: {
        params: companyParams,
        response: { 200: modulosRubroEnvelopeSchema, ...apiErrorResponses },
      },
    },
    async (request) => ({ data: await service.listar(request.authUser!.id, request.params.companyId) }),
  );
  app.put('/companies/:companyId/modulos-rubro/:moduleId', { preHandler: authenticate }, async (request) => {
    const { companyId, moduleId } = moduleParams.parse(request.params);
    const { activo } = estadoModuloSchema.parse(request.body);
    return { data: await service.set(request.authUser!.id, companyId, moduleId, activo, actorFrom(request)) };
  });
}
