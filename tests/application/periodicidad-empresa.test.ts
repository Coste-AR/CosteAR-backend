import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CostStructureService } from '@/application/cost-structures/cost-structure-service.js';
import { CompanyService } from '@/application/companies/company-service.js';
import { ConflictError } from '@/domain/errors/domain-error.js';

vi.mock('@/application/audit/audit-logger.js', () => ({
  recordAudit: vi.fn(async () => undefined),
}));

/**
 * EL RITMO DE COSTEO DE LA EMPRESA (mensual / quincenal / trimestral).
 *
 * El calendario de períodos sabía manejar los tres ritmos desde la Fase 1, y la
 * columna `Company.periodicity` existía en la base — pero no había forma de elegirlo
 * y nadie lo usaba al dar de alta una estructura: el costista tenía que TIPEAR un
 * código mensual ("2026-06") aunque su empresa cerrara por quincena. O sea: el
 * formulario lo obligaba a mentir, y el período de arranque quedaba mal.
 *
 * Ahora el período de arranque NO se tipea: se deriva de la fecha de hoy leída con
 * el ritmo de la empresa.
 */

const USER = 'user-1';
const COMPANY = 'comp-1';
const ctx = { ip: '127.0.0.1', userAgent: 'test' } as never;

/** DB mínima: una empresa con un ritmo, y una estructura que se crea. */
function makeDb(periodicity: string, periodCount = 0) {
  const db: Record<string, unknown> = {
    company: {
      findFirst: vi.fn(async () => ({ id: COMPANY, userId: USER, periodicity, isActive: true })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: COMPANY, ...data })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: COMPANY, ...data })),
    },
    costStructure: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'struct-1', ...data })),
    },
    costPeriod: {
      count: vi.fn(async () => periodCount),
    },
  };
  db.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return db as {
    company: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    costStructure: { create: ReturnType<typeof vi.fn> };
    costPeriod: { count: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

/** El período con el que quedó guardada la estructura recién creada. */
function periodoGuardado(db: ReturnType<typeof makeDb>): string {
  const call = db.costStructure.create.mock.calls[0]![0] as { data: { period: string } };
  return call.data.period;
}

describe('El período de arranque sale del ritmo de la empresa, no del teclado', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('empresa MENSUAL → arranca en el mes corriente', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00Z'));

    const db = makeDb('MONTHLY');
    await new CostStructureService(db as never).create(
      USER, COMPANY, { productName: 'Mesa', costingSystem: 'ORDERS' }, ctx,
    );

    expect(periodoGuardado(db)).toBe('2026-07');
  });

  it('🔑 empresa QUINCENAL, alta el día 20 → arranca en la SEGUNDA quincena, no en la primera', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00Z'));

    const db = makeDb('BIWEEKLY');
    await new CostStructureService(db as never).create(
      USER, COMPANY, { productName: 'Mesa', costingSystem: 'ORDERS' }, ctx,
    );

    // Esto es lo que el campo tipeado no podía expresar: "2026-07" a secas habría
    // metido la estructura en la quincena equivocada.
    expect(periodoGuardado(db)).toBe('2026-07-Q2');
  });

  it('empresa QUINCENAL, alta el día 5 → primera quincena', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-05T12:00:00Z'));

    const db = makeDb('BIWEEKLY');
    await new CostStructureService(db as never).create(
      USER, COMPANY, { productName: 'Mesa', costingSystem: 'ORDERS' }, ctx,
    );

    expect(periodoGuardado(db)).toBe('2026-07-Q1');
  });

  it('empresa TRIMESTRAL → arranca en el trimestre corriente', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00Z'));

    const db = makeDb('QUARTERLY');
    await new CostStructureService(db as never).create(
      USER, COMPANY, { productName: 'Mesa', costingSystem: 'ORDERS' }, ctx,
    );

    expect(periodoGuardado(db)).toBe('2026-T3'); // julio cae en el 3er trimestre
  });

  it('si el período viene explícito, se respeta (compatibilidad: importaciones, datos viejos)', async () => {
    const db = makeDb('MONTHLY');
    await new CostStructureService(db as never).create(
      USER, COMPANY, { productName: 'Mesa', period: '2026-03', costingSystem: 'ORDERS' }, ctx,
    );

    expect(periodoGuardado(db)).toBe('2026-03');
  });
});

describe('El ritmo no se cambia con la empresa en marcha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deja elegirlo mientras no haya ningún período', async () => {
    const db = makeDb('MONTHLY', 0);
    await new CompanyService(db as never).update(USER, COMPANY, { periodicity: 'BIWEEKLY' }, ctx);

    const call = db.company.update.mock.calls[0]![0] as { data: { periodicity: string } };
    expect(call.data.periodicity).toBe('BIWEEKLY');
  });

  it('🔒 lo bloquea si ya hay períodos: quedarían dos ritmos conviviendo', async () => {
    const db = makeDb('MONTHLY', 3);
    const svc = new CompanyService(db as never);

    await expect(
      svc.update(USER, COMPANY, { periodicity: 'QUARTERLY' }, ctx),
    ).rejects.toThrow(ConflictError);

    expect(db.company.update).not.toHaveBeenCalled();
  });

  it('guardar la empresa sin tocar el ritmo no molesta a nadie', async () => {
    const db = makeDb('MONTHLY', 3);
    await new CompanyService(db as never).update(USER, COMPANY, { name: 'Otro nombre' }, ctx);

    const call = db.company.update.mock.calls[0]![0] as { data: { periodicity: string } };
    expect(call.data.periodicity).toBe('MONTHLY'); // conserva el suyo
  });
});
