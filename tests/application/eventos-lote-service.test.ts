import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { EventosLoteService } from '@/application/operacion/eventos-lote-service.js';
import { eventoLoteCreateSchema } from '@/shared/schemas/eventos-lote.schema.js';

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

function service(eventos: Array<{ tipo: 'ALTA' | 'BAJA'; cantidad: number; motivo: string | null }> = []) {
  const db: Record<string, unknown> = {
    loteProductivo: { findFirst: vi.fn(async () => LOTE) },
    eventoLote: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'evento-1', ...data })),
      findMany: vi.fn(async () => eventos),
    },
  };
  dbActual = db;
  return new EventosLoteService(db as unknown as PrismaClient);
}

describe('#194 — eventos de lote y saldo derivado', () => {
  it('la API exige motivo para una baja manual', () => {
    expect(eventoLoteCreateSchema.safeParse({ tipo: 'baja', cantidad: 2, fecha: '2026-09-01' }).success).toBe(false);
    expect(eventoLoteCreateSchema.safeParse({ tipo: 'baja', cantidad: 2, fecha: '2026-09-01', motivo: 'mortalidad' }).success).toBe(true);
  });

  it('persiste altas y bajas, sin una columna editable de cantidad viva', async () => {
    const resultado = await service().create(USER, LOTE.id, {
      tipo: 'alta', cantidad: 12, fecha: '2026-09-01',
    }, ACTOR);
    expect(resultado).toMatchObject({ tipo: 'ALTA', cantidad: 12, motivo: null });
    const create = (dbActual.eventoLote as { create: ReturnType<typeof vi.fn> }).create;
    expect(create.mock.calls[0]![0].data).not.toHaveProperty('cantidadViva');
  });

  it('deriva el saldo y deja fuera una baja importada sin motivo', async () => {
    const resultado = await service([
      { tipo: 'ALTA', cantidad: 12, motivo: null },
      { tipo: 'BAJA', cantidad: 2, motivo: 'MORTALIDAD' },
      { tipo: 'BAJA', cantidad: 3, motivo: null },
    ]).poblacion(USER, LOTE.id);

    expect(resultado.cantidadViva).toBe(10);
    expect(resultado.pendientes).toHaveLength(1);
  });
});
