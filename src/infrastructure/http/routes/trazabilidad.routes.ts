import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DataPointService } from '../../../application/trazabilidad/data-point-service.js';
import { EvidenceService } from '../../../application/trazabilidad/evidence-service.js';
import { CalculationRunService } from '../../../application/cost-structures/calculation-run-service.js';
import { LateDataService } from '../../../application/cost-structures/late-data-service.js';
import { authenticate } from '../plugins/authenticate.js';
import {
  createDataPointSchema,
  addVersionSchema,
  validateDataPointSchema,
  requestRevisionSchema,
  imputacionSchema,
  evidenceSchema,
  attachEvidenceSchema,
} from '../../../shared/schemas/trazabilidad.schema.js';

const idParam = z.object({ id: z.string().uuid() });
const resolveLateDataSchema = z.object({
  choice: z.enum(['CURRENT_PERIOD', 'REOPEN', 'DISCARD']),
  // El motivo es obligatorio y largo a propósito: esta decisión mueve plata de
  // un mes a otro, y dentro de seis meses alguien va a preguntar por qué.
  reason: z
    .string()
    .trim()
    .min(10, 'Explicá por qué tomaste esta decisión (al menos 10 caracteres). Queda registrado.'),
});
const runsQuery = z.object({
  soloValidadas: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Actor de trazabilidad: rol del JWT, área del body, dispositivo de la request. */
function actorFrom(request: FastifyRequest, area: string) {
  const ua = request.headers['user-agent'] ?? 'desconocido';
  return {
    id: request.authUser!.id,
    role: request.authUser!.role,
    area,
    device: `${ua} · ${request.ip}`,
  };
}

export async function registerTrazabilidadRoutes(app: FastifyInstance): Promise<void> {
  const service = new DataPointService();
  const evidenceService = new EvidenceService();
  const runService = new CalculationRunService();
  const lateDataService = new LateDataService();

  app.post('/structures/:id/calculate', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const result = await runService.calculate(request.authUser!.id, id, actorFrom(request, 'costista'));
    return {
      data: {
        runId: result.run.id,
        runN: result.run.runN,
        // T-07 — la fila legada nace de ESTA misma corrida. Se devuelve su id
        // para que quede explícito que el número que se muestra y el árbol que
        // lo explica salen del mismo cálculo, y no de dos ejecuciones distintas
        // que casualmente coincidieron.
        calculationId: result.calculation.id,
        results: result.results, // incluye `results.incompletitud`
        // Atajo en el nivel superior (F04): el front decide con esto si pinta
        // una advertencia en vez de un margen "sano".
        incompleto: result.incompletitud,
        tree: result.tree,
      },
    };
  });

  app.get('/calculation-runs/:id/tree', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const tree = await runService.getTree(request.authUser!.id, id);
    return { data: tree };
  });

  // Historial completo de corridas. Por defecto vienen TODAS, incluidas las
  // automáticas sin validar: esta es la vista de trazabilidad y su razón de ser
  // es no esconder nada. `?soloValidadas=true` para las pantallas que quieren
  // únicamente lo que un humano firmó.
  app.get('/structures/:id/runs', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { soloValidadas } = runsQuery.parse(request.query);
    const runs = await runService.listRuns(request.authUser!.id, id, soloValidadas);
    return { data: runs };
  });

  // El resultado que vale hoy. Si nadie validó todavía, devuelve la última
  // corrida automática con `provisorio: true` y el motivo en castellano — no
  // vacío, que le escondería al costista que el sistema viene calculando.
  app.get('/structures/:id/resultado-vigente', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    return { data: await runService.currentResult(request.authUser!.id, id) };
  });

  // Un humano da por buena una corrida automática. No existe el inverso:
  // validar es un hecho con fecha y autor, y borrarlo dejaría el historial
  // diciendo que nadie miró algo que sí se miró.
  app.post('/calculation-runs/:id/validate', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const result = await runService.validateRun(
      request.authUser!.id,
      id,
      actorFrom(request, 'costista'),
    );
    return { data: result };
  });

  // ---------------------------------------------------------------------------
  // Datos atrasados: los que llegaron para un período ya cerrado.
  // ---------------------------------------------------------------------------

  // La bandeja del costista. Cada ítem trae las opciones con su CONSECUENCIA
  // escrita: "¿qué pasa si hago esto?" antes de apretar, no después.
  app.get('/late-data-decisions', { preHandler: authenticate }, async (request) => {
    return { data: await lateDataService.listPending(request.authUser!.id) };
  });

  app.post('/late-data-decisions/:id/resolve', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { choice, reason } = resolveLateDataSchema.parse(request.body);
    const result = await lateDataService.resolve(
      request.authUser!.id,
      id,
      choice,
      reason,
      actorFrom(request, 'costista'),
    );
    return { data: result };
  });

  // Crear un data point (bootstrap de un dato nuevo — la spec no numera este
  // endpoint explícitamente, pero sin él /versions no tiene sobre qué
  // corregir; ver DECISIONES.md).
  app.post('/structures/:id/data-points', { preHandler: authenticate }, async (request, reply) => {
    const { id: structureId } = idParam.parse(request.params);
    const input = createDataPointSchema.parse(request.body);
    const dp = await service.create(
      request.authUser!.id,
      structureId,
      input,
      actorFrom(request, input.sourceArea),
    );
    return reply.status(201).send({ data: dp });
  });

  // F06 — movimientos de MP con su estado de imputación (incluye los pendientes),
  // para que la ficha PPP los muestre y los haga accionables sin ocultar ninguno.
  app.get('/structures/:id/mp-movements', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const movements = await service.listMpMovements(request.authUser!.id, id);
    return { data: movements };
  });

  app.get('/data-points/:id/trace', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const trace = await service.getTrace(request.authUser!.id, id);
    return { data: trace };
  });

  app.post('/data-points/:id/versions', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const input = addVersionSchema.parse(request.body);
    const result = await service.addVersion(
      request.authUser!.id,
      id,
      input,
      actorFrom(request, input.sourceArea),
    );
    return { data: result };
  });

  // ---------------------------------------------------------------------------
  // Comprobantes (T-04). Hasta acá, "hasta el comprobante" era una promesa sin
  // ninguna ruta que la cumpliera: nada en el sistema creaba una fila de
  // `evidence`.
  // ---------------------------------------------------------------------------

  // Alta de un comprobante. `file` es opcional: sin almacenamiento configurado
  // se registra igual como referencia (fileUrl NULL) y la respuesta lo avisa.
  app.post('/evidence', { preHandler: authenticate }, async (request, reply) => {
    const input = evidenceSchema.parse(request.body);
    const ev = await evidenceService.create(
      request.authUser!.id,
      input,
      actorFrom(request, 'costista'),
    );
    return reply.status(201).send({ data: ev });
  });

  // Adjuntar un comprobante a un dato ya cargado. Crea una VERSIÓN NUEVA del
  // dato con el comprobante; jamás pisa la vigente (R1).
  app.post('/data-points/:id/evidence', { preHandler: authenticate }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const input = attachEvidenceSchema.parse(request.body);
    const result = await evidenceService.attach(
      request.authUser!.id,
      id,
      input,
      actorFrom(request, input.sourceArea),
    );
    return reply.status(201).send({ data: result });
  });

  app.post('/data-points/:id/validate', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { sourceArea } = validateDataPointSchema.parse(request.body);
    const dp = await service.validate(
      request.authUser!.id,
      id,
      sourceArea,
      actorFrom(request, sourceArea),
    );
    return { data: dp };
  });

  app.post('/data-points/:id/pedir-revision', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { sourceArea, comment } = requestRevisionSchema.parse(request.body);
    await service.requestRevision(
      request.authUser!.id,
      id,
      comment,
      sourceArea,
      actorFrom(request, sourceArea),
    );
    return { data: { ok: true } };
  });

  app.post('/data-points/:id/imputacion', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { sourceArea, periodo } = imputacionSchema.parse(request.body);
    const dp = await service.imputar(
      request.authUser!.id,
      id,
      periodo,
      sourceArea,
      actorFrom(request, sourceArea),
    );
    return { data: dp };
  });

  app.get('/structures/:id/audit', { preHandler: authenticate }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { page, pageSize } = paginationQuery.parse(request.query);
    const audit = await service.getAudit(request.authUser!.id, id, page, pageSize);
    return { data: audit };
  });
}
