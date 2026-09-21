import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const COMPANY_ID = '20000000-0000-4000-8000-000000000002';
const DATE = new Date('2026-09-18T00:00:00.000Z');

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    company: { findFirst: vi.fn() },
    paqueteRubro: { findMany: vi.fn() },
    macroSnapshot: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockDb,
  withTenant: vi.fn(async (_userId: string, callback: (tx: typeof mockDb) => unknown) => callback(mockDb)),
}));
vi.mock('@/infrastructure/workers/queues.js', () => ({ macroSyncQueue: { add: vi.fn() } }));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { authUser: object }).authUser = {
      id: USER_ID, tenantId: USER_ID, role: 'COSTISTA', jobTitle: null,
    };
  },
}));

const packageRow = {
  category: 'AVICOLA_POSTURA', companyId: null, structureId: null, periodId: null, userId: null,
  lexicon: {}, icons: {}, variants: [], seedParameters: [], alertRules: [], screens: {}, modulos: [], scale: null,
};

const rows = [
  ['BCRA', 'USD_OFICIAL', 1450, {}],
  ['INDEC', 'IPC_NACIONAL', 2.1, {}],
  ['DOLARAPI', 'USD_BLUE', 1475, {}],
  ['CAPIA', 'CAPIA_HUEVO_BLANCO_CAJON', 45461.54, { unit: 'cajon', product: 'Huevo blanco grande' }],
  ['CAPIA', 'CAPIA_HUEVO_COLOR_CAJON', 46900, { unit: 'cajon', product: 'Huevo color grande' }],
  ['CAPIA', 'CAPIA_ALIMENTO_PONEDORA_KG', 512.4, { unit: 'kg', product: 'Alimento ponedora' }],
  ['CAPIA', 'CAPIA_MAIZ_TON', 235000, { unit: 'ton', product: 'Maíz disponible' }],
  ['CAPIA', 'CAPIA_SOJA_TON', 410000, { unit: 'ton', product: 'Soja disponible' }],
  ['CAPIA', 'CAPIA_MAPLE_UNIDAD', 220, { unit: 'unidad', product: 'Maple' }],
].map(([source, indicatorCode, value, metadata]) => ({ source, indicatorCode, value, metadata, effectiveDate: DATE }));

async function buildTestApp() {
  const Fastify = (await import('fastify')).default;
  const { registerMacroRoutes } = await import('@/infrastructure/http/routes/macro.routes.js');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  await app.register(registerMacroRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.company.findFirst.mockResolvedValue({ id: COMPANY_ID, industry: 'AVICULTURA' });
  mockDb.paqueteRubro.findMany.mockResolvedValue([packageRow]);
  mockDb.macroSnapshot.findMany.mockResolvedValue(rows);
});

describe('GET /companies/:companyId/indicadores-macro', () => {
  it('publica dólar, inflación y referencias del paquete con fecha y fuente navegable', async () => {
    const response = await (await buildTestApp()).inject({
      method: 'GET',
      url: `/companies/${COMPANY_ID}/indicadores-macro`,
    });

    expect(response.statusCode).toBe(200);
    const data = response.json().data as Array<Record<string, unknown>>;
    expect(data.map((item) => item.clave)).toEqual([
      'USD_OFICIAL', 'IPC_NACIONAL', 'USD_BLUE',
      'CAPIA_HUEVO_BLANCO_CAJON', 'CAPIA_HUEVO_COLOR_CAJON',
      'CAPIA_ALIMENTO_PONEDORA_KG', 'CAPIA_MAIZ_TON', 'CAPIA_SOJA_TON', 'CAPIA_MAPLE_UNIDAD',
    ]);
    expect(data).toHaveLength(9);
    expect(data.every((item) => typeof item.fuenteUrl === 'string' && item.fuenteUrl.length > 0)).toBe(true);
    expect(data.every((item) => item.fecha === DATE.toISOString())).toBe(true);
    expect(data.find((item) => item.clave === 'CAPIA_MAIZ_TON')).toMatchObject({
      etiqueta: 'Maíz', valor: 235000, unidad: 'ton', fuenteNombre: 'CAPIA',
    });
  });

  it('declara sólo la fuente ausente y conserva el resto de la respuesta', async () => {
    mockDb.macroSnapshot.findMany.mockResolvedValue(rows.filter((row) => row.indicatorCode !== 'USD_OFICIAL'));

    const response = await (await buildTestApp()).inject({
      method: 'GET',
      url: `/companies/${COMPANY_ID}/indicadores-macro`,
    });

    expect(response.statusCode).toBe(200);
    const data = response.json().data as Array<Record<string, unknown>>;
    expect(data.find((item) => item.clave === 'USD_OFICIAL')).toMatchObject({
      valor: null,
      fecha: null,
      error: 'fuente no disponible',
    });
    expect(data.find((item) => item.clave === 'IPC_NACIONAL')).toMatchObject({ valor: 2.1 });
  });

  it('toma las referencias sectoriales de la configuración del paquete', async () => {
    mockDb.paqueteRubro.findMany.mockResolvedValue([{
      ...packageRow,
      screens: {
        indicadoresMacro: [
          { clave: 'CAPIA_SOJA_TON', etiqueta: 'Soja de referencia', unidad: 'ton', fuente: 'CAPIA' },
        ],
      },
    }]);

    const response = await (await buildTestApp()).inject({
      method: 'GET',
      url: `/companies/${COMPANY_ID}/indicadores-macro`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([
      expect.objectContaining({ clave: 'USD_OFICIAL' }),
      expect.objectContaining({ clave: 'IPC_NACIONAL' }),
      expect.objectContaining({ clave: 'CAPIA_SOJA_TON', etiqueta: 'Soja de referencia' }),
    ]);
  });
});
