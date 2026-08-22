import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LateDataService } from '@/application/cost-structures/late-data-service.js';

/**
 * Una factura de julio que llega el 5 de agosto, con julio ya cerrado.
 *
 * Lo que se prueba acá no es aritmética: es quién decide. El sistema no puede
 * mover plata de un mes a otro por su cuenta, y tampoco puede dejar el dato
 * entrando a los cálculos mientras nadie decidió nada.
 */

const USER = 'user-1';
const STRUCT = 'struct-1';
const DP = 'dp-1';
const actor = { id: USER, role: 'COSTISTA', area: 'costista' };

function makeDb(policy: string, over: Record<string, unknown> = {}) {
  return {
    costStructure: {
      findFirst: vi.fn(async () => ({ lateDataPolicy: policy, productName: 'Mermelada' })),
    },
    costPeriod: {
      findFirst: vi.fn(async ({ where }: { where: { status?: string; code?: string } }) => {
        if (where.status === 'OPEN') return { id: 'per-ago', code: '2026-08', label: 'Agosto 2026' };
        return { id: 'per-jul', code: '2026-07', label: 'Julio 2026', status: 'CLOSED' };
      }),
      update: vi.fn(async () => ({})),
    },
    lateDataDecision: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      findFirstOrThrow: vi.fn(async () => ({
        id: 'dec-1',
        dataPointId: DP,
        structureId: STRUCT,
        targetPeriodCode: '2026-07',
        openPeriodCode: '2026-08',
      })),
      create: vi.fn(async () => ({ id: 'dec-1' })),
      update: vi.fn(async () => ({ id: 'dec-1' })),
      findMany: vi.fn(async () => []),
    },
    dataPoint: { update: vi.fn(async () => ({})) },
    traceAuditLog: { create: vi.fn(async () => ({})) },
    ...over,
  };
}

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: {},
  withTenant: (_u: string, fn: (tx: unknown) => unknown) => fn(globalThis.__tx),
}));

const noPropagation = { repropagateForward: vi.fn(async () => []) };

beforeEach(() => vi.clearAllMocks());

/** withTenant recibe el mismo db falso: así se ven las escrituras. */
function svcWith(db: ReturnType<typeof makeDb>, propagation = noPropagation) {
  (globalThis as Record<string, unknown>).__tx = db;
  return new LateDataService(db as never, propagation as never);
}

describe('Detección', () => {
  it('un período cerrado se detecta como tal', async () => {
    const db = makeDb('ASK');
    expect(await svcWith(db).isClosed(STRUCT, '2026-07')).toBe(true);
  });
});

describe('Política ASK — el default', () => {
  it('deja el dato PENDIENTE y avisa que no entra en ningún cálculo', async () => {
    const db = makeDb('ASK');
    const out = await svcWith(db).handle(USER, DP, STRUCT, '2026-07', actor);

    expect(out.pendiente).toBe(true);
    expect(out.mensaje).toMatch(/no entra en ningún cálculo/i);
    // Lo importante: NO se imputó nada.
    expect(db.dataPoint.update).not.toHaveBeenCalled();
    expect(db.costPeriod.update).not.toHaveBeenCalled();
  });

  it('registra la política vigente al momento de detectarlo', async () => {
    const db = makeDb('ASK');
    await svcWith(db).handle(USER, DP, STRUCT, '2026-07', actor);

    expect(db.lateDataDecision.create.mock.calls[0]![0].data.policyAtDetection).toBe('ASK');
  });
});

