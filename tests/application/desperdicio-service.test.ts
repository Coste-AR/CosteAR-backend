import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { DesperdicioService } from '@/application/cost-structures/desperdicio-service.js';
import { NotFoundError, UnprocessableEntityError } from '@/domain/errors/domain-error.js';

const recordTraceAudit = vi.fn(async () => undefined);
vi.mock('@/application/audit/trace-audit.js', () => ({
  recordTraceAudit: (...args: unknown[]) => recordTraceAudit(...(args as [])),
}));

// `withTenant` abre la transacción y setea el tenant para RLS. En el test se
// reemplaza por una función que pasa el mismo mock como `tx`: lo que se verifica
// acá es la lógica del servicio, no el aislamiento — eso se prueba de verdad en
// la suite de integración, con un rol de Postgres sin BYPASSRLS (DOM-07).
const withTenant = vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(dbActual));
vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: {},
  withTenant: (...args: unknown[]) => withTenant(...(args as [string, (tx: unknown) => unknown])),
}));

/**
 * #92 — El CRUD de desperdicio, la mitad que le faltaba a la regla R5.
 *
 * El motor ya sabía imputar el desperdicio, pero la tabla no se leía ni se
 * escribía desde ningún lado: recibía siempre una lista vacía. Estos tests fijan
 * las reglas de la entrada de datos.
 */

const USER = 'user-1';
const PERIODO_ABIERTO = {
  id: 'per-1',
  userId: USER,
  companyId: 'comp-1',
  label: 'Julio 2026',
  status: 'OPEN',
};

let dbActual: Record<string, unknown>;

function makeDb(overrides: Record<string, unknown> = {}) {
  const db: Record<string, unknown> = {
    costPeriod: {
      findFirst: vi.fn(async () => PERIODO_ABIERTO),
    },
    desperdicioRegistro: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'des-1', ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'des-1', ...data })),
    },
    ...overrides,
  };
  dbActual = db;
  return db;
}

function service(db: Record<string, unknown>) {
  return new DesperdicioService(db as unknown as PrismaClient);
}

const ACTOR = { id: USER, role: 'COSTISTA', area: 'costista', method: 'manual' };

