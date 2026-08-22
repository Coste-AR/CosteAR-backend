import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

const AVICULTURA_ROW = {
  id: 'uuid-avi',
  category: 'AVICULTURA',
  label: 'Avicultura de postura',
  mpKeywords: ['balanceado', 'maíz'],
  cipKeywords: ['vacuna', 'electricidad'],
  modKeywords: ['galponero'],
  eventKeywords: ['ola de calor'],
  lossKeywords: ['mortandad'],
  energyIsMP: false,
  fuelIsMP: false,
  detectPatterns: [],
  measurementUnit: 'docena',
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    industryProfile: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockPrisma }));

// Mockear authenticate y requireRole para no necesitar JWT real
vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { authUser: object }).authUser = {
      id: 'admin-id',
      tenantId: 'system',
      role: 'ADMIN',
    };
  },
  requireRole: (_role: string) => async () => {},
}));

vi.mock('@/infrastructure/classifier/industry/industry-profile-service.js', () => ({
  industryProfileService: { invalidateCache: vi.fn() },
}));

async function buildTestApp() {
  const Fastify = (await import('fastify')).default;
  const { registerIndustryProfileRoutes } = await import(
    '@/infrastructure/http/routes/industry-profile.routes.js'
  );
  const app = Fastify({ logger: false });
  await app.register(registerIndustryProfileRoutes);
  await app.ready();
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('GET /admin/industry-profiles', () => {
  it('200 — devuelve todos los perfiles ordenados', async () => {
    mockPrisma.industryProfile.findMany.mockResolvedValue([AVICULTURA_ROW]);

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/admin/industry-profiles' });

    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: typeof AVICULTURA_ROW[] };
    expect(data).toHaveLength(1);
    expect(data[0].category).toBe('AVICULTURA');
    // El GET de admin expone todos los campos, incluidos los que el servicio omite
    expect(data[0]).toHaveProperty('detectPatterns');
    expect(data[0]).toHaveProperty('measurementUnit');
    expect(data[0]).toHaveProperty('isActive');
  });

  it('Prisma recibe orderBy category', async () => {
    mockPrisma.industryProfile.findMany.mockResolvedValue([]);

    const app = await buildTestApp();
    await app.inject({ method: 'GET', url: '/admin/industry-profiles' });

    expect(mockPrisma.industryProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { category: 'asc' } }),
    );
  });
});

describe('PUT /admin/industry-profiles/:category', () => {
  it('200 — actualiza keywords y devuelve la fila actualizada', async () => {
    const updated = { ...AVICULTURA_ROW, mpKeywords: ['balanceado', 'maíz', 'marlo'] };
    mockPrisma.industryProfile.findUnique.mockResolvedValue(AVICULTURA_ROW);
    mockPrisma.industryProfile.update.mockResolvedValue(updated);

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/industry-profiles/AVICULTURA',
      payload: { mpKeywords: ['balanceado', 'maíz', 'marlo'] },
    });

    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: typeof updated };
    expect(data.mpKeywords).toContain('marlo');
  });

  it('invalida el caché del clasificador tras actualizar', async () => {
    const { industryProfileService } = await import(
      '@/infrastructure/classifier/industry/industry-profile-service.js'
    );
    mockPrisma.industryProfile.findUnique.mockResolvedValue(AVICULTURA_ROW);
    mockPrisma.industryProfile.update.mockResolvedValue(AVICULTURA_ROW);

    const app = await buildTestApp();
    await app.inject({
      method: 'PUT',
      url: '/admin/industry-profiles/AVICULTURA',
      payload: { energyIsMP: true },
    });

    expect(industryProfileService.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it('404 cuando la categoría no existe', async () => {
    mockPrisma.industryProfile.findUnique.mockResolvedValue(null);

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/industry-profiles/INEXISTENTE',
      payload: { energyIsMP: true },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toHaveProperty('error');
    expect(mockPrisma.industryProfile.update).not.toHaveBeenCalled();
  });

  it('400 cuando el body tiene tipos inválidos', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/industry-profiles/AVICULTURA',
      payload: { energyIsMP: 'si' }, // debe ser boolean
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(mockPrisma.industryProfile.findUnique).not.toHaveBeenCalled();
  });
});
