import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ValidacionesService } from '../../../application/validaciones/validaciones-service.js';
import { EmpresaConnectionService } from '../../../application/empresa/empresa-connection-service.js';
import { authenticate } from '../plugins/authenticate.js';

const DOC_TYPES = [
  'FACTURA_COMPRA', 'FACTURA_VENTA', 'REMITO', 'LIQUIDACION_MOD',
  'PLANILLA_HORAS', 'NOTA_DEBITO', 'NOTA_CREDITO', 'DESCONOCIDO',
] as const;
const COST_SECTIONS = [
  'MATERIA_PRIMA', 'MANO_DE_OBRA', 'COSTOS_INDIRECTOS', 'VENTAS', 'DESCONOCIDO',
] as const;

const reviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'CORRECTED']),
  note: z.string().max(500).optional(),
  correctedContent: z.string().max(10_000).optional(),
  // Corrección estructurada: a qué tipo / sección lo reclasificó el costista.
  // Es la verdad de oro que alimenta el aprendizaje del clasificador.
  correctedDocumentType: z.enum(DOC_TYPES).optional(),
  correctedCostSection: z.enum(COST_SECTIONS).optional(),
});

const submitViaKeySchema = z.object({
  rawContent: z.string().min(1).max(10_000),
  sourceType: z.enum(['TEXT', 'PDF', 'IMAGE', 'WHATSAPP']).default('TEXT'),
});

