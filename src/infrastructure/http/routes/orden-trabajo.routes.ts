import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { OrdenTrabajoService } from '../../../application/ordenes/orden-trabajo-service.js';
import { etapasOrdenEnvelopeSchema, ordenTrabajoCreateSchema, ordenTrabajoEnvelopeSchema, ordenesTrabajoEnvelopeSchema, ordenTrabajoTransitionSchema, plantillasOrdenEnvelopeSchema } from '../../../shared/schemas/orden-trabajo.schema.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';
import { authenticate } from '../plugins/authenticate.js';
import { OperatorScopeService, type PermisoOperador } from '../../../application/empresa/operator-scope-service.js';
import { PresupuestoOrdenService } from '../../../application/ordenes/presupuesto-orden-service.js';
import { presupuestoCreateSchema, presupuestoEnvelopeSchema, presupuestosEnvelopeSchema, presupuestoRevalidarSchema } from '../../../shared/schemas/presupuesto-orden.schema.js';
import { ParteHorasService } from '../../../application/ordenes/parte-horas-service.js';
import { parteHorasCreateSchema, parteHorasEnvelopeSchema, partesHorasEnvelopeSchema } from '../../../shared/schemas/parte-horas.schema.js';
import { CostosDirectosService } from '../../../application/ordenes/costos-directos-service.js';
import { contingenciaCreateSchema, contingenciaEnvelopeSchema, contingenciasEnvelopeSchema, costoDirectoCreateSchema, costoDirectoEnvelopeSchema, costosDirectosEnvelopeSchema } from '../../../shared/schemas/costos-directos.schema.js';

const companyParams = z.object({ companyId: z.string().uuid() });
const idParams = z.object({ id: z.string().uuid() });
const actorFrom = (request: FastifyRequest) => ({
  id: request.authUser!.id, role: request.authUser!.role, jobTitle: request.authUser!.jobTitle,
  area: 'costista', method: 'manual', device: `${request.headers['user-agent'] ?? 'desconocido'} · ${request.ip}`,
});
const esOperador = (request: FastifyRequest) => request.authUser!.role === 'EMPRESA_OPERATOR';
const sinMargen = <T extends Record<string, unknown>>(value: T): T => Object.fromEntries(
  Object.entries(value).filter(([key]) => key !== 'precio' && key !== 'precioContractual' && !key.startsWith('margen')),
) as T;
const sinTarifa = <T extends { tarifaHora?: unknown; primaExtraHora?: unknown; importeMod?: unknown }>(value: T): Omit<T, 'tarifaHora' | 'primaExtraHora' | 'importeMod'> => {
  const { tarifaHora: _tarifa, primaExtraHora: _prima, importeMod: _importe, ...visible } = value;
  return visible;
};

