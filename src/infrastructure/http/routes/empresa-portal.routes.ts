import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EmpresaPortalService } from '../../../application/empresa/empresa-portal-service.js';
import { authenticate } from '../plugins/authenticate.js';

const inviteOperatorSchema = z.object({
  operatorName: z.string().min(2).max(120).trim(),
  operatorEmail: z.string().email().toLowerCase().trim(),
});

const submitDocSchema = z.object({
  rawContent: z.string().max(10_000).default(''),
  sourceType: z.enum(['TEXT', 'PDF', 'IMAGE']).default('TEXT'),
  connectionId: z.string().uuid().optional(),
  fileName: z.string().max(255).optional(),
  fileData: z.string().max(6_000_000).optional(),
  fileMimeType: z.string().max(100).optional(),
}).refine(
  (d) => d.rawContent.trim().length > 0 || d.fileData,
  { message: 'Ingresá una descripción o adjuntá un archivo' },
);

export async function registerEmpresaPortalRoutes(app: FastifyInstance): Promise<void> {
  const svc = new EmpresaPortalService();

  // ── Costista: invitar operador ──────────────────────────────────────────────
  app.post(
    '/empresa-portal/:companyId/operators',
    { preHandler: authenticate },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const { operatorName, operatorEmail } = inviteOperatorSchema.parse(request.body);
      const result = await svc.inviteOperator(companyId, request.authUser!.id, operatorName, operatorEmail);
      return reply.status(201).send({ data: result });
    },
  );

  // ── Costista: listar operadores ────────────────────────────────────────────
  app.get(
    '/empresa-portal/:companyId/operators',
    { preHandler: authenticate },
    async (request, reply) => {
      const { companyId } = request.params as { companyId: string };
      const operators = await svc.listOperators(companyId, request.authUser!.id);
      return reply.send({ data: operators });
    },
  );

  // ── Costista: revocar operador ─────────────────────────────────────────────
  app.delete(
    '/empresa-portal/operators/:operatorId',
    { preHandler: authenticate },
    async (request, reply) => {
      const { operatorId } = request.params as { operatorId: string };
      await svc.revokeOperator(operatorId, request.authUser!.id);
      return reply.send({ data: { success: true } });
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
      const entry = await svc.submitDocument(request.authUser!.id, input);
      return reply.status(201).send({ data: { id: entry.id, status: entry.status, aiResponse: entry.reviewNote ?? null } });
    },
  );

  // ── Operador: historial de envíos ──────────────────────────────────────────
  app.get(
    '/empresa-portal/my-submissions',
    { preHandler: authenticate },
    async (request, reply) => {
      const { connectionId } = (request.query ?? {}) as { connectionId?: string };
      const items = await svc.listMySubmissions(request.authUser!.id, connectionId);
      return reply.send({ data: items });
    },
  );
}
