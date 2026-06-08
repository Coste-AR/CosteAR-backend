import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CostStructureService } from '../../../application/cost-structures/cost-structure-service.js';
import { authenticate, auditContext } from '../plugins/authenticate.js';
import {
  createCostStructureSchema,
  updateSalesSchema,
} from '../../../shared/schemas/cost.schema.js';

const idParam = z.object({ id: z.string().uuid() });
const companyIdParam = z.object({ companyId: z.string().uuid() });

export async function registerCostStructureRoutes(app: FastifyInstance): Promise<void> {
  const service = new CostStructureService();

  app.get(
    '/companies/:companyId/cost-structures',
    { preHandler: authenticate },
    async (request) => {
      const { companyId } = companyIdParam.parse(request.params);
      const list = await service.listByCompany(request.authUser!.id, companyId);
      return { data: list };
    },
  );

  app.post(
    '/companies/:companyId/cost-structures',
    { preHandler: authenticate },
    async (request, reply) => {
      const { companyId } = companyIdParam.parse(request.params);
      const input = createCostStructureSchema.parse(request.body);
      const created = await service.create(request.authUser!.id, companyId, input, auditContext(request));
      return reply.status(201).send({ data: created });
    },
  );

  // Carga de cada bloque de configuración (validación dentro del servicio).
  for (const section of ['raw-material', 'direct-labor', 'indirect-costs'] as const) {
    const key =
      section === 'raw-material'
        ? 'rawMaterial'
        : section === 'direct-labor'
          ? 'directLabor'
          : 'indirectCosts';
    app.put(
      `/cost-structures/:id/${section}`,
      { preHandler: authenticate },
      async (request) => {
        const { id } = idParam.parse(request.params);
        const updated = await service.updateConfig(
          request.authUser!.id,
          id,
          key,
          request.body,
          auditContext(request),
        );
        return { data: updated };
      },
    );
  }

  app.put('/cost-structures/:id/sales', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { salesUnitPrice, salesQuantity } = updateSalesSchema.parse(request.body);
    const updated = await service.updateSales(
      request.authUser!.id,
      id,
      salesUnitPrice,
      salesQuantity,
      auditContext(request),
    );
    return { data: updated };
  });

  app.post('/cost-structures/:id/calculate', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { result, calculation } = await service.calculate(
      request.authUser!.id,
      id,
      auditContext(request),
      request.body,
    );
    return { data: { result, calculationId: calculation.id } };
  });

  // Simulador what-if: calcula SIN persistir (no crea snapshot).
  app.post('/cost-structures/:id/simulate', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    // Reusa el motor con override de inventario; el simulador front mandará
    // overrides de venta/macro en el body en una iteración futura.
    const { result } = await service.calculate(
      request.authUser!.id,
      id,
      auditContext(request),
      request.body,
    );
    return { data: { result, simulated: true } };
  });

  app.get('/cost-structures/:id/calculations', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const history = await service.calculationHistory(request.authUser!.id, id);
    return { data: history };
  });

  app.get(
    '/cost-structures/:id/calculations/latest',
    { preHandler: authenticate },
    async (request) => {
      const { id } = idParam.parse(request.params);
      const latest = await service.latestCalculation(request.authUser!.id, id);
      return { data: latest };
    },
  );
}
