import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AllocationBaseService } from '../../../application/cost-structures/allocation-base-service.js';
import { CostStructureService } from '../../../application/cost-structures/cost-structure-service.js';
import { authenticate } from '../plugins/authenticate.js';

const idParam = z.object({ id: z.string().uuid() });

const createBaseSchema = z.object({
  companyId: z.string().uuid(),
  code: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  unit: z.string().min(1).max(40),
  description: z.string().max(400).optional(),
});

const setValueSchema = z.object({
  baseId: z.string().uuid(),
  centerId: z.string().min(1).max(60),
  value: z.number().finite().nonnegative(),
  note: z.string().max(400).optional(),
  dataPointId: z.string().uuid().optional(),
});

/**
 * Endpoints de bases de asignación (Parte 4). El catálogo se filtra por la
 * empresa del usuario; los valores viven por estructura/centro y son
 * trazables.
 */
export async function registerAllocationBaseRoutes(app: FastifyInstance): Promise<void> {
  const service = new AllocationBaseService();
  const structures = new CostStructureService();

  // Catálogo de bases visibles para una empresa (sistema + propias).
  app.get('/companies/:id/allocation-bases', { preHandler: authenticate }, async (request) => {
    const { id: companyId } = idParam.parse(request.params);
    const bases = await service.listCatalog(companyId);
    return { data: bases };
  });

  // Alta de base personalizada.
  app.post('/allocation-bases', { preHandler: authenticate }, async (request, reply) => {
    const input = createBaseSchema.parse(request.body);
    const base = await service.createCustom(input.companyId, input);
    return reply.status(201).send({ data: base });
  });

  // Valores de base cargados para una estructura.
  app.get('/structures/:id/allocation-values', { preHandler: authenticate }, async (request) => {
    const { id: structureId } = idParam.parse(request.params);
    const values = await service.listValues(request.authUser!.id, structureId);
    return { data: values };
  });

  // Cargar/recargar el valor de una base para un centro (append-only).
  app.put('/structures/:id/allocation-values', { preHandler: authenticate }, async (request) => {
    const { id: structureId } = idParam.parse(request.params);
    const input = setValueSchema.parse(request.body);
    const value = await service.setValue(request.authUser!.id, structureId, input);
    return { data: value };
  });

  // Chequeo de completitud antes de calcular (Parte 4.5): lista los servicios
  // sin base/orden de cierre, con link accionable al formulario. Usa la config
  // ya guardada de la estructura.
  app.get('/structures/:id/allocation-check', { preHandler: authenticate }, async (request) => {
    const { id: structureId } = idParam.parse(request.params);
    const s = await structures.getById(request.authUser!.id, structureId);
    const cfg = (s.indirectCostConfig ?? null) as {
      centers?: Array<{ id: string; name: string; type: string }>;
      closureOrder?: string[];
      serviceDistributions?: Array<{ serviceCenterId: string }>;
    } | null;
    const missing: Array<{ centerId: string; name: string; reason: string }> = [];
    if (cfg?.centers) {
      const services = cfg.centers.filter((c) => c.type === 'service');
      const withDist = new Set((cfg.serviceDistributions ?? []).map((d) => d.serviceCenterId));
      const inOrder = new Set(cfg.closureOrder ?? []);
      for (const svc of services) {
        if (!withDist.has(svc.id)) {
          missing.push({ centerId: svc.id, name: svc.name, reason: 'Asignar base de distribución' });
        } else if ((cfg.closureOrder?.length ?? 0) > 0 && !inOrder.has(svc.id)) {
          missing.push({ centerId: svc.id, name: svc.name, reason: 'Falta en el orden de cierre' });
        }
      }
    }
    return { data: { ok: missing.length === 0, missing } };
  });
}
