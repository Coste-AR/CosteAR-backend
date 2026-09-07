import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { PaqueteRubroService } from '@/application/operacion/paquete-rubro-service.js';

const rows = [
  {
    category: 'RUBRO', companyId: null, structureId: null, periodId: null, userId: null,
    lexicon: { UnidadProductiva: 'Rubro' }, icons: {}, variants: [], seedParameters: {}, alertRules: {}, screens: {},
    scale: { value: 100, unit: 'unidades_fisicas_por_anio' },
  },
  {
    category: 'RUBRO', companyId: 'company', structureId: null, periodId: null, userId: 'user',
    lexicon: { UnidadProductiva: 'Empresa' }, icons: {}, variants: [], seedParameters: {}, alertRules: {}, screens: {},
    scale: { value: 500, unit: 'unidades_fisicas_por_anio' },
  },
];

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: {},
  withTenant: vi.fn(async (_u: string, fn: (tx: unknown) => unknown) => fn({
    paqueteRubro: { findMany: vi.fn(async () => rows) },
  })),
}));

describe('PaqueteRubroService', () => {
  it('empresa gana al rubro', async () => {
    const result = await new PaqueteRubroService({} as PrismaClient).resolve('user', 'RUBRO', { companyId: 'company' });
    expect((result.lexicon as Record<string, string>).UnidadProductiva).toBe('Empresa');
    expect(result.scale).toEqual({ value: 500, unit: 'unidades_fisicas_por_anio' });
  });

  it('clave ausente devuelve default del núcleo', async () => {
    const result = await new PaqueteRubroService({} as PrismaClient).resolve('user', 'OTRO');
    expect(result.defaults['lexicon.UnidadProductiva']).toBe('Unidad productiva');
  });
});
