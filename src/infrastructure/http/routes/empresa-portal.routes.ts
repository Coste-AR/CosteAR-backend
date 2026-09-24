import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EmpresaPortalService } from '../../../application/empresa/empresa-portal-service.js';
import { authenticate } from '../plugins/authenticate.js';
import { requireRole } from '../plugins/authenticate.js';
import { OperatorScopeService } from '../../../application/empresa/operator-scope-service.js';
import { apiErrorResponses } from '../../../shared/schemas/api-contract.schema.js';

const inviteOperatorSchema = z.object({
  operatorName: z.string().min(2).max(120).trim(),
  operatorEmail: z.string().email().toLowerCase().trim(),
  /**
   * El PUESTO en la empresa ("Jefe de Depósito", "Contador"), no el rol de
   * login. Opcional: si el costista no lo sabe, "no consta" es más honesto que
   * un puesto inventado.
   */
  jobTitle: z.string().min(2).max(120).trim().optional(),
});

const scopeSchema = z.object({
  unidadProductivaIds: z.array(z.string().uuid()).default([]),
  depositoIds: z.array(z.string().uuid()).default([]),
});
const companyOperatorParams = z.object({ companyId: z.string().uuid(), operatorId: z.string().uuid() });
const companyParams = z.object({ companyId: z.string().uuid() });
const operatorParams = z.object({ operatorId: z.string().uuid() });
const successEnvelope = z.object({ data: z.object({ success: z.boolean() }) });
const inviteEnvelope = z.object({ data: z.object({
  email: z.string().email(), tempPassword: z.string().optional(), inviteCode: z.string(),
  isNewUser: z.boolean(), emailSent: z.boolean(),
}) });
const operatorListEnvelope = z.object({ data: z.array(z.object({
  id: z.string().uuid(), name: z.string(), email: z.string().email(), isActive: z.boolean(), createdAt: z.coerce.date(),
  alcance: z.object({
    unidadesProductivas: z.array(z.object({ id: z.string().uuid(), referencia: z.string() })),
    depositos: z.array(z.object({ id: z.string().uuid(), referencia: z.string() })),
  }),
})) });

const submitDocSchema = z.object({
  rawContent: z.string().max(10_000).default(''),
  sourceType: z.enum(['TEXT', 'PDF', 'IMAGE']).default('TEXT'),
  connectionId: z.string().uuid().optional(),
  costStructureId: z.string().uuid().optional(),
  fileName: z.string().max(255).optional(),
  fileData: z.string().max(6_000_000).optional(),
  fileMimeType: z.string().max(100).optional(),
}).refine(
  (d) => d.rawContent.trim().length > 0 || d.fileData,
  { message: 'Ingresá una descripción o adjuntá un archivo' },
);

