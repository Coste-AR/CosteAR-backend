import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { ConceptoCosteoService } from '@/application/parametros/concepto-costeo-service.js';
import { NotFoundError, UnprocessableEntityError } from '@/domain/errors/domain-error.js';

const recordTraceAudit = vi.fn(async () => undefined);
vi.mock('@/application/audit/trace-audit.js', () => ({
  recordTraceAudit: (...args: unknown[]) => recordTraceAudit(...(args as [])),
}));

// Mismo patrón que `parametros-costeo-service.test.ts`: acá se prueba la
// lógica del servicio, no el aislamiento entre empresas — eso lo prueba la
// suite de integración con un rol de Postgres sin BYPASSRLS (DOM-07).
const withTenant = vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(dbActual));
vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: {},
  withTenant: (...args: unknown[]) => withTenant(...(args as [string, (tx: unknown) => unknown])),
}));

/**
 * M1-01 (plan de análisis marginal v2) — el servicio de `ConceptoCosteo`.
 *
 * El dominio (`resolverConceptoCosteo`, la cascada, `violaCausalidadDeVolumen`)
 * ya está probado en `tests/domain/concepto-costeo.test.ts`. Estos tests
 * cubren que el servicio lea/escriba la tabla, respete pertenencia y
 * trazabilidad, y que la validación 422 de R4/R8 esté realmente enchufada
 * (issue #98: "test que detecte validaciones construidas y nunca enchufadas").
 */

const USER = 'user-1';
const COMPANY = { id: 'comp-1', userId: USER };
const ACTOR = { id: USER, role: 'COSTISTA', area: 'costista', method: 'manual' };

let dbActual: Record<string, unknown>;

function makeDb(overrides: Record<string, unknown> = {}) {
  const db: Record<string, unknown> = {
    company: { findFirst: vi.fn(async () => COMPANY) },
    costStructure: { findFirst: vi.fn(async () => ({ id: 'est-1', companyId: 'comp-1' })) },
    costPeriod: { findFirst: vi.fn(async () => ({ id: 'per-1', companyId: 'comp-1' })) },
    conceptoCosteo: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'cc-1', ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'cc-1', ...data })),
    },
    ...overrides,
  };
  dbActual = db;
  return db;
}

function service(db: Record<string, unknown>) {
  return new ConceptoCosteoService(db as unknown as PrismaClient);
}