describe('Política previa — la elección del costista ES la autorización', () => {
  it('CURRENT_PERIOD imputa al período abierto sin molestar a nadie', async () => {
    const db = makeDb('CURRENT_PERIOD');
    const out = await svcWith(db).handle(USER, DP, STRUCT, '2026-07', actor);

    expect(out.pendiente).toBe(false);
    expect(out.periodoImputado).toBe('2026-08');
    expect(db.dataPoint.update.mock.calls[0]![0].data.periodoImputado).toBe('2026-08');
    // Y el mes cerrado no se tocó.
    expect(db.costPeriod.update).not.toHaveBeenCalled();
  });

  it('REOPEN reabre el mes cerrado dejando motivo, y repropaga hacia adelante', async () => {
    const db = makeDb('REOPEN');
    const propagation = {
      repropagateForward: vi.fn(async () => [
        { periodCode: '2026-08', periodLabel: 'Agosto 2026', departamentos: 2 },
      ]),
    };
    const out = await svcWith(db, propagation).handle(USER, DP, STRUCT, '2026-07', actor);

    expect(out.pendiente).toBe(false);
    const reapertura = db.costPeriod.update.mock.calls[0]![0].data;
    expect(reapertura.status).toBe('OPEN');
    expect(reapertura.reopenReason).toMatch(/Dato atrasado/);
    expect(reapertura.reopenCount).toEqual({ increment: 1 });
    // La cadena de meses siguientes se actualiza: el inventario final de julio
    // es el inicial de agosto, y si julio cambia, agosto cambia.
    expect(propagation.repropagateForward).toHaveBeenCalledWith(USER, STRUCT, '2026-07');
  });

  it('distingue en el historial lo decidido de antemano de lo decidido en el momento', async () => {
    const db = makeDb('CURRENT_PERIOD');
    await svcWith(db).handle(USER, DP, STRUCT, '2026-07', actor);

    expect(db.lateDataDecision.update.mock.calls[0]![0].data.autoResolved).toBe(true);
  });
});

describe('Resolución manual', () => {
  it('el costista descarta: el dato queda anulado, no borrado', async () => {
    const db = makeDb('ASK', {
      lateDataDecision: {
        ...makeDb('ASK').lateDataDecision,
        findFirst: vi.fn(async () => ({ id: 'dec-1', resolvedAt: null })),
      },
    });
    const out = await svcWith(db).resolve(USER, 'dec-1', 'DISCARD', 'Duplicado del comprobante 4412.', actor);

    expect(out.choice).toBe('DISCARD');
    expect(db.dataPoint.update.mock.calls[0]![0].data.status).toBe('anulado');
    // R1 del repo: nunca DELETE. Se puede seguir consultando en trazabilidad.
    expect(db.dataPoint.update.mock.calls[0]![0].data).toHaveProperty('voidedAt');
    expect(db.lateDataDecision.update.mock.calls[0]![0].data.autoResolved).toBe(false);
  });

  it('no se puede resolver dos veces', async () => {
    const db = makeDb('ASK', {
      lateDataDecision: {
        ...makeDb('ASK').lateDataDecision,
        findFirst: vi.fn(async () => ({ id: 'dec-1', resolvedAt: new Date() })),
      },
    });

    await expect(
      svcWith(db).resolve(USER, 'dec-1', 'REOPEN', 'Motivo suficientemente largo.', actor),
    ).rejects.toThrow(/ya se resolvió/i);
  });

  it('no se puede resolver la decisión de otro costista', async () => {
    const db = makeDb('ASK', {
      lateDataDecision: { ...makeDb('ASK').lateDataDecision, findFirst: vi.fn(async () => null) },
    });

    await expect(
      svcWith(db).resolve(USER, 'dec-ajena', 'DISCARD', 'Motivo suficientemente largo.', actor),
    ).rejects.toThrow(/no encontrada/i);
  });
});

describe('Reprocesamiento del mismo documento', () => {
  it('no le duplica la pregunta al costista', async () => {
    const db = makeDb('ASK', {
      lateDataDecision: {
        ...makeDb('ASK').lateDataDecision,
        findUnique: vi.fn(async () => ({ id: 'dec-vieja', resolvedAt: null })),
      },
    });
    const out = await svcWith(db).handle(USER, DP, STRUCT, '2026-07', actor);

    expect(out.decisionId).toBe('dec-vieja');
    expect(out.pendiente).toBe(true);
    expect(db.lateDataDecision.create).not.toHaveBeenCalled();
  });
});
