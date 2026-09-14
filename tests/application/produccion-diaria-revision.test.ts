import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { ProduccionDiariaService } from '@/application/operacion/produccion-diaria-service.js';
import { PRODUCCION_SUPERA_PLANTEL } from '@/domain/operacion/revision-carga-campo.js';

const withTenant = vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(dbActual));
vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: {},
  withTenant: (...args: unknown[]) => withTenant(...(args as [string, (tx: unknown) => unknown])),
}));
vi.mock('@/application/audit/trace-audit.js', () => ({ recordTraceAudit: vi.fn(async () => undefined) }));

let dbActual: Record<string, unknown>;
const USER = '11111111-1111-4111-8111-111111111111';
const LOTE = { id: '22222222-2222-4222-8222-222222222222', userId: USER, companyId: '33333333-3333-4333-8333-333333333333' };
const ACTOR = { id: USER, role: 'COSTISTA', area: 'costista', method: 'manual' };

function service(avesVivas: number) {
  const db: Record<string, unknown> = {
    loteProductivo: { findFirst: vi.fn(async () => LOTE) },
    eventoLote: { findMany: vi.fn(async () => [{ tipo: 'ALTA', cantidad: avesVivas, motivo: null }]) },
    produccionDiaria: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'produccion-1', ...data })),
    },
  };
  dbActual = db;
  return new ProduccionDiariaService(db as unknown as PrismaClient);
}

describe('revisiÃ³n de producciÃ³n diaria', () => {
  it('guarda producciÃ³n normal sin marcarla', async () => {
    const resultado = await service(100).create(USER, LOTE.id, {
      fecha: '2026-09-01', variante: 'Huevo', unidadesProducidas: 90, roturas: 0, descartes: 0,
    }, ACTOR);
    expect(resultado).toMatchObject({ requiereRevision: false, motivoRevision: null });
  });

  it('guarda producciÃ³n imposible y la marca para revisiÃ³n', async () => {
    const resultado = await service(100).create(USER, LOTE.id, {
      fecha: '2026-09-01', variante: 'Huevo', unidadesProducidas: 101, roturas: 0, descartes: 0,
    }, ACTOR);
    expect(resultado).toMatchObject({
      requiereRevision: true,
      motivoRevision: PRODUCCION_SUPERA_PLANTEL,
    });
  });
});
