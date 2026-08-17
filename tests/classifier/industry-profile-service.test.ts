import { describe, it, expect, vi, beforeEach } from 'vitest';

const AVICULTURA_ROW = {
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
};

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { industryProfile: { findMany: vi.fn() } },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({ prisma: mockPrisma }));

const { industryProfileService } = await import(
  '@/infrastructure/classifier/industry/industry-profile-service.js'
);

beforeEach(() => {
  vi.clearAllMocks();
  industryProfileService.invalidateCache();
});

describe('IndustryProfileService', () => {
  it('getProfile devuelve el perfil mapeado correctamente desde DB', async () => {
    mockPrisma.industryProfile.findMany.mockResolvedValue([AVICULTURA_ROW]);

    const profile = await industryProfileService.getProfile('AVICULTURA');

    expect(profile).not.toBeNull();
    expect(profile!.category).toBe('AVICULTURA');
    expect(profile!.label).toBe('Avicultura de postura');
    expect(profile!.energyIsMP).toBe(false);
    expect(profile!.fuelIsMP).toBe(false);
    expect(profile!.mpKeywords).toContain('balanceado');
  });

  it('getProfile devuelve null para categoría inexistente en DB', async () => {
    mockPrisma.industryProfile.findMany.mockResolvedValue([AVICULTURA_ROW]);

    const profile = await industryProfileService.getProfile('AGRO');

    expect(profile).toBeNull();
  });

  it('el caché evita una segunda consulta a DB dentro del TTL', async () => {
    mockPrisma.industryProfile.findMany.mockResolvedValue([AVICULTURA_ROW]);

    await industryProfileService.getProfile('AVICULTURA');
    await industryProfileService.getProfile('AVICULTURA');

    expect(mockPrisma.industryProfile.findMany).toHaveBeenCalledTimes(1);
  });

  it('invalidateCache fuerza recarga en el próximo acceso', async () => {
    mockPrisma.industryProfile.findMany.mockResolvedValue([AVICULTURA_ROW]);

    await industryProfileService.getProfile('AVICULTURA');
    industryProfileService.invalidateCache();
    await industryProfileService.getProfile('AVICULTURA');

    expect(mockPrisma.industryProfile.findMany).toHaveBeenCalledTimes(2);
  });
});
