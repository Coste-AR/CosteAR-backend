import type { FastifyInstance } from 'fastify';
import { serializerCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { UserPreferencesService } from '../../../application/users/user-preferences-service.js';
import {
  userPreferencesEnvelopeSchema,
  userPreferencesSchema,
  widgetCatalogEnvelopeSchema,
} from '../../../shared/schemas/user-preferences.schema.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';
import { authenticate, auditContext } from '../plugins/authenticate.js';

export async function registerUserPreferencesRoutes(app: FastifyInstance): Promise<void> {
  app.setSerializerCompiler(serializerCompiler);
  const contract = app.withTypeProvider<ZodTypeProvider>();
  const service = new UserPreferencesService();

  contract.get('/me/preferencias', {
    preHandler: authenticate,
    schema: { response: { 200: userPreferencesEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => ({ data: await service.get(request.authUser!.id) }));

  contract.get('/me/preferencias/catalogo', {
    preHandler: authenticate,
    schema: { response: { 200: widgetCatalogEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => ({ data: await service.catalogo(request.authUser!.id) }));

  contract.put('/me/preferencias', {
    preHandler: authenticate,
    schema: {
      body: userPreferencesSchema,
      response: { 200: userPreferencesEnvelopeSchema, ...apiErrorResponses },
    },
  }, async (request) => {
    return { data: await service.save(request.authUser!.id, request.body, auditContext(request)) };
  });
}
