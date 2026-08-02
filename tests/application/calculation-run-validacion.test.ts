import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistCalculationRun } from '@/application/cost-structures/calculation-run-persistence.js';

vi.mock('@/application/audit/trace-audit.js', () => ({
  recordTraceAudit: vi.fn(async () => undefined),
}));

/**
 * La línea que separa "un número que alguien firmó" de "un número que el sistema
 * calculó solo". Todo lo que se muestra en pantalla se apoya en este booleano,
 * así que no lo elige quien llama: se DERIVA del disparador, en un solo lugar.
 *
 * Si un motor pudiera pasar `validated: true` a mano, alcanzaría con un
 * descuido para que una corrida automática aparezca como aprobada por una
 * persona que nunca la miró.
 */

interface RunData {
  trigger: string;
  validated: boolean;
  validatedAt: Date | null;
  validatedBy: string | null;
  periodId: string | null;
}

function makeTx() {
  const creado: { data?: RunData } = {};
  return {
    creado,
    $queryRaw: vi.fn(async () => []),
    calculationRun: {
      findFirst: vi.fn(async () => ({ runN: 7 })),
      create: vi.fn(async ({ data }: { data: RunData }) => {
        creado.data = data;
        return { id: 'run-1', runN: 8 };
      }),
    },
    calculationNode: { create: vi.fn(async () => ({ id: 'node-1' })) },
  };
}

const base = {
  structureId: 'struct-1',
  engineVersion: 'v1',
  executedBy: 'user-1',
  inputsSnapshot: {},
  results: {},
  tree: [],
  audit: { actor: { id: 'user-1' }, after: {} },
};

beforeEach(() => vi.clearAllMocks());

describe('Validación derivada del disparador', () => {
  it('el botón "calcular" del costista nace validado', async () => {
    const tx = makeTx();
    await persistCalculationRun(tx as never, { ...base, trigger: 'MANUAL' } as never);

    expect(tx.creado.data?.validated).toBe(true);
    expect(tx.creado.data?.validatedBy).toBe('user-1');
    expect(tx.creado.data?.validatedAt).toBeInstanceOf(Date);
  });

  it('sin disparador explícito se asume MANUAL (es como se calculaba hasta hoy)', async () => {
    const tx = makeTx();
    await persistCalculationRun(tx as never, base as never);

    expect(tx.creado.data?.trigger).toBe('MANUAL');
    expect(tx.creado.data?.validated).toBe(true);
  });

  it('el cierre del período también nace validado: hay alguien apretándolo', async () => {
    const tx = makeTx();
    await persistCalculationRun(tx as never, { ...base, trigger: 'CLOSE' } as never);

    expect(tx.creado.data?.validated).toBe(true);
  });

  it('la corrida automática NO nace validada, y no le atribuye la validación a nadie', async () => {
    const tx = makeTx();
    await persistCalculationRun(tx as never, { ...base, trigger: 'AUTO_DAILY' } as never);

    expect(tx.creado.data?.validated).toBe(false);
    expect(tx.creado.data?.validatedAt).toBeNull();
    // `executedBy` es el dueño de la estructura porque la FK lo exige, pero eso
    // no puede convertirse en "este usuario la validó".
    expect(tx.creado.data?.validatedBy).toBeNull();
  });

  it('quien llama NO puede forzar la validación de una corrida automática', async () => {
    const tx = makeTx();
    await persistCalculationRun(
      tx as never,
      { ...base, trigger: 'AUTO_DAILY', validated: true } as never,
    );

    expect(tx.creado.data?.validated).toBe(false);
  });
});

describe('Período de la corrida', () => {
  it('guarda el período al que pertenece', async () => {
    const tx = makeTx();
    await persistCalculationRun(tx as never, { ...base, periodId: 'per-1' } as never);

    expect(tx.creado.data?.periodId).toBe('per-1');
  });

  it('sin período abierto queda en null, no explota', async () => {
    const tx = makeTx();
    await persistCalculationRun(tx as never, base as never);

    expect(tx.creado.data?.periodId).toBeNull();
  });
});
