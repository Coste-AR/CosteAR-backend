import type { FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { TelemetriaPanelService } from '../../../application/telemetria/telemetria-panel-service.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';
import {
  telemetriaPanelCreateSchema,
  telemetriaPanelEnvelopeSchema,
} from '../../../shared/schemas/telemetria-panel.schema.js';
import { authenticate } from '../plugins/authenticate.js';

const companyParams = z.object({ companyId: z.string().uuid() });

export async function registerTelemetriaPanelRoutes(app: FastifyInstance): Promise<void> {
  const service = new TelemetriaPanelService();
  app.withTypeProvider<ZodTypeProvider>().post(
    '/companies/:companyId/telemetria-panel',
    {
      preHandler: authenticate,
      schema: {
        params: companyParams,
        body: telemetriaPanelCreateSchema,
        response: { 201: telemetriaPanelEnvelopeSchema, ...apiErrorResponses },
      },
    },
    async (request, reply) => {
      const { companyId } = request.params;
      const data = await service.registrar(companyId, request.authUser!, request.body);
      return reply.code(201).send({ data });
    },
  );
}
