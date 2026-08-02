import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ProcessSetupService } from '../../../application/cost-structures/process-costing/process-setup-service.js';
import { authenticate } from '../plugins/authenticate.js';

/**
 * Setup previo obligatorio de Costeo por Procesos (el "CTO inicial").
 *
 * Tres endpoints, y el del medio es el que hace la diferencia: `preview` valida
 * SIN guardar, para que el wizard muestre los problemas y los avisos mientras el
 * costista arma su estructura. El "¿qué pasa si hago esto?" que pidió el equipo
 * tiene que llegar antes de apretar, no después.
 */

const structureParams = z.object({ id: z.string().uuid() });

const setupSchema = z.object({
  departments: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Cada departamento necesita un nombre.'),
        sequence: z.number().int().min(1),
      }),
    )
    .min(1, 'Agregá al menos un departamento.'),
  hasJointProducts: z.boolean().default(false),
  wipCountFrequencyDays: z.number().int().min(1).max(366).nullable().optional(),
  periodLengthDays: z.number().int().min(1).max(366).nullable().optional(),
  wipReporterMembershipIds: z.array(z.string().uuid()).optional(),
});

function actorFrom(request: FastifyRequest, area: string) {
  const ua = request.headers['user-agent'] ?? 'desconocido';
  return {
    id: request.authUser!.id,
    role: request.authUser!.role,
    area,
    device: `${ua} · ${request.ip}`,
  };
}

export async function registerProcessSetupRoutes(app: FastifyInstance): Promise<void> {
  const service = new ProcessSetupService();

  // Lo que el wizard necesita para armarse: estado, departamentos ya cargados y
  // qué operarios pueden marcarse como oficina técnica.
  app.get('/structures/:id/process-setup', { preHandler: authenticate }, async (request) => {
    const { id } = structureParams.parse(request.params);
    return { data: await service.getSetup(request.authUser!.id, id) };
  });

  // Valida sin guardar. Devuelve `problemas` (bloquean) y `avisos` (no).
  // La distinción es deliberada: bloquear lo que es una mala idea pero no un
  // error deja al costista sin salida cuando su caso es legítimo.
  app.post('/structures/:id/process-setup/preview', { preHandler: authenticate }, async (request) => {
    structureParams.parse(request.params);
    const input = setupSchema.parse(request.body);
    return { data: service.preview(input) };
  });

  app.post('/structures/:id/process-setup', { preHandler: authenticate }, async (request) => {
    const { id } = structureParams.parse(request.params);
    const input = setupSchema.parse(request.body);
    const result = await service.complete(
      request.authUser!.id,
      id,
      input,
      actorFrom(request, 'costista'),
    );
    return { data: result };
  });
}