describe('M1-01 — ConceptoCosteoService.crear', () => {
  beforeEach(() => {
    recordTraceAudit.mockClear();
    withTenant.mockClear();
  });

  it('crea un concepto a nivel empresa y audita la creación', async () => {
    const db = makeDb();
    const r = await service(db).crear(
      USER,
      'comp-1',
      { clave: 'energia_planta', elemento: 'CIP', comportamientoVolumen: 'VARIABLE', causaVariabilidad: 'volumen', confirmado: true },
      ACTOR,
    );

    expect(r).toMatchObject({ clave: 'energia_planta', comportamientoVolumen: 'VARIABLE' });
    expect(recordTraceAudit).toHaveBeenCalledTimes(1);
    expect(recordTraceAudit.mock.calls[0][0]).toMatchObject({ entityType: 'ConceptoCosteo', action: 'create' });
  });

  it('rechaza con 422 un concepto VARIABLE con causa distinta de volumen (R4/R8)', async () => {
    const db = makeDb();
    await expect(
      service(db).crear(
        USER,
        'comp-1',
        { clave: 'amortizacion_plantel', elemento: 'CIP', comportamientoVolumen: 'VARIABLE', causaVariabilidad: 'tiempo', confirmado: true },
        ACTOR,
      ),
    ).rejects.toThrow(UnprocessableEntityError);
    // La validación tiene que cortar ANTES de escribir nada (issue #98).
    expect((db.conceptoCosteo as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
    expect(recordTraceAudit).not.toHaveBeenCalled();
  });

  it('permite VARIABLE con causa volumen', async () => {
    const db = makeDb();
    await expect(
      service(db).crear(
        USER,
        'comp-1',
        { clave: 'alimento', elemento: 'MP', comportamientoVolumen: 'VARIABLE', causaVariabilidad: 'volumen', confirmado: true },
        ACTOR,
      ),
    ).resolves.toMatchObject({ comportamientoVolumen: 'VARIABLE' });
  });

  it('permite VARIABLE sin causa declarada — la causa es opcional al cargar', async () => {
    const db = makeDb();
    await expect(
      service(db).crear(
        USER,
        'comp-1',
        { clave: 'alimento', elemento: 'MP', comportamientoVolumen: 'VARIABLE', confirmado: false },
        ACTOR,
      ),
    ).resolves.toMatchObject({ comportamientoVolumen: 'VARIABLE' });
  });

  it('rechaza crear dos conceptos con la misma clave en el mismo nivel', async () => {
    const db = makeDb({
      conceptoCosteo: {
        findFirst: vi.fn(async () => ({ id: 'cc-0', clave: 'energia_planta' })),
        create: vi.fn(),
      },
    });
    await expect(
      service(db).crear(USER, 'comp-1', { clave: 'energia_planta', elemento: 'CIP', confirmado: false }, ACTOR),
    ).rejects.toThrow(UnprocessableEntityError);
  });

  it('empresa ajena: 404', async () => {
    const db = makeDb({ company: { findFirst: vi.fn(async () => null) } });
    await expect(
      service(db).crear(USER, 'comp-ajena', { clave: 'x', elemento: 'CIP', confirmado: false }, ACTOR),
    ).rejects.toThrow(NotFoundError);
  });

  it('período ajeno: 404, sin llegar a escribir', async () => {
    const db = makeDb({ costPeriod: { findFirst: vi.fn(async () => null) } });
    await expect(
      service(db).crear(USER, 'comp-1', { clave: 'x', elemento: 'CIP', confirmado: false, periodId: 'per-ajeno' }, ACTOR),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('M1-01 — ConceptoCosteoService.actualizar', () => {
  beforeEach(() => {
    recordTraceAudit.mockClear();
    withTenant.mockClear();
  });

  it('actualiza la clasificación y audita con before/after', async () => {
    const existente = {
      id: 'cc-1', companyId: 'comp-1', clave: 'energia_planta', elemento: 'CIP',
      comportamientoVolumen: null, causaVariabilidad: null, confirmado: false,
    };
    const db = makeDb({
      conceptoCosteo: {
        findFirst: vi.fn(async () => existente),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...existente, ...data })),
      },
    });
    const r = await service(db).actualizar(USER, 'comp-1', 'cc-1', { comportamientoVolumen: 'VARIABLE', causaVariabilidad: 'volumen', confirmado: true }, ACTOR);

    expect(r.comportamientoVolumen).toBe('VARIABLE');
    expect(recordTraceAudit.mock.calls[0][0]).toMatchObject({ action: 'update', before: existente });
  });

  it('rechaza con 422 si la actualización deja VARIABLE con causa distinta de volumen', async () => {
    const existente = {
      id: 'cc-1', companyId: 'comp-1', clave: 'amortizacion_plantel', elemento: 'CIP',
      comportamientoVolumen: 'FIJO', causaVariabilidad: 'tiempo', confirmado: true,
    };
    const db = makeDb({ conceptoCosteo: { findFirst: vi.fn(async () => existente), update: vi.fn() } });
    // Solo cambia comportamientoVolumen a VARIABLE; la causa "tiempo" ya
    // cargada antes queda — y la combinación resultante sigue siendo ilegal.
    await expect(
      service(db).actualizar(USER, 'comp-1', 'cc-1', { comportamientoVolumen: 'VARIABLE', confirmado: true }, ACTOR),
    ).rejects.toThrow(UnprocessableEntityError);
    expect((db.conceptoCosteo as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
  });

  it('concepto inexistente: 404', async () => {
    const db = makeDb({ conceptoCosteo: { findFirst: vi.fn(async () => null) } });
    await expect(
      service(db).actualizar(USER, 'comp-1', 'cc-x', { confirmado: true }, ACTOR),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('M1-01 — ConceptoCosteoService.eliminar', () => {
  it('borra lógicamente y audita', async () => {
    const existente = { id: 'cc-1', companyId: 'comp-1', clave: 'energia_planta' };
    const db = makeDb({
      conceptoCosteo: {
        findFirst: vi.fn(async () => existente),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...existente, ...data })),
      },
    });
    await service(db).eliminar(USER, 'comp-1', 'cc-1', ACTOR);
    expect((db.conceptoCosteo as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
    expect(recordTraceAudit.mock.calls[0][0]).toMatchObject({ action: 'delete' });
  });
});

describe('M1-01 — ConceptoCosteoService.listar', () => {
  it('sin conceptos cargados, devuelve vacío — no hay catálogo de defaults', async () => {
    const db = makeDb();
    await expect(service(db).listar(USER, 'comp-1')).resolves.toEqual([]);
  });

  it('devuelve un concepto resuelto por clave, filtrado por elemento si se pide', async () => {
    const db = makeDb({
      conceptoCosteo: {
        findMany: vi.fn(async ({ where }: { where: { elemento?: string } }) => [
          { id: 'a', clave: 'energia_planta', descripcion: null, elemento: 'CIP', comportamientoVolumen: 'VARIABLE', causaVariabilidad: 'volumen', erogable: null, horizonteErogableMeses: null, evitable: null, nivelSegmentacion: null, segmentoId: null, rangoActividadDesde: null, rangoActividadHasta: null, periodId: null, structureId: null, confirmado: true, clasificadoPorUserId: USER, clasificadoEn: new Date() },
        ].filter((f) => !where.elemento || f.elemento === where.elemento)),
      },
    });
    const r = await service(db).listar(USER, 'comp-1', { elemento: 'CIP' });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ clave: 'energia_planta', origen: 'empresa' });
  });
});
