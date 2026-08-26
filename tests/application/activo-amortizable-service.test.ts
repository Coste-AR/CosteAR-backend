import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { ActivoAmortizableService } from '@/application/parametros/activo-amortizable-service.js';
import { NotFoundError, UnprocessableEntityError } from '@/domain/errors/domain-error.js';

const recordTraceAudit = vi.fn(async () => undefined);
vi.mock('@/application/audit/trace-audit.js', () => ({
  recordTraceAudit: (...args: unknown[]) => recordTraceAudit(...(args as [])),
}));

// Mismo patrón que `desperdicio-service.test.ts`: acá se prueba la lógica del
// servicio, no el aislamiento entre empresas — eso lo prueba la suite de
// integración con un rol de Postgres sin BYPASSRLS (DOM-07).
const withTenant = vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(dbActual));
vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: {},
  withTenant: (...args: unknown[]) => withTenant(...(args as [string, (tx: unknown) => unknown])),
}));

/**
 * #116 — el alta/baja/consulta que le faltaba al plantel como activo.
 */

const USER = 'user-1';
const COMPANY = { id: 'comp-1', userId: USER };

let dbActual: Record<string, unknown>;

function makeDb(overrides: Record<string, unknown> = {}) {
  const db: Record<string, unknown> = {
    company: { findFirst: vi.fn(async () => COMPANY) },
    costStructure: { findFirst: vi.fn(async () => ({ id: 'est-1', companyId: 'comp-1' })) },
    activoAmortizable: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'aa-1', ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'aa-1', ...data })),
    },
    ...overrides,
  };
  dbActual = db;
  return db;
}

function service(db: Record<string, unknown>) {
  return new ActivoAmortizableService(db as unknown as PrismaClient);
}

const ACTOR = { id: USER, role: 'COSTISTA', area: 'costista', method: 'manual' };
const INPUT = {
  nombre: 'Lote de ponedoras Hy-Line — alta marzo 2026',
  costoAdquisicion: 67_200_000,
  valorResidual: 0,
  vidaUtilMeses: null,
  fechaAlta: '2026-03-01',
  cantidad: 6300,
  unidadId: null,
  structureId: null,
};

describe('#116 — alta y consulta de activos amortizables', () => {
  beforeEach(() => {
    recordTraceAudit.mockClear();
    withTenant.mockClear();
  });

  it('crea el activo con los datos del alta', async () => {
    const db = makeDb();
    const r = await service(db).create(USER, 'comp-1', INPUT, ACTOR);

    expect(r).toMatchObject({ nombre: INPUT.nombre, costoAdquisicion: 67_200_000, companyId: 'comp-1' });
  });

  it('una empresa de otro usuario no existe para éste', async () => {
    const db = makeDb({ company: { findFirst: vi.fn(async () => null) } });
    await expect(service(db).create(USER, 'comp-ajena', INPUT, ACTOR)).rejects.toThrow(NotFoundError);
  });

  it('rechaza una estructura que no pertenece a la empresa', async () => {
    const db = makeDb({ costStructure: { findFirst: vi.fn(async () => null) } });
    await expect(
      service(db).create(USER, 'comp-1', { ...INPUT, structureId: 'est-ajena' }, ACTOR),
    ).rejects.toThrow(NotFoundError);
  });

  it('DOM-02: la bitácora se escribe en la MISMA transacción que la mutación', async () => {
    const db = makeDb();
    await service(db).create(USER, 'comp-1', INPUT, ACTOR);

    expect(withTenant).toHaveBeenCalledTimes(1);
    expect(recordTraceAudit).toHaveBeenCalledTimes(1);
    const [entry, tx] = recordTraceAudit.mock.calls[0] as unknown as [
      { entityType: string; action: string },
      unknown,
    ];
    expect(entry.entityType).toBe('ActivoAmortizable');
    expect(entry.action).toBe('create');
    expect(tx).toBe(dbActual);
  });

  it('la lista solo trae los vigentes: un activo dado de baja no vuelve', async () => {
    const db = makeDb();
    await service(db).list(USER, 'comp-1');
    const findMany = (db.activoAmortizable as { findMany: ReturnType<typeof vi.fn> }).findMany;
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: { companyId: 'comp-1', deletedAt: null },
    });
  });

  describe('update', () => {
    it('rechaza un residual mayor al costo, mirando lo que VA A QUEDAR', async () => {
      const db = makeDb({
        activoAmortizable: {
          findFirst: vi.fn(async () => ({
            id: 'aa-1',
            userId: USER,
            costoAdquisicion: 100_000,
            valorResidual: 0,
          })),
        },
      });
      await expect(
        service(db).update(USER, 'aa-1', { valorResidual: 150_000 }, ACTOR),
      ).rejects.toThrow(UnprocessableEntityError);
    });

    it('un activo de otro usuario no existe para éste', async () => {
      const db = makeDb({ activoAmortizable: { findFirst: vi.fn(async () => null) } });
      await expect(service(db).update(USER, 'aa-ajeno', { nombre: 'X' }, ACTOR)).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('remove', () => {
    it('DOM-01: borrar es lógico, con fecha del servidor y rastro de qué se sacó', async () => {
      const db = makeDb({
        activoAmortizable: {
          findFirst: vi.fn(async () => ({ id: 'aa-1', userId: USER, nombre: 'Lote marzo' })),
          update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'aa-1', ...data })),
        },
      });
      const r = await service(db).remove(USER, 'aa-1', ACTOR);

      expect(r.deletedAt).toBeInstanceOf(Date);
      const [entry] = recordTraceAudit.mock.calls[0] as unknown as [
        { action: string; before: { nombre: string } },
      ];
      expect(entry.action).toBe('delete');
      expect(entry.before.nombre).toBe('Lote marzo');
    });
  });
});
