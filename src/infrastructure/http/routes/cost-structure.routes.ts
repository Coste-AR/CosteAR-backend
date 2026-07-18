import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CostStructureService } from '../../../application/cost-structures/cost-structure-service.js';
import { ValidationError } from '../../../domain/errors/domain-error.js';
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
      const { includeDeleted } = z
        .object({ includeDeleted: z.coerce.boolean().optional() })
        .parse(request.query);
      const list = await service.listByCompany(request.authUser!.id, companyId, includeDeleted);
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

  app.get('/cost-structures/:id', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const structure = await service.getById(request.authUser!.id, id);
    return { data: structure };
  });

  // Borrar (soft-delete) y recuperar — ambas requieren confirmación en el front.
  app.delete('/cost-structures/:id', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const deleted = await service.softDelete(request.authUser!.id, id, auditContext(request));
    return { data: deleted };
  });

  /**
   * PURGA: borra la estructura DE VERDAD, con todo su histórico. No hay papelera,
   * no hay vuelta atrás.
   *
   * Para que no pase por accidente (ni por un click, ni por un bug de otro lado),
   * hay que mandar el NOMBRE DEL PRODUCTO escrito tal cual. Es el patrón de "escribí
   * el nombre para confirmar": lo único que queda después es el registro de
   * auditoría.
   */
  app.post('/cost-structures/:id/purge', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { confirm } = z.object({ confirm: z.string().min(1) }).parse(request.body);

    const structure = await service.requireStructure(request.authUser!.id, id);
    if (confirm.trim() !== structure.productName.trim()) {
      throw new ValidationError(
        `Para borrar definitivamente hay que escribir el nombre del producto tal cual: "${structure.productName}". ` +
          'Esto no se puede deshacer: se borra el histórico completo (versiones, cálculos, períodos y datos).',
      );
    }

    const purged = await service.purge(request.authUser!.id, id, auditContext(request));
    return { data: purged };
  });

  app.post('/cost-structures/:id/restore', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const restored = await service.restore(request.authUser!.id, id, auditContext(request));
    return { data: restored };
  });

  // Exportar a Excel (.xlsx) — el costista se lleva su planilla.
  app.get('/cost-structures/:id/export', { preHandler: authenticate }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { buffer, filename } = await service.exportToExcel(request.authUser!.id, id);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });

  // Importar desde Excel: parsea y devuelve valores sugeridos, no persiste nada.
  // `bodyLimit` acá override el global de app.ts (1 MiB, pensado para el resto
  // de la API) — un .xlsx en base64 de ~10MB decodificados (tope real: los
  // 14_000_000 caracteres que valida el schema de abajo) no entra en 1 MiB, y
  // sin este override Fastify lo rechazaba con un 413 genérico ANTES de que
  // el Zod de acá corriera. 15_000_000 bytes deja margen sobre el cap de Zod.
  app.post(
    '/cost-structures/:id/import-excel',
    { preHandler: authenticate, bodyLimit: 15_000_000 },
    async (request) => {
      const { id } = idParam.parse(request.params);
      const { fileBase64 } = z.object({ fileBase64: z.string().min(1).max(14_000_000) }).parse(request.body);
      const result = await service.importFromExcel(request.authUser!.id, id, fileBase64);
      return { data: result };
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
    const { salesUnitPrice, salesQuantity, productionQuantity } = updateSalesSchema.parse(request.body);
    const updated = await service.updateSales(
      request.authUser!.id,
      id,
      salesUnitPrice,
      salesQuantity,
      auditContext(request),
      productionQuantity,
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

  app.post('/cost-structures/:id/simulate', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const shocksSchema = z.object({
      rawMaterial: z.number().optional(),
      directLabor: z.number().optional(),
      indirectCosts: z.number().optional(),
      sales: z.number().optional(),
    });
    const shocks = shocksSchema.parse(request.body);

    const { result } = await service.simulate(request.authUser!.id, id, shocks);
    return { data: { result, simulated: true } };
  });

  app.get('/cost-structures/:id/calculations', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const history = await service.calculationHistory(request.authUser!.id, id);
    return { data: history };
  });

  // Historial append-only de la config (R1): todas las versiones de cada
  // sección, la más nueva primero. `?section=rawMaterial|directLabor|indirectCosts|sales`.
  app.get('/cost-structures/:id/config-history', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const q = z.object({ section: z.string().optional() }).parse(request.query);
    const history = await service.getConfigHistory(request.authUser!.id, id, q.section);
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
