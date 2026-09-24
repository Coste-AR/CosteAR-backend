import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

const COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const RUN_ID = '00000000-0000-4000-8000-000000000003';
const { db } = vi.hoisted(() => ({ db: {
  company: { findFirst: vi.fn() }, calculationRun: { findFirst: vi.fn() },
} }));

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: db,
  withTenant: async (_userId: string, fn: (tx: typeof db) => unknown) => fn(db),
}));
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { authUser: object }).authUser = { id: USER_ID, role: 'EMPRESA_ADMIN', jobTitle: null };
  },
}));

async function appDePrueba() {
  const Fastify = (await import('fastify')).default;
  const { registerCapacidadOciosaRoutes } = await import('@/infrastructure/http/routes/capacidad-ociosa.routes.js');
  const app = Fastify({ logger: false });
  await app.register(registerCapacidadOciosaRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.company.findFirst.mockResolvedValue({ operationScaleValue: { toString: () => '1000' }, operationScaleUnit: 'unidades_por_periodo' });
  db.calculationRun.findFirst.mockResolvedValue({
    id: RUN_ID, validated: true, executedAt: new Date('2026-09-23T12:00:00.000Z'),
    results: {
      detail: {
        unitCost: { unitsProduced: 900 },
        directLabor: { idleCapacity: { idleHours: 10, idleCost: 5_000, applicableMod: 45_000, breakdown: [], alert: null, destination: 'perdida-del-periodo' } },
        indirectCosts: { perDepartment: { fabrica: { budgetVariance: 1_200, volumeVariance: 4_800, overUnderApplied: -6_000 } } },
      },
      contribucionMarginal: { incompleta: false, contribucionMarginalUnitaria: 256 },
    },
  });
});

describe('GET /companies/:companyId/analisis/capacidad-ociosa', () => {
  it('publica R22, MOD y CIP por separado, con AM-05 exacto', async () => {
    const app = await appDePrueba();
    const response = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/analisis/capacidad-ociosa` });
    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.body).data;
    expect(data.ociosidadR22.valor).toBe(25_600);
    expect(data.manoDeObra).toMatchObject({ idleHours: 10, idleCost: 5_000 });
    expect(data.cip).toMatchObject({ variacionVolumen: 4_800, controlDosVias: { cierra: true, diferencia: 0 } });
    expect(data).not.toHaveProperty('ociosidadTotal');
    await app.close();
  });

  it('camino rojo: no inventa R22 sin escala y mantiene tres vías bloqueadas', async () => {
    db.company.findFirst.mockResolvedValue({ operationScaleValue: null, operationScaleUnit: null });
    const app = await appDePrueba();
    const response = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/analisis/capacidad-ociosa` });
    const data = JSON.parse(response.body).data;
    expect(data.ociosidadR22).toMatchObject({ valor: null });
    expect(data.ociosidadR22.motivo).toMatch(/capacidad normal/i);
    expect(data.tresVias).toMatchObject({ bloqueada: true });
    expect(data.tresVias.motivo).toMatch(/base estándar/i);
    await app.close();
  });

  it('no mezcla una escala anual con la actividad de una corrida', async () => {
    db.company.findFirst.mockResolvedValue({ operationScaleValue: { toString: () => '12000' }, operationScaleUnit: 'unidades_fisicas_por_anio' });
    const app = await appDePrueba();
    const response = await app.inject({ method: 'GET', url: `/companies/${COMPANY_ID}/analisis/capacidad-ociosa` });
    expect(JSON.parse(response.body).data.ociosidadR22).toMatchObject({ valor: null, capacidadNormal: null });
    await app.close();
  });
});
