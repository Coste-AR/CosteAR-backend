import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  costStructure: { findFirst: vi.fn() },
  calculationRun: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  traceAuditLog: { create: vi.fn() },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockDb,
  withTenant: (_userId: string, fn: (tx: typeof mockDb) => unknown) => fn(mockDb),
}));

const USER = 'user-1';
const STRUCT = 'struct-1';
const actor = { id: USER, role: 'COSTISTA', area: 'costista' };

function run(over: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    runN: 8,
    structureId: STRUCT,
    engineVersion: 'v1',
    executedAt: new Date('2026-07-20T10:00:00Z'),
    trigger: 'MANUAL',
    validated: true,
    validatedAt: new Date('2026-07-20T10:00:00Z'),
    results: { grossMargin: 100, grossMarginPct: 25 },
    executedByUser: { name: 'Santiago' },
    period: { code: '2026-07', label: 'Julio 2026' },
    ...over,
  };
}

async function service() {
  const { CalculationRunService } = await import(
    '@/application/cost-structures/calculation-run-service.js'
  );
  return new CalculationRunService();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.costStructure.findFirst.mockResolvedValue({ id: STRUCT, userId: USER });
});

describe('Resultado vigente', () => {
  it('devuelve la última corrida VALIDADA, no la última a secas', async () => {
    mockDb.calculationRun.findFirst.mockResolvedValueOnce(run({ runN: 5 }));
    const svc = await service();

    const res = await svc.currentResult(USER, STRUCT);

    expect(res.provisorio).toBe(false);
    expect(res.run?.runN).toBe(5);
    // La consulta pidió explícitamente validadas.
    expect(mockDb.calculationRun.findFirst.mock.calls[0]![0].where.validated).toBe(true);
  });

  it('sin ninguna validada devuelve la automática MARCADA como provisoria', async () => {
    mockDb.calculationRun.findFirst
      .mockResolvedValueOnce(null) // no hay validadas
      .mockResolvedValueOnce(run({ trigger: 'AUTO_DAILY', validated: false, validatedAt: null }));
    const svc = await service();

    const res = await svc.currentResult(USER, STRUCT);

    // No devolver nada escondería que el sistema viene calculando. "No hay
    // datos" y "hay datos que nadie miró" son dos cosas muy distintas para
    // quien decide precios.
    expect(res.provisorio).toBe(true);
    expect(res.run).not.toBeNull();
    expect(res.motivo).toMatch(/todavía no lo revisó nadie/);
  });

  it('una corrida automática NO lleva el nombre del dueño de la estructura', async () => {
    mockDb.calculationRun.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(run({ trigger: 'AUTO_DAILY', validated: false, validatedAt: null }));
    const svc = await service();

    const res = await svc.currentResult(USER, STRUCT);

    // `executedBy` es el dueño porque la FK lo exige; mostrarlo sería decir que
    // él la calculó.
    expect(res.run?.executedBy).toBe('Cálculo automático del sistema');
    expect(res.run?.executedBy).not.toContain('Santiago');
  });

  it('sin ninguna corrida no explota', async () => {
    mockDb.calculationRun.findFirst.mockResolvedValue(null);
    const svc = await service();

    const res = await svc.currentResult(USER, STRUCT);

    expect(res.run).toBeNull();
    expect(res.provisorio).toBe(false);
  });
});

describe('Historial de corridas', () => {
  it('por defecto trae TODO, incluidas las no validadas', async () => {
    mockDb.calculationRun.findMany.mockResolvedValue([]);
    const svc = await service();

    await svc.listRuns(USER, STRUCT);

    expect(mockDb.calculationRun.findMany.mock.calls[0]![0].where.validated).toBeUndefined();
  });

  it('con soloValidadas filtra', async () => {
    mockDb.calculationRun.findMany.mockResolvedValue([]);
    const svc = await service();

    await svc.listRuns(USER, STRUCT, true);

    expect(mockDb.calculationRun.findMany.mock.calls[0]![0].where.validated).toBe(true);
  });
});

describe('Validar una corrida', () => {
  it('marca validada, con autor y fecha, y lo asienta en la bitácora', async () => {
    mockDb.calculationRun.findFirst.mockResolvedValue(
      run({ trigger: 'AUTO_DAILY', validated: false }),
    );
    mockDb.calculationRun.update.mockResolvedValue({ id: 'run-1', runN: 8 });
    const svc = await service();

    const res = await svc.validateRun(USER, 'run-1', actor);

    expect(res.validated).toBe(true);
    expect(res.yaEstaba).toBe(false);
    const data = mockDb.calculationRun.update.mock.calls[0]![0].data;
    expect(data.validated).toBe(true);
    expect(data.validatedBy).toBe(USER);
    expect(data.validatedAt).toBeInstanceOf(Date);
    expect(mockDb.traceAuditLog.create).toHaveBeenCalled();
  });

  it('validar dos veces no pisa quién validó primero', async () => {
    mockDb.calculationRun.findFirst.mockResolvedValue(run({ validated: true }));
    const svc = await service();

    const res = await svc.validateRun(USER, 'run-1', actor);

    // Apretar dos veces no es un error del usuario, pero tampoco puede
    // reescribir el autor original de la validación.
    expect(res.yaEstaba).toBe(true);
    expect(mockDb.calculationRun.update).not.toHaveBeenCalled();
  });

  it('no se puede validar una corrida de otro costista', async () => {
    mockDb.calculationRun.findFirst.mockResolvedValue(null);
    const svc = await service();

    await expect(svc.validateRun(USER, 'run-ajena', actor)).rejects.toThrow(
      /no encontrada/i,
    );
  });
});
