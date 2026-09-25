import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../plugins/authenticate.js';
import { SegmentoAnalisisService } from '../../../application/parametros/segmento-analisis-service.js';
import { actualizarSegmentoAnalisisSchema, crearRotacionSegmentoSchema, crearSegmentoAnalisisSchema, equilibrioSectorialEnvelopeSchema, rankingRotacionEnvelopeSchema, rotacionSegmentoEnvelopeSchema, segmentoEliminadoEnvelopeSchema, segmentoEnvelopeSchema, segmentosEnvelopeSchema } from '../../../shared/schemas/segmento-analisis.schema.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';

const companyParams = z.object({ companyId: z.string().uuid() });
const segmentoParams = companyParams.extend({ id: z.string().uuid() });
const rankingQuery = z.object({ periodoId: z.string().uuid(), criterio: z.enum(['rendimiento', 'margen']).default('rendimiento') });
const actorFrom = (request: FastifyRequest) => ({
  id: request.authUser!.id, role: request.authUser!.role, jobTitle: request.authUser!.jobTitle,
  area: 'costista', method: 'manual', device: `${request.headers['user-agent'] ?? 'desconocido'} · ${request.ip}`,
});

export async function registerSegmentoAnalisisRoutes(app: FastifyInstance): Promise<void> {
  app.setSerializerCompiler(serializerCompiler);
  app.setValidatorCompiler(validatorCompiler);
  const contract = app.withTypeProvider<ZodTypeProvider>();
  const service = new SegmentoAnalisisService();
  contract.get('/companies/:companyId/segmentos-analisis', { preHandler: authenticate, schema: { response: { 200: segmentosEnvelopeSchema, ...apiErrorResponses } } }, async (request) => {
    const { companyId } = companyParams.parse(request.params);
    return { data: await service.listar(request.authUser!.id, companyId) };
  });
  contract.post('/companies/:companyId/segmentos-analisis', { preHandler: authenticate, schema: { body: crearSegmentoAnalisisSchema, response: { 201: segmentoEnvelopeSchema, ...apiErrorResponses } } }, async (request, reply) => {
    const { companyId } = companyParams.parse(request.params);
    const data = await service.crear(request.authUser!.id, companyId, crearSegmentoAnalisisSchema.parse(request.body), actorFrom(request));
    reply.code(201); return { data };
  });
  contract.patch('/companies/:companyId/segmentos-analisis/:id', { preHandler: authenticate, schema: { body: actualizarSegmentoAnalisisSchema, response: { 200: segmentoEnvelopeSchema, ...apiErrorResponses } } }, async (request) => {
    const { companyId, id } = segmentoParams.parse(request.params);
    return { data: await service.actualizar(request.authUser!.id, companyId, id, actualizarSegmentoAnalisisSchema.parse(request.body), actorFrom(request)) };
  });
  contract.delete('/companies/:companyId/segmentos-analisis/:id', { preHandler: authenticate, schema: { response: { 200: segmentoEliminadoEnvelopeSchema, ...apiErrorResponses } } }, async (request) => {
    const { companyId, id } = segmentoParams.parse(request.params);
    await service.eliminar(request.authUser!.id, companyId, id, actorFrom(request));
    return { data: { eliminado: true as const } };
  });
  contract.get('/companies/:companyId/analisis/equilibrio-sectorial', { preHandler: authenticate, schema: { response: { 200: equilibrioSectorialEnvelopeSchema, ...apiErrorResponses } } }, async (request) => {
    const { companyId } = companyParams.parse(request.params);
    return { data: await service.calcular(request.authUser!.id, companyId) };
  });
  contract.post('/companies/:companyId/segmentos-analisis/:id/rotaciones', { preHandler: authenticate, schema: { body: crearRotacionSegmentoSchema, response: { 201: rotacionSegmentoEnvelopeSchema, ...apiErrorResponses } } }, async (request, reply) => {
    const { companyId, id } = segmentoParams.parse(request.params);
    const data = await service.cargarRotacion(request.authUser!.id, companyId, id, crearRotacionSegmentoSchema.parse(request.body), actorFrom(request));
    reply.code(201); return { data };
  });
  contract.get('/companies/:companyId/analisis/ranking-rotacion', { preHandler: authenticate, schema: { querystring: rankingQuery, response: { 200: rankingRotacionEnvelopeSchema, ...apiErrorResponses } } }, async (request) => {
    const { companyId } = companyParams.parse(request.params);
    const { periodoId, criterio } = rankingQuery.parse(request.query);
    return { data: await service.ranking(request.authUser!.id, companyId, periodoId, criterio) };
  });
}
