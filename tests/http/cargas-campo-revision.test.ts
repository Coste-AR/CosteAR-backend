import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { BAJA_SUPERA_PLANTEL, PRODUCCION_SUPERA_PLANTEL } from '@/domain/operacion/revision-carga-campo.js';

const USER = '11111111-1111-4111-8111-111111111111';
const LOTE_ID = '22222222-2222-4222-8222-222222222222';
const COMPANY_ID = '33333333-3333-4333-8333-333333333333';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    loteProductivo: { findFirst: vi.fn() },
    eventoLote: { findMany: vi.fn(), create: vi.fn() },
    produccionDiaria: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockPrisma,
  withTenant: async (_userId: string, fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
}));
vi.mock('@/application/audit/trace-audit.js', () => ({ recordTraceAudit: vi.fn(async () => undefined) }));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { authUser: object }).authUser = { id: USER, role: 'EMPRESA_ADMIN', jobTitle: null };
  },
}));

async function buildApp() {
  const Fastify = (await import('fastify')).default;
  const { registerProduccionDiariaRoutes } = await import('@/infrastructure/http/routes/produccion-diaria.routes.js');
  const { registerEventosLoteRoutes } = await import('@/infrastructure/http/routes/eventos-lote.routes.js');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(registerProduccionDiariaRoutes);
  await app.register(registerEventosLoteRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.loteProductivo.findFirst.mockResolvedValue({ id: LOTE_ID, userId: USER, companyId: COMPANY_ID });
  mockPrisma.eventoLote.findMany.mockResolvedValue([{ tipo: 'ALTA', cantidad: 100, motivo: null }]);
  mockPrisma.eventoLote.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'evento-1', ...data }));
  mockPrisma.produccionDiaria.findFirst.mockResolvedValue(null);
  mockPrisma.produccionDiaria.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'produccion-1', ...data }));
});

describe('contrato HTTP de revisiÃ³n de cargas de campo â€” #355', () => {
  it('201 â€” persiste y devuelve una producciÃ³n fuera de rango marcada', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/lotes/${LOTE_ID}/producciones`,
      payload: { fecha: '2026-09-01', variante: 'Huevo', unidadesProducidas: 101, roturas: 0, descartes: 0 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      requiereRevision: true,
      motivoRevision: PRODUCCION_SUPERA_PLANTEL,
    });
    expect(mockPrisma.produccionDiaria.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requiereRevision: true }),
    }));
    await app.close();
  });

  it('201 â€” persiste una producciÃ³n normal sin marcarla', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/lotes/${LOTE_ID}/producciones`,
      payload: { fecha: '2026-09-01', variante: 'Huevo', unidadesProducidas: 90, roturas: 0, descartes: 0 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ requiereRevision: false, motivoRevision: null });
    await app.close();
  });

  it('201 â€” persiste y devuelve una baja fuera de rango marcada', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/lotes/${LOTE_ID}/eventos`,
      payload: { tipo: 'baja', fecha: '2026-09-01', cantidad: 101, motivo: 'mortalidad' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      requiereRevision: true,
      motivoRevision: BAJA_SUPERA_PLANTEL,
    });
    expect(mockPrisma.eventoLote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requiereRevision: true }),
    }));
    await app.close();
  });
});