export async function registerOrdenTrabajoRoutes(app: FastifyInstance): Promise<void> {
  app.setSerializerCompiler(serializerCompiler);
  app.setValidatorCompiler(validatorCompiler);
  const contract = app.withTypeProvider<ZodTypeProvider>();
  const service = new OrdenTrabajoService();
  const presupuestos = new PresupuestoOrdenService();
  const partesHoras = new ParteHorasService();
  const costosDirectos = new CostosDirectosService();
  const scopes = new OperatorScopeService();
  contract.post('/companies/:companyId/ordenes-trabajo', {
    preHandler: authenticate, schema: { body: ordenTrabajoCreateSchema, response: { 201: ordenTrabajoEnvelopeSchema, ...apiErrorResponses } },
  }, async (request, reply) => {
    const { companyId } = companyParams.parse(request.params);
    const tenantId = esOperador(request) ? await scopes.tenantForCompany(request.authUser!.id, companyId, 'ordenes.editar') : request.authUser!.id;
    const data = await service.create(tenantId, companyId, ordenTrabajoCreateSchema.parse(request.body), actorFrom(request));
    return reply.code(201).send({ data });
  });
  contract.get('/companies/:companyId/ordenes-trabajo', { preHandler: authenticate, schema: { response: { 200: ordenesTrabajoEnvelopeSchema, ...apiErrorResponses } } }, async (request) => {
    const { companyId } = companyParams.parse(request.params);
    if (!esOperador(request)) return { data: await service.list(request.authUser!.id, companyId) };
    const tenantId = await scopes.tenantForCompany(request.authUser!.id, companyId, 'ordenes.ver');
    const ordenIds = await scopes.ordenIds(request.authUser!.id, companyId);
    const canSeeMargin = await scopes.assertPermission(request.authUser!.id, 'ordenes.ver_margen').then(() => true, () => false);
    const data = await service.list(tenantId, companyId, ordenIds);
    return { data: canSeeMargin ? data : data.map(sinMargen) };
  });
  contract.get('/companies/:companyId/plantillas-orden', { preHandler: authenticate, schema: { response: { 200: plantillasOrdenEnvelopeSchema, ...apiErrorResponses } } }, async (request) => {
    const { companyId } = companyParams.parse(request.params);
    return { data: await service.listTemplates(request.authUser!.id, companyId) };
  });
  contract.get('/ordenes-trabajo/:id', { preHandler: authenticate, schema: { response: { 200: ordenTrabajoEnvelopeSchema, ...apiErrorResponses } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    if (!esOperador(request)) return { data: await service.get(request.authUser!.id, id) };
    const tenantId = await scopes.tenantForOrden(request.authUser!.id, id, 'ordenes.ver');
    const data = await service.get(tenantId, id);
    const canSeeMargin = await scopes.assertPermission(request.authUser!.id, 'ordenes.ver_margen').then(() => true, () => false);
    return { data: canSeeMargin ? data : sinMargen(data) };
  });
  contract.get('/ordenes-trabajo/:id/etapas', { preHandler: authenticate, schema: { response: { 200: etapasOrdenEnvelopeSchema, ...apiErrorResponses } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const tenantId = esOperador(request) ? await scopes.tenantForOrden(request.authUser!.id, id, 'ordenes.ver') : request.authUser!.id;
    return { data: await service.listStages(tenantId, id) };
  });
  contract.post('/ordenes-trabajo/:id/transiciones', {
    preHandler: authenticate, schema: { body: ordenTrabajoTransitionSchema, response: { 200: ordenTrabajoEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => {
    const { id } = idParams.parse(request.params);
    const input = ordenTrabajoTransitionSchema.parse(request.body);
    const permission: PermisoOperador = input.estado === 'PENDIENTE_CIERRE' || input.estado === 'CERRADA' ? 'ordenes.cerrar' : 'ordenes.editar';
    const tenantId = esOperador(request) ? await scopes.tenantForOrden(request.authUser!.id, id, permission) : request.authUser!.id;
    return { data: await service.transition(tenantId, id, input, actorFrom(request)) };
  });
  contract.post('/ordenes-trabajo/:id/presupuestos', {
    preHandler: authenticate, schema: { body: presupuestoCreateSchema, response: { 201: presupuestoEnvelopeSchema, ...apiErrorResponses } },
  }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const tenantId = esOperador(request) ? await scopes.tenantForOrden(request.authUser!.id, id, 'ordenes.editar') : request.authUser!.id;
    return reply.code(201).send({ data: await presupuestos.create(tenantId, id, presupuestoCreateSchema.parse(request.body), actorFrom(request)) });
  });
  contract.get('/ordenes-trabajo/:id/presupuestos', {
    preHandler: authenticate, schema: { response: { 200: presupuestosEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => {
    const { id } = idParams.parse(request.params);
    const tenantId = esOperador(request) ? await scopes.tenantForOrden(request.authUser!.id, id, 'ordenes.ver') : request.authUser!.id;
    const data = await presupuestos.list(tenantId, id);
    if (!esOperador(request)) return { data };
    const canSeeMargin = await scopes.assertPermission(request.authUser!.id, 'ordenes.ver_margen').then(() => true, () => false);
    if (canSeeMargin) return { data };
    const { precioContractual: _precioContractual, ...visible } = data;
    return { data: { ...visible, presupuestos: data.presupuestos.map(sinMargen) } };
  });
  const transition = (action: 'prepare' | 'approve' | 'reject') => async (request: FastifyRequest) => {
    const { id } = idParams.parse(request.params);
    const permission: PermisoOperador = action === 'approve' ? 'ordenes.aprobar_presupuesto' : 'ordenes.editar';
    const tenantId = esOperador(request) ? await scopes.tenantForPresupuesto(request.authUser!.id, id, permission) : request.authUser!.id;
    return { data: await presupuestos[action](tenantId, id, actorFrom(request)) };
  };
  contract.post('/presupuestos/:id/preparar', { preHandler: authenticate, schema: { response: { 200: presupuestoEnvelopeSchema, ...apiErrorResponses } } }, transition('prepare'));
  contract.post('/presupuestos/:id/aprobar', { preHandler: authenticate, schema: { response: { 200: presupuestoEnvelopeSchema, ...apiErrorResponses } } }, transition('approve'));
  contract.post('/presupuestos/:id/rechazar', { preHandler: authenticate, schema: { response: { 200: presupuestoEnvelopeSchema, ...apiErrorResponses } } }, transition('reject'));
  contract.post('/presupuestos/:id/revalidar', {
    preHandler: authenticate, schema: { body: presupuestoRevalidarSchema, response: { 200: presupuestoEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => {
    const { id } = idParams.parse(request.params);
    const tenantId = esOperador(request) ? await scopes.tenantForPresupuesto(request.authUser!.id, id, 'ordenes.editar') : request.authUser!.id;
    return { data: await presupuestos.revalidate(tenantId, id, presupuestoRevalidarSchema.parse(request.body), actorFrom(request)) };
  });
  contract.post('/ordenes-trabajo/:id/partes-horas', {
    preHandler: authenticate,
    schema: { body: parteHorasCreateSchema, response: { 201: parteHorasEnvelopeSchema, ...apiErrorResponses } },
  }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const tenantId = esOperador(request) ? await scopes.tenantForOrden(request.authUser!.id, id, 'horas.cargar') : request.authUser!.id;
    const data = await partesHoras.create(tenantId, id, parteHorasCreateSchema.parse(request.body), actorFrom(request));
    return reply.code(201).send({ data: esOperador(request) ? sinTarifa(data) : data });
  });
  contract.get('/ordenes-trabajo/:id/partes-horas', {
    preHandler: authenticate, schema: { response: { 200: partesHorasEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => {
    const { id } = idParams.parse(request.params);
    const tenantId = esOperador(request) ? await scopes.tenantForOrden(request.authUser!.id, id, 'ordenes.ver') : request.authUser!.id;
    const data = await partesHoras.list(tenantId, id);
    return { data: esOperador(request) ? data.map(sinTarifa) : data };
  });
  contract.post('/partes-horas/:id/aprobar', {
    preHandler: authenticate, schema: { response: { 200: parteHorasEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => {
    const { id } = idParams.parse(request.params);
    const tenantId = esOperador(request) ? await scopes.tenantForParteHoras(request.authUser!.id, id, 'horas.aprobar') : request.authUser!.id;
    return { data: await partesHoras.approve(tenantId, id, actorFrom(request)) };
  });
  contract.post('/ordenes-trabajo/:id/costos-directos', {
    preHandler: authenticate, schema: { body: costoDirectoCreateSchema, response: { 201: costoDirectoEnvelopeSchema, ...apiErrorResponses } },
  }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const tenantId = esOperador(request) ? await scopes.tenantForOrden(request.authUser!.id, id, 'ordenes.editar') : request.authUser!.id;
    return reply.code(201).send({ data: await costosDirectos.createCosto(tenantId, id, costoDirectoCreateSchema.parse(request.body), actorFrom(request)) });
  });
  contract.get('/ordenes-trabajo/:id/costos-directos', {
    preHandler: authenticate, schema: { response: { 200: costosDirectosEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => {
    const { id } = idParams.parse(request.params);
    const tenantId = esOperador(request) ? await scopes.tenantForOrden(request.authUser!.id, id, 'ordenes.ver') : request.authUser!.id;
    return costosDirectos.listCostos(tenantId, id);
  });
  contract.post('/ordenes-trabajo/:id/contingencias', {
    preHandler: authenticate, schema: { body: contingenciaCreateSchema, response: { 201: contingenciaEnvelopeSchema, ...apiErrorResponses } },
  }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const tenantId = esOperador(request) ? await scopes.tenantForOrden(request.authUser!.id, id, 'ordenes.editar') : request.authUser!.id;
    return reply.code(201).send({ data: await costosDirectos.createContingencia(tenantId, id, contingenciaCreateSchema.parse(request.body), actorFrom(request)) });
  });
  contract.get('/ordenes-trabajo/:id/contingencias', {
    preHandler: authenticate, schema: { response: { 200: contingenciasEnvelopeSchema, ...apiErrorResponses } },
  }, async (request) => {
    const { id } = idParams.parse(request.params);
    const tenantId = esOperador(request) ? await scopes.tenantForOrden(request.authUser!.id, id, 'ordenes.ver') : request.authUser!.id;
    return costosDirectos.listContingencias(tenantId, id);
  });
}
