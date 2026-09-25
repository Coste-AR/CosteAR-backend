import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { InventarioService } from '../../../application/inventario/inventario-service.js';
import { authenticate } from '../plugins/authenticate.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';
import { OperatorScopeService } from '../../../application/empresa/operator-scope-service.js';
import { articuloCreateSchema, articuloEnvelopeSchema, articulosEnvelopeSchema, movimientoInventarioCreateSchema, movimientoInventarioEnvelopeSchema } from '../../../shared/schemas/inventario.schema.js';

const params = z.object({ companyId: z.string().uuid() });
const actor = (request: FastifyRequest) => ({ id: request.authUser!.id, role: request.authUser!.role, jobTitle: request.authUser!.jobTitle, area: 'costista', method: 'manual', device: `${request.headers['user-agent'] ?? 'desconocido'} · ${request.ip}` });

export async function registerInventarioRoutes(app: FastifyInstance): Promise<void> {
  app.setSerializerCompiler(serializerCompiler);
  app.setValidatorCompiler(validatorCompiler);
  const contract = app.withTypeProvider<ZodTypeProvider>();
  const service = new InventarioService();
  const scopes = new OperatorScopeService();
  contract.post('/companies/:companyId/articulos', { preHandler: authenticate, schema: { body: articuloCreateSchema, response: { 201: articuloEnvelopeSchema, ...apiErrorResponses } } }, async (request, reply) => {
    const { companyId } = params.parse(request.params);
    const tenantId = request.authUser!.role === 'EMPRESA_OPERATOR' ? await scopes.tenantForCompany(request.authUser!.id, companyId, 'inventario.mover') : request.authUser!.id;
    return reply.code(201).send({ data: await service.crearArticulo(tenantId, companyId, articuloCreateSchema.parse(request.body), actor(request)) });
  });
  contract.get('/companies/:companyId/articulos', { preHandler: authenticate, schema: { response: { 200: articulosEnvelopeSchema, ...apiErrorResponses } } }, async (request) => {
    const { companyId } = params.parse(request.params);
    const tenantId = request.authUser!.role === 'EMPRESA_OPERATOR' ? await scopes.tenantForCompany(request.authUser!.id, companyId, 'inventario.mover') : request.authUser!.id;
    return { data: await service.listar(tenantId, companyId) };
  });
  contract.post('/companies/:companyId/movimientos-inventario', { preHandler: authenticate, schema: { body: movimientoInventarioCreateSchema, response: { 201: movimientoInventarioEnvelopeSchema, ...apiErrorResponses } } }, async (request, reply) => {
    const { companyId } = params.parse(request.params);
    const tenantId = request.authUser!.role === 'EMPRESA_OPERATOR' ? await scopes.tenantForCompany(request.authUser!.id, companyId, 'inventario.mover') : request.authUser!.id;
    return reply.code(201).send({ data: await service.registrar(tenantId, companyId, movimientoInventarioCreateSchema.parse(request.body), actor(request)) });
  });
}
