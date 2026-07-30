import type { FastifyInstance } from 'fastify';
import { TermsService } from '../../../application/legal/terms-service.js';
import { authenticate, requireRole, auditContext } from '../plugins/authenticate.js';
import { acceptTermsSchema, publishTermsSchema } from '../../../shared/schemas/terms.schema.js';

function serializeVersion(v: { id: string; version: number; content: string; createdAt: Date }) {
  return { id: v.id, version: v.version, content: v.content, createdAt: v.createdAt };
}

export async function registerTermsRoutes(app: FastifyInstance): Promise<void> {
  const terms = new TermsService();

  // Público — lo consume tanto la pantalla de registro (todavía sin cuenta)
  // como el modal de aceptación obligatoria post-login.
  app.get('/terms/current', async (_request, reply) => {
    const current = await terms.requireCurrentVersion();
    return reply.send({ data: serializeVersion(current) });
  });

  // ¿Este usuario logueado tiene que (re)aceptar?
  app.get('/terms/status', { preHandler: authenticate }, async (request, reply) => {
    const { needs, current } = await terms.needsAcceptance(request.authUser!.id, request.authUser!.role);
    return reply.send({
      data: { needsAcceptance: needs, currentVersion: current ? serializeVersion(current) : null },
    });
  });

  app.post('/terms/accept', { preHandler: authenticate }, async (request, reply) => {
    const { termsVersionId } = acceptTermsSchema.parse(request.body);
    const ctx = auditContext(request);
    await terms.accept(request.authUser!.id, termsVersionId, ctx);
    return reply.send({ data: { success: true } });
  });

  // --- Admin: editar (= publicar nueva versión) ---------------------------

  app.get('/admin/terms', { preHandler: [authenticate, requireRole('ADMIN')] }, async (_request, reply) => {
    const versions = await terms.listVersions();
    return reply.send({ data: versions.map(serializeVersion) });
  });

  app.post('/admin/terms', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const { content } = publishTermsSchema.parse(request.body);
    const published = await terms.publish(content, request.authUser!.id);
    return reply.status(201).send({ data: serializeVersion(published) });
  });
}
