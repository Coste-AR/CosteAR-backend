import type { FastifyInstance } from 'fastify';
import { CompanyService } from '../../../application/companies/company-service.js';
import { DeviationService } from '../../../application/companies/deviation-service.js';
import { authenticate, auditContext } from '../plugins/authenticate.js';
import {
  createCompanySchema,
  updateCompanySchema,
} from '../../../shared/schemas/company.schema.js';
import { updateTargetBudgetSchema } from '../../../shared/schemas/target-budget.schema.js';
import { z } from 'zod';

const idParam = z.object({ id: z.string().uuid() });

export async function registerCompanyRoutes(app: FastifyInstance): Promise<void> {
  const service = new CompanyService();
  const deviation = new DeviationService();

  app.get('/companies', { preHandler: authenticate }, async (request) => {
    const companies = await service.list(request.authUser!.id);
    return { data: companies };
  });

  app.post('/companies', { preHandler: authenticate }, async (request, reply) => {
    const input = createCompanySchema.parse(request.body);
    const company = await service.create(request.authUser!.id, input, auditContext(request));
    return reply.status(201).send({ data: company });
  });

  app.get('/companies/:id', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const company = await service.getById(request.authUser!.id, id);
    return { data: company };
  });

  app.put('/companies/:id', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const input = updateCompanySchema.parse(request.body);
    const company = await service.update(request.authUser!.id, id, input, auditContext(request));
    return { data: company };
  });

  app.delete('/companies/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    await service.remove(request.authUser!.id, id, auditContext(request));
    return reply.status(204).send();
  });

  // --- Target Budget Routes ---

  app.get('/companies/:id/target-budget', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const budget = await service.getTargetBudget(request.authUser!.id, id);
    return { data: budget };
  });

  app.put('/companies/:id/target-budget', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const input = updateTargetBudgetSchema.parse(request.body);
    const budget = await service.updateTargetBudget(request.authUser!.id, id, input, auditContext(request));
    return { data: budget };
  });

  app.get(
    '/companies/:id/deviations',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const result = await deviation.getCompanyDeviations(request.authUser!.id, id);
      return reply.send({ data: result });
    },
  );
}