export async function registerValidacionesRoutes(app: FastifyInstance): Promise<void> {
  const svc = new ValidacionesService();
  const connSvc = new EmpresaConnectionService();

  // ----- Conexiones empresa -----

  // Listar conexiones del costista
  app.get('/conexiones', { preHandler: authenticate }, async (request, reply) => {
    const items = await connSvc.listConnections(request.authUser!.id);
    return reply.send({ data: items });
  });

  // Crear conexión para una empresa
  app.post('/conexiones/:companyId', { preHandler: authenticate }, async (request, reply) => {
    const { companyId } = request.params as { companyId: string };
    const conn = await connSvc.createConnection(companyId, request.authUser!.id);
    return reply.status(201).send({ data: conn });
  });

  // Rotar API key
  app.post('/conexiones/:connectionId/rotate-key', { preHandler: authenticate }, async (request, reply) => {
    const { connectionId } = request.params as { connectionId: string };
    const conn = await connSvc.rotateApiKey(connectionId, request.authUser!.id);
    return reply.send({ data: { apiKey: conn.apiKey } });
  });

  // Eliminar conexión
  app.delete('/conexiones/:connectionId', { preHandler: authenticate }, async (request, reply) => {
    const { connectionId } = request.params as { connectionId: string };
    await connSvc.deleteConnection(connectionId, request.authUser!.id);
    return reply.send({ data: { success: true } });
  });

  // ----- Submit público por API key (sin JWT) -----

  app.post('/datos/submit', async (request, reply) => {
    const apiKey = (request.headers['x-api-key'] as string) ?? '';
    if (!apiKey) {
      return reply.status(401).send({ error: { message: 'API key requerida' } });
    }
    const input = submitViaKeySchema.parse(request.body);
    const entry = await connSvc.submitDataViaApiKey(apiKey, input);
    return reply.status(201).send({ data: { id: entry.id, status: entry.status } });
  });

  // ----- Validaciones (costista revisa) -----

  // Listar pendientes
  app.get('/validaciones/pending', { preHandler: authenticate }, async (request, reply) => {
    const { page, limit } = request.query as { page?: string; limit?: string };
    const result = await svc.listPending(
      request.authUser!.id,
      Number(page ?? 1),
      Number(limit ?? 20),
    );
    return reply.send({ data: result });
  });

  // Contar pendientes (para el dashboard)
  app.get('/validaciones/pending/count', { preHandler: authenticate }, async (request, reply) => {
    const count = await svc.countPending(request.authUser!.id);
    return reply.send({ data: { count } });
  });

  // Historial de entradas resueltas
  app.get('/validaciones/historial', { preHandler: authenticate }, async (request, reply) => {
    const { page, limit } = request.query as { page?: string; limit?: string };
    const result = await svc.listHistorial(
      request.authUser!.id,
      Number(page ?? 1),
      Number(limit ?? 20),
    );
    return reply.send({ data: result });
  });

  // Revisar una entrada (aprobar / rechazar / corregir)
  app.post('/validaciones/:entryId/review', { preHandler: authenticate }, async (request, reply) => {
    const { entryId } = request.params as { entryId: string };
    const input = reviewSchema.parse(request.body);
    const updated = await svc.review(entryId, request.authUser!.id, input);
    return reply.send({ data: updated });
  });

  // Aprobación masiva de las entradas que el clasificador resolvió con confianza
  app.post('/validaciones/bulk-approve', { preHandler: authenticate }, async (request, reply) => {
    const { companyId } = (request.body ?? {}) as { companyId?: string };
    const result = await svc.bulkApproveConfident(request.authUser!.id, companyId);
    return reply.send({ data: result });
  });

  // Feed unificado para Centro de automatización (todas los estados, reciente primero)
  app.get('/validaciones/feed', { preHandler: authenticate }, async (request, reply) => {
    const result = await svc.listFeed(request.authUser!.id);
    return reply.send(result);
  });

  // Métricas de precisión del clasificador
  app.get('/validaciones/accuracy', { preHandler: authenticate }, async (request, reply) => {
    const stats = await svc.getAccuracyStats(request.authUser!.id);
    return reply.send({ data: stats });
  });

  // Panel "qué necesita mi atención hoy" cruzando todas las empresas
  app.get('/validaciones/attention', { preHandler: authenticate }, async (request, reply) => {
    const items = await svc.getAttentionOverview(request.authUser!.id);
    return reply.send({ data: items });
  });

  // Libro mayor de costos respaldado por documentos (trazabilidad)
  app.get('/validaciones/ledger', { preHandler: authenticate }, async (request, reply) => {
    const { companyId, period } = request.query as { companyId?: string; period?: string };
    const ledger = await svc.getLedger(request.authUser!.id, { companyId, period });
    return reply.send({ data: ledger });
  });

  // Carga manual de una línea del libro mayor
  const manualLedgerSchema = z.object({
    companyId: z.string().uuid(),
    period: z.string().regex(/^\d{4}-\d{2}$/),
    costSection: z.enum(COST_SECTIONS),
    description: z.string().min(1).max(200),
    amount: z.number().finite().positive().max(9_999_999_999_999),
    supplier: z.string().max(120).optional(),
    currency: z.string().max(8).optional(),
    docDate: z.string().optional(),
  });
  app.post('/validaciones/ledger', { preHandler: authenticate }, async (request, reply) => {
    const input = manualLedgerSchema.parse(request.body);
    const created = await svc.createManualLedgerEntry(request.authUser!.id, input);
    return reply.status(201).send({ data: created });
  });

  // Editar una línea del libro mayor
  const updateLedgerSchema = z.object({
    costSection: z.enum(COST_SECTIONS).optional(),
    description: z.string().min(1).max(200).optional(),
    amount: z.number().finite().positive().max(9_999_999_999_999).optional(),
    supplier: z.string().max(120).nullable().optional(),
    period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    currency: z.string().max(8).optional(),
    docDate: z.string().nullable().optional(),
  });
  app.patch('/validaciones/ledger/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = updateLedgerSchema.parse(request.body);
    const updated = await svc.updateLedgerEntry(request.authUser!.id, id, input);
    return reply.send({ data: updated });
  });

  // Borrar una línea del libro mayor
  app.delete('/validaciones/ledger/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await svc.deleteLedgerEntry(request.authUser!.id, id);
    return reply.send({ data: result });
  });

  // Historial de transiciones de una entrada
  app.get('/validaciones/:entryId/history', { preHandler: authenticate }, async (request, reply) => {
    const { entryId } = request.params as { entryId: string };
    const history = await svc.getEntryHistory(entryId, request.authUser!.id);
    return reply.send({ data: history });
  });
}