describe('#92 — carga de desperdicios del período', () => {
  beforeEach(() => {
    recordTraceAudit.mockClear();
    withTenant.mockClear();
  });

  it('guarda el registro con la naturaleza traducida a como la guarda la base', () => {
    // El dominio habla en minúsculas y la base en MAYÚSCULAS. Si la traducción
    // falla, el registro queda como "sin declarar" y **desaparece del cálculo en
    // silencio**, que es justo lo que R5 viene a evitar.
    const db = makeDb();
    return service(db)
      .create(USER, 'per-1', { concepto: 'Mortandad', valor: 20000, valorRecupero: 0, naturaleza: 'extraordinaria' }, ACTOR)
      .then((r) => {
        expect(r.naturaleza).toBe('EXTRAORDINARIA');
        expect(r.companyId).toBe('comp-1');
        expect(r.periodId).toBe('per-1');
      });
  });

  it('🚨 se puede cargar SIN declarar la naturaleza, y así queda', () => {
    // Es la regla dura del módulo: no es lo mismo no saber que suponer. El
    // registro se guarda, no entra al cálculo y aparece como pendiente.
    const db = makeDb();
    return service(db)
      .create(USER, 'per-1', { concepto: 'Huevo roto', valor: 8000, valorRecupero: 0 }, ACTOR)
      .then((r) => {
        expect(r.naturaleza).toBeNull();
      });
  });

  it('DOM-02: la bitácora se escribe en la MISMA transacción que la mutación', () => {
    const db = makeDb();
    return service(db)
      .create(USER, 'per-1', { concepto: 'Merma', valor: 1000, valorRecupero: 0 }, ACTOR)
      .then(() => {
        expect(withTenant).toHaveBeenCalledTimes(1);
        expect(recordTraceAudit).toHaveBeenCalledTimes(1);
        const [entry, tx] = recordTraceAudit.mock.calls[0] as unknown as [
          { entityType: string; action: string },
          unknown,
        ];
        expect(entry.entityType).toBe('DesperdicioRegistro');
        expect(entry.action).toBe('create');
        // El cliente que recibe la auditoría es el de la transacción, no el global.
        expect(tx).toBe(dbActual);
      });
  });

  it('un período CERRADO no acepta cargas nuevas', async () => {
    const db = makeDb({
      costPeriod: { findFirst: vi.fn(async () => ({ ...PERIODO_ABIERTO, status: 'CLOSED' })) },
    });
    await expect(
      service(db).create(USER, 'per-1', { concepto: 'Tarde', valor: 100, valorRecupero: 0 }, ACTOR),
    ).rejects.toThrow(UnprocessableEntityError);
    // Y el mensaje dice qué hacer, no solo que no se puede (DOM-04).
    await expect(
      service(db).create(USER, 'per-1', { concepto: 'Tarde', valor: 100, valorRecupero: 0 }, ACTOR),
    ).rejects.toThrow(/reabrirlo/);
  });

  it('un período de otro usuario no existe para éste', async () => {
    const db = makeDb({ costPeriod: { findFirst: vi.fn(async () => null) } });
    await expect(
      service(db).create(USER, 'per-ajeno', { concepto: 'X', valor: 1, valorRecupero: 0 }, ACTOR),
    ).rejects.toThrow(NotFoundError);
  });

  it('el recupero no puede superar lo perdido, mirando lo que VA A QUEDAR', async () => {
    // El usuario manda solo el recupero: hay que compararlo contra el valor ya
    // guardado, no contra un body que no lo trae.
    const db = makeDb({
      desperdicioRegistro: {
        ...(makeDb().desperdicioRegistro as object),
        findFirst: vi.fn(async () => ({
          id: 'des-1',
          userId: USER,
          periodId: 'per-1',
          concepto: 'Recortes',
          valor: 10000,
          valorRecupero: 0,
          naturaleza: 'NORMAL',
        })),
      },
    });
    await expect(
      service(db).update(USER, 'des-1', { valorRecupero: 15000 }, ACTOR),
    ).rejects.toThrow(/no se puede recuperar más de lo que se perdió/);
  });

  it('declarar la naturaleza queda escrito en la bitácora, sin abrir el diff', async () => {
    const db = makeDb({
      desperdicioRegistro: {
        ...(makeDb().desperdicioRegistro as object),
        findFirst: vi.fn(async () => ({
          id: 'des-1',
          userId: USER,
          periodId: 'per-1',
          concepto: 'Mortandad',
          valor: 20000,
          valorRecupero: 0,
          naturaleza: null,
        })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'des-1', concepto: 'Mortandad', ...data })),
      },
    });
    await service(db).update(USER, 'des-1', { naturaleza: 'extraordinaria' }, ACTOR);

    const [entry] = recordTraceAudit.mock.calls[0] as unknown as [{ comment: string }];
    expect(entry.comment).toContain('Naturaleza declarada');
    expect(entry.comment).toContain('extraordinaria');
  });

  it('DOM-01: borrar es lógico, con fecha del servidor y rastro de qué se sacó', async () => {
    const db = makeDb({
      desperdicioRegistro: {
        ...(makeDb().desperdicioRegistro as object),
        findFirst: vi.fn(async () => ({
          id: 'des-1',
          userId: USER,
          periodId: 'per-1',
          concepto: 'Mortandad',
          valor: 20000,
          valorRecupero: 0,
          naturaleza: 'EXTRAORDINARIA',
        })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'des-1', ...data })),
      },
    });
    const r = await service(db).remove(USER, 'des-1', ACTOR);

    expect(r.deletedAt).toBeInstanceOf(Date);
    const [entry] = recordTraceAudit.mock.calls[0] as unknown as [
      { action: string; before: { concepto: string } },
    ];
    expect(entry.action).toBe('delete');
    // El `before` conserva qué se sacó: sin eso, el costo del mes cambia y no
    // queda registro de por qué.
    expect(entry.before.concepto).toBe('Mortandad');
  });

  it('`paraElMotor` entrega la forma que consume R5, ya traducida', async () => {
    const db = makeDb({
      desperdicioRegistro: {
        ...(makeDb().desperdicioRegistro as object),
        findMany: vi.fn(async () => [
          { concepto: 'Merma', valor: 15000, naturaleza: 'NORMAL', valorRecupero: 5000 },
          { concepto: 'Rotura', valor: 20000, naturaleza: 'EXTRAORDINARIA', valorRecupero: 0 },
          { concepto: 'Faltante', valor: 8000, naturaleza: null, valorRecupero: 0 },
        ]),
      },
    });
    const registros = await service(db).paraElMotor(USER, 'per-1');

    expect(registros).toEqual([
      { concepto: 'Merma', valor: 15000, naturaleza: 'normal', valorRecupero: 5000 },
      { concepto: 'Rotura', valor: 20000, naturaleza: 'extraordinaria', valorRecupero: 0 },
      { concepto: 'Faltante', valor: 8000, naturaleza: null, valorRecupero: 0 },
    ]);
  });

  it('la lista solo trae los vigentes: un registro dado de baja no vuelve', async () => {
    const db = makeDb();
    await service(db).list(USER, 'per-1');
    const findMany = (db.desperdicioRegistro as { findMany: ReturnType<typeof vi.fn> }).findMany;
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: { periodId: 'per-1', deletedAt: null },
    });
  });
});