export async function registerEmpresaPortalRoutes(
  app: FastifyInstance,
  dependencies: { portal?: EmpresaPortalService; scopes?: OperatorScopeService } = {},
): Promise<void> {
  app.setSerializerCompiler(serializerCompiler);
  app.setValidatorCompiler(validatorCompiler);
  const contract = app.withTypeProvider<ZodTypeProvider>();
  const svc = dependencies.portal ?? new EmpresaPortalService();
  const scopes = dependencies.scopes ?? new OperatorScopeService();

  // ── Costista: invitar operador ──────────────────────────────────────────────
  contract.post(
    '/empresa-portal/:companyId/operators',
    { preHandler: [authenticate, requireRole('EMPRESA_ADMIN', 'EMPRESARIO')], schema: {
      params: companyParams, body: inviteOperatorSchema, response: { 201: inviteEnvelope, ...apiErrorResponses },
    } },
    async (request, reply) => {
      const { companyId } = request.params;
      const { operatorName, operatorEmail, jobTitle } = request.body;
      const result = await svc.inviteOperator(
        companyId,
        request.authUser!.id,
        operatorName,
        operatorEmail,
        jobTitle,
      );
      return reply.status(201).send({ data: result });
    },
  );

  // ── Costista: listar operadores ────────────────────────────────────────────
  contract.get(
    '/empresa-portal/:companyId/operators',
    { preHandler: [authenticate, requireRole('EMPRESA_ADMIN', 'EMPRESARIO')], schema: {
      params: companyParams, response: { 200: operatorListEnvelope, ...apiErrorResponses },
    } },
    async (request, reply) => {
      const { companyId } = request.params;
      const operators = await svc.listOperators(companyId, request.authUser!.id);
      return reply.send({ data: operators });
    },
  );

  // ── Costista: revocar operador ─────────────────────────────────────────────
  contract.delete(
    '/empresa-portal/operators/:operatorId',
    { preHandler: [authenticate, requireRole('EMPRESA_ADMIN', 'EMPRESARIO')], schema: {
      params: operatorParams, response: { 200: successEnvelope, ...apiErrorResponses },
    } },
    async (request, reply) => {
      const { operatorId } = request.params;
      await svc.revokeOperator(operatorId, request.authUser!.id);
      return reply.send({ data: { success: true } });
    },
  );

  contract.put(
    '/empresa-portal/:companyId/operators/:operatorId/scope',
    { preHandler: [authenticate, requireRole('EMPRESA_ADMIN', 'EMPRESARIO')], schema: {
      params: companyOperatorParams, body: scopeSchema, response: { 200: successEnvelope, ...apiErrorResponses },
    } },
    async (request, reply) => {
      const { companyId, operatorId } = request.params;
      const input = request.body;
      await scopes.replace(companyId, operatorId, request.authUser!.id, input, {
        id: request.authUser!.id, role: request.authUser!.role, area: 'costista', method: 'manual',
      });
      return reply.send({ data: { success: true } });
    },
  );

  // ── Costista: resetear contraseña de un operador ──────────────────────────
  app.post(
    '/empresa-portal/operators/:operatorId/reset-password',
    { preHandler: [authenticate, requireRole('EMPRESA_ADMIN', 'EMPRESARIO')] },
    async (request, reply) => {
      const { operatorId } = request.params as { operatorId: string };
      const result = await svc.resetOperatorPassword(operatorId, request.authUser!.id);
      return reply.send({ data: result });
    },
  );

  // ── Operador: aceptar invitación por código ────────────────────────────────
  app.post(
    '/empresa-portal/accept-invite',
    { preHandler: authenticate },
    async (request, reply) => {
      const { code } = z.object({ code: z.string().min(1) }).parse(request.body);
      const result = await svc.acceptInvite(request.authUser!.id, code.trim().toUpperCase());
      return reply.send({ data: result });
    },
  );

  // ── Operador: mis empresas ─────────────────────────────────────────────────
  app.get(
    '/empresa-portal/my-companies',
    { preHandler: authenticate },
    async (request, reply) => {
      const companies = await svc.listMyCompanies(request.authUser!.id);
      return reply.send({ data: companies });
    },
  );

  // ── Operador: subir documento ──────────────────────────────────────────────
  app.post(
    '/empresa-portal/submit',
    { preHandler: authenticate },
    async (request, reply) => {
      const input = submitDocSchema.parse(request.body);
      const result = await svc.submitDocument(request.authUser!.id, input);
      return reply.status(201).send({ data: result });
    },
  );

  // ── Operador: productos/estructuras de una empresa (desplegable) ───────────
  app.get(
    '/empresa-portal/connections/:connectionId/structures',
    { preHandler: authenticate },
    async (request, reply) => {
      const { connectionId } = z
        .object({ connectionId: z.string().uuid() })
        .parse(request.params);
      const structures = await svc.listCompanyStructures(request.authUser!.id, connectionId);
      return reply.send({ data: structures });
    },
  );

  // ── Operador: historial de envíos ──────────────────────────────────────────
  app.get(
    '/empresa-portal/my-submissions',
    { preHandler: authenticate },
    async (request, reply) => {
      const { connectionId, costStructureId } = (request.query ?? {}) as {
        connectionId?: string;
        costStructureId?: string;
      };
      const items = await svc.listMySubmissions(request.authUser!.id, connectionId, costStructureId);
      return reply.send({ data: items });
    },
  );

  // ── Operador: Métricas de Estructura (Dashboard) ───────────────────────────
  app.get(
    '/empresa-portal/connections/:connectionId/structures/:structureId/metrics',
    { preHandler: authenticate },
    async (request, reply) => {
      const { connectionId, structureId } = z
        .object({ connectionId: z.string().uuid(), structureId: z.string().uuid() })
        .parse(request.params);
      const metrics = await svc.getStructureMetrics(request.authUser!.id, connectionId, structureId);
      return reply.send({ data: metrics });
    },
  );
}
