import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ProposalService } from '../../../application/nightly-learning/proposal-service.js';
import { authenticate, requireRole } from '../plugins/authenticate.js';

const idParam = z.object({ id: z.string().uuid() });

export async function registerVaultProposalRoutes(app: FastifyInstance): Promise<void> {
  const service = new ProposalService();

  app.get('/vault/proposals', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const list = await service.listPending();
    return reply.status(200).send({ data: list });
  });

  app.post('/vault/proposals/:id/approve', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const approved = await service.approveProposal(request.authUser!.id, id);
    return reply.status(200).send({ data: approved });
  });

  app.post('/vault/proposals/:id/reject', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const rejected = await service.rejectProposal(request.authUser!.id, id);
    return reply.status(200).send({ data: rejected });
  });
}
