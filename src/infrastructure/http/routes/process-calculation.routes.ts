import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ProcessCalculationService } from '../../../application/cost-structures/process-costing/process-calculation-service.js';
import { authenticate } from '../plugins/authenticate.js';

/**
 * Cálculo de Costeo por Procesos (B17). Solo aplica a estructuras con
 * `costingSystem = 'PROCESSES'`; el servicio devuelve un 422 accionable si se
 * llama sobre una de Órdenes o faltan datos. El cálculo es por PERÍODO: recorre
 * los departamentos en orden de secuencia y transfiere el costo de cada uno al
 * siguiente.
 */

const calcParams = z.object({
  id: z.string().uuid(),
  periodId: z.string().uuid(),
});

/** Actor de trazabilidad: rol del JWT, dispositivo de la request. */
function actorFrom(request: FastifyRequest) {
  const ua = request.headers['user-agent'] ?? 'desconocido';
  return {
    id: request.authUser!.id,
    role: request.authUser!.role,
    area: 'costista',
    device: `${ua} · ${request.ip}`,
  };
}

export async function registerProcessCalculationRoutes(app: FastifyInstance): Promise<void> {
  const service = new ProcessCalculationService();
  const base = '/structures/:id/process/periods/:periodId';

  // Corre el motor de Procesos y PERSISTE la corrida + su árbol de derivación.
  app.post(`${base}/calculate`, { preHandler: authenticate }, async (request) => {
    const { id, periodId } = calcParams.parse(request.params);
    const result = await service.calculate(request.authUser!.id, id, periodId, actorFrom(request));
    return {
      data: {
        runId: result.run.id,
        runN: result.run.runN,
        period: result.period,
        results: result.results,
        // Atajo en el nivel superior (F04): el front decide con esto si pinta una
        // advertencia en vez de un costo "sano".
        incompleto: result.incompletitud,
        tree: result.tree,
      },
    };
  });

  // Informe de costos de producción por departamento (para mostrar/exportar).
  app.get(`${base}/production-report`, { preHandler: authenticate }, async (request) => {
    const { id, periodId } = calcParams.parse(request.params);
    const data = await service.getProductionReport(request.authUser!.id, id, periodId);
    return { data };
  });
}
