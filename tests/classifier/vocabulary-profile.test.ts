import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndustryProfile } from '@/infrastructure/classifier/industry/industry-profile.js';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: { vocabularioTermino: { findMany } },
}));

const { getActiveVocabularyTerms, withVocabularyTerms } = await import(
  '@/infrastructure/classifier/industry/vocabulary-profile.js'
);
const { runLayer4 } = await import('@/infrastructure/classifier/layers/layer4-business-routing.js');

const profile: IndustryProfile = {
  category: 'AVICULTURA',
  label: 'Perfil de prueba',
  mpKeywords: ['existente'],
  cipKeywords: [],
  modKeywords: [],
  eventKeywords: [],
  lossKeywords: [],
  energyIsMP: false,
  fuelIsMP: false,
};

const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe('vocabulario de rubro en las keywords de Layer 4', () => {
  it('agrega término y variantes a la sección que ya interpreta el routing', () => {
    const extended = withVocabularyTerms(profile, [
      { termino: 'insumo dinámico', variantes: ['variante dinámica'], seccion: 'MATERIA_PRIMA' },
      { termino: 'tarea dinámica', variantes: [], seccion: 'COSTOS_INDIRECTOS' },
      { termino: 'dato sin ruteo', variantes: [], seccion: 'NO_APLICA' },
    ]);

    expect(extended.mpKeywords).toEqual(['existente', 'insumo dinámico', 'variante dinámica']);
    expect(extended.cipKeywords).toEqual(['tarea dinámica']);
    expect(extended.modKeywords).toEqual([]);
    expect(extended.mpKeywords).not.toContain('dato sin ruteo');
  });

  it('entrega el perfil extendido al routing sin cambiar sus reglas', () => {
    const extended = withVocabularyTerms(profile, [
      { termino: 'insumo dinámico', variantes: [], seccion: 'MATERIA_PRIMA' },
    ]);

    const result = runLayer4(
      'FACTURA_COMPRA',
      'Factura A por insumo dinámico',
      'AVICULTURA',
      undefined,
      extended,
    );

    expect(result.costSection).toBe('MATERIA_PRIMA');
    expect(result.requiresAI).toBe(false);
  });

  it('consulta solo las filas activas de la categoría solicitada', async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    findMany.mockResolvedValue([]);

    await getActiveVocabularyTerms('AVICULTURA');

    expect(findMany).toHaveBeenCalledWith({
      where: { industryCategory: 'AVICULTURA', isActive: true },
      select: { termino: true, variantes: true, seccion: true },
    });
  });

  it('no consulta Prisma si la base no está configurada', async () => {
    delete process.env.DATABASE_URL;

    await expect(getActiveVocabularyTerms('AVICULTURA')).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
