import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DailyRunService } from '@/application/cost-structures/daily-run-service.js';
import {
  MissingInputError,
  ProcessValidationError,
} from '@/domain/errors/calculation-errors.js';

/**
 * El cálculo diario del período abierto. Tres reglas lo gobiernan y las tres
 * están acá: standby (no calcular al pedo), aislamiento (una estructura rota no
 * voltea el lote) y que la falta de datos no sea tratada como un error.
 */

const AYER = new Date('2026-07-30T03:00:00Z');

function period(over: Record<string, unknown> = {}) {
  return {
    id: 'per-1',
    label: 'Julio 2026',
    lastAutoRunAt: AYER,
    structure: {
      id: 'struct-1',
      userId: 'user-1',
      productName: 'Mermelada',
      costingSystem: 'ORDERS',
      deletedAt: null,
    },
    ...over,
  };
}

/** db falso con los cuatro contadores del standby en 0 salvo que se diga otra cosa. */
function makeDb(periods: unknown[], cambios = 0) {
  const count = vi.fn(async () => cambios);
  return {
    costPeriod: {
      findMany: vi.fn(async () => periods),
      update: vi.fn(async () => ({})),
    },
    dataEntry: { count },
    costConfigVersion: { count },
    unitMovementSchedule: { count },
    dataPointVersion: { count },
  };
}

const okRun = { run: { id: 'run-9', runN: 9 } };

beforeEach(() => vi.clearAllMocks());

describe('Standby — no calcular si no llegó nada', () => {
  it('no calcula cuando no hubo ningún dato nuevo', async () => {
    const db = makeDb([period()], 0);
    const orders = { calculate: vi.fn(async () => okRun) };
    const svc = new DailyRunService(db as never, orders as never, {} as never);

    const [out] = await svc.runAll();

    expect(out!.estado).toBe('sin-cambios');
    expect(orders.calculate).not.toHaveBeenCalled();
    // Y no mueve la marca: mañana compara contra el mismo punto.
    expect(db.costPeriod.update).not.toHaveBeenCalled();
  });

  it('calcula cuando sí llegó algo', async () => {
    const db = makeDb([period()], 1);
    const orders = { calculate: vi.fn(async () => okRun) };
    const svc = new DailyRunService(db as never, orders as never, {} as never);

    const [out] = await svc.runAll();

    expect(out!.estado).toBe('calculado');
    expect(out!.runId).toBe('run-9');
    expect(db.costPeriod.update).toHaveBeenCalled();
  });

  it('la PRIMERA corrida de un período nunca se saltea, aunque no haya cambios', async () => {
    const db = makeDb([period({ lastAutoRunAt: null })], 0);
    const orders = { calculate: vi.fn(async () => okRun) };
    const svc = new DailyRunService(db as never, orders as never, {} as never);

    const [out] = await svc.runAll();

    expect(out!.estado).toBe('calculado');
  });

  it('la corrida automática se marca como tal, no como cálculo del costista', async () => {
    const db = makeDb([period()], 1);
    const orders = { calculate: vi.fn(async () => okRun) };
    const svc = new DailyRunService(db as never, orders as never, {} as never);

    await svc.runAll();

    const [, , actor, trigger] = orders.calculate.mock.calls[0]!;
    expect(trigger).toBe('AUTO_DAILY');
    expect((actor as { area: string }).area).toBe('sistema');
  });
});

describe('Aislamiento — una estructura rota no voltea el lote', () => {
  it('sigue con las demás cuando una revienta', async () => {
    const db = makeDb([period(), period({ id: 'per-2', structure: { ...period().structure, id: 'struct-2' } })], 1);
    let llamadas = 0;
    const orders = {
      calculate: vi.fn(async () => {
        llamadas += 1;
        if (llamadas === 1) throw new Error('la base explotó');
        return okRun;
      }),
    };
    const svc = new DailyRunService(db as never, orders as never, {} as never);

    const outs = await svc.runAll();

    // Perder treinta cálculos porque uno falló sería mucho peor que el fallo.
    expect(outs.map((o) => o.estado)).toEqual(['error', 'calculado']);
  });

  it('el motivo del error no filtra detalles técnicos al costista', async () => {
    const db = makeDb([period()], 1);
    const orders = {
      calculate: vi.fn(async () => {
        throw new Error('ECONNREFUSED 10.0.0.4:5432 prisma.$queryRaw');
      }),
    };
    const svc = new DailyRunService(db as never, orders as never, {} as never);

    const [out] = await svc.runAll();

    expect(out!.motivo).not.toMatch(/ECONNREFUSED|prisma|5432/);
    expect(out!.motivo).toMatch(/error inesperado/i);
  });

  it('saltea las estructuras en la papelera sin contarlas como error', async () => {
    const db = makeDb([
      period({ structure: { ...period().structure, deletedAt: new Date() } }),
    ], 1);
    const orders = { calculate: vi.fn(async () => okRun) };
    const svc = new DailyRunService(db as never, orders as never, {} as never);

    const outs = await svc.runAll();

    expect(outs).toHaveLength(0);
    expect(orders.calculate).not.toHaveBeenCalled();
  });
});

describe('Faltan datos — es un estado normal, no un error', () => {
  it('registra el motivo del motor y sigue, sin tirar', async () => {
    const db = makeDb([period()], 1);
    const orders = {
      calculate: vi.fn(async () => {
        throw new MissingInputError(
          'produccion.unidades',
          'Falta cargar las unidades producidas del período.',
        );
      }),
    };
    const svc = new DailyRunService(db as never, orders as never, {} as never);

    const [out] = await svc.runAll();

    expect(out!.estado).toBe('faltan-datos');
    // El mensaje del motor ya viene en castellano y accionable: se pasa tal cual.
    expect(out!.motivo).toMatch(/unidades producidas/);
  });

  it('el cuadro de movimiento que todavía no cuadra tampoco es un error del sistema', async () => {
    const db = makeDb([period()], 1);
    const orders = {
      calculate: vi.fn(async () => {
        throw new ProcessValidationError(
          'Las unidades a justificar no coinciden con las justificadas: faltan 40.',
        );
      }),
    };
    const svc = new DailyRunService(db as never, orders as never, {} as never);

    const [out] = await svc.runAll();

    // Un período a medio cargar no puede llenar los logs de alarmas.
    expect(out!.estado).toBe('faltan-datos');
    expect(out!.motivo).toMatch(/no coinciden/);
  });

  it('con datos faltantes NO mueve la marca: mañana reintenta desde el mismo punto', async () => {
    const db = makeDb([period()], 1);
    const orders = {
      calculate: vi.fn(async () => {
        throw new MissingInputError('x', 'Falta algo.');
      }),
    };
    const svc = new DailyRunService(db as never, orders as never, {} as never);

    await svc.runAll();

    expect(db.costPeriod.update).not.toHaveBeenCalled();
  });
});

describe('Despacho por sistema de costeo', () => {
  it('una estructura de Procesos va al motor de Procesos, con su período', async () => {
    const db = makeDb([period({ structure: { ...period().structure, costingSystem: 'PROCESSES' } })], 1);
    const orders = { calculate: vi.fn(async () => okRun) };
    const processes = { calculate: vi.fn(async () => okRun) };
    const svc = new DailyRunService(db as never, orders as never, processes as never);

    await svc.runAll();

    expect(orders.calculate).not.toHaveBeenCalled();
    const [userId, structureId, periodId] = processes.calculate.mock.calls[0]!;
    expect(userId).toBe('user-1');
    expect(structureId).toBe('struct-1');
    expect(periodId).toBe('per-1');
  });
});
