import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { CostPeriodService } from '@/application/cost-structures/cost-period-service.js';
import { ValidationError } from '@/domain/errors/domain-error.js';

const recordAudit = vi.fn(async () => undefined);
vi.mock('@/application/audit/audit-logger.js', () => ({
  recordAudit: (...args: unknown[]) => recordAudit(...(args as [])),
}));

const USER = 'user-1';
const PERIOD_ID = 'periodo-1';
const CTX = { area: 'costista', method: 'manual' } as const;

function makeDb(period: Record<string, unknown> = {}) {
  const base = {
    id: PERIOD_ID, userId: USER, label: 'Septiembre 2026', status: 'OPEN',
    gastoVariableComercializacionPorUnidad: 0, gastoFijoAdministracion: 0,
    ...period,
  };
  const tx = {
    costPeriod: {
      findFirst: vi.fn(async () => base),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...base, ...data })),
    },
  };
  return {
    ...tx,
    $transaction: vi.fn(async (fn: (tx: typeof tx) => unknown) => fn(tx)),
  };
}

function service(db: ReturnType<typeof makeDb>) {
  return new CostPeriodService(db as unknown as PrismaClient);
}

describe('CostPeriodService.setGastosDeNoFabricacion (M2-01)', () => {
  beforeEach(() => recordAudit.mockClear());

  it('persiste los dos importes en la MISMA transacción que la bitácora (DOM-02)', async () => {
    const db = makeDb();
    const result = await service(db).setGastosDeNoFabricacion(
      USER, PERIOD_ID,
      { gastoVariableComercializacionPorUnidad: 30, gastoFijoAdministracion: 56000 },
      CTX,
    );

    expect(result).toMatchObject({ gastoVariableComercializacionPorUnidad: 30, gastoFijoAdministracion: 56000 });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [entry] = recordAudit.mock.calls[0]!;
    expect(entry).toMatchObject({
      action: 'cost_period.gastos_no_fabricacion.update',
      entityType: 'CostPeriod',
      entityId: PERIOD_ID,
      oldValue: { gastoVariableComercializacionPorUnidad: 0, gastoFijoAdministracion: 0 },
      newValue: { gastoVariableComercializacionPorUnidad: 30, gastoFijoAdministracion: 56000 },
    });
  });

  it('un período cerrado no se edita', async () => {
    const db = makeDb({ status: 'CLOSED' });
    await expect(
      service(db).setGastosDeNoFabricacion(
        USER, PERIOD_ID,
        { gastoVariableComercializacionPorUnidad: 30, gastoFijoAdministracion: 56000 },
        CTX,
      ),
    ).rejects.toThrow(ValidationError);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
