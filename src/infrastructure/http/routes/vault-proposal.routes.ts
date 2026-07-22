import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ProposalService } from '../../../application/nightly-learning/proposal-service.js';
import { authenticate, requireRole } from '../plugins/authenticate.js';

const idParam = z.object({ id: z.string().uuid() });
const updateBody = z.object({
  title: z.string().min(1).optional(),
  sourceFile: z.string().min(1).optional(),
  proposedText: z.string().min(1).optional(),
  justification: z.string().min(1).optional(),
});

export async function registerVaultProposalRoutes(app: FastifyInstance): Promise<void> {
  const service = new ProposalService();

  app.get('/vault/proposals', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const list = await service.listPending();
    return reply.status(200).send({ data: list });
  });

  app.patch('/vault/proposals/:id', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const data = updateBody.parse(request.body);
    const updated = await service.updateProposal(id, data);
    return reply.status(200).send({ data: updated });
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
