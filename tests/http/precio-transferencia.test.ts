import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

const COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const destino = { precioUnitario: 48_000, costoVariableUnitario: 15_000, costoFijoDirecto: 15_000_000 };
const { db } = vi.hoisted(() => ({ db: { company: { findFirst: vi.fn() }, costPeriod: { findFirst: vi.fn() }, precioTransferencia: { findMany: vi.fn() } } }));
vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: db, withTenant: async (_id: string, fn: (tx: typeof db) => unknown) => fn(db) }));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({ authenticate: async (request: FastifyRequest, _reply: FastifyReply) => { (request as FastifyRequest & { authUser: object }).authUser = { id: USER_ID }; } }));

async function appDePrueba() { const Fastify = (await import('fastify')).default; const { errorHandler } = await import('@/infrastructure/http/error-handler.js'); const { registerPrecioTransferenciaRoutes } = await import('@/infrastructure/http/routes/precio-transferencia.routes.js'); const app = Fastify({ logger: false }); app.setErrorHandler(errorHandler); await app.register(registerPrecioTransferenciaRoutes); await app.ready(); return app; }

beforeEach(() => { vi.clearAllMocks(); db.company.findFirst.mockResolvedValue({ id: COMPANY_ID }); db.costPeriod.findFirst.mockResolvedValue({ id: 'p' }); db.precioTransferencia.findMany.mockResolvedValue([{ criterio: 'COSTO_VARIABLE', valor: 2600, unidad: 'cajones', segmentoDestino: destino }, { criterio: 'MERCADO', valor: 3600, unidad: 'cajones', segmentoDestino: destino }]); });

describe('GET /companies/:companyId/analisis/precio-transferencia', () => {
  it('publica AM-11 y explica el uso de ambos criterios', async () => { const app = await appDePrueba(); const response = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/analisis/precio-transferencia` }); expect(response.statusCode).toBe(200); expect(response.json().data).toMatchObject({ equilibrioACostoVariable: 493.42105263157896, equilibrioAMercado: 510.2040816326531, diferencia: 16.783029, criterioDecisionMarginal: 'COSTO_VARIABLE' }); await app.close(); });
  it('si se pide mercado para decidir, devuelve costo variable y lo advierte', async () => { const app = await appDePrueba(); const response = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/analisis/precio-transferencia?criterioDecision=MERCADO` }); expect(response.statusCode).toBe(200); expect(response.json().data.avisoDecisionMarginal).toMatch(/mercado.*costo variable/i); await app.close(); });
});
