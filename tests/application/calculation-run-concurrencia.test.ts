import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistCalculationRun } from '@/application/cost-structures/calculation-run-persistence.js';

vi.mock('@/application/audit/trace-audit.js', () => ({
  recordTraceAudit: vi.fn(async () => undefined),
}));

/**
 * `runN` se asigna leyendo el máximo actual y escribiendo el siguiente. Sin un
 * lock, dos corridas simultáneas sobre la misma estructura leen las dos `N`,
 * escriben las dos `N + 1`, y la segunda choca contra
 * `@@unique([structureId, runN])`. Eso no degrada: revienta la transacción
 * entera, y con ella la auditoría, que va en la misma tx.
 *
 * Hoy no se manifiesta porque solo calcula el costista, de a uno. Se manifiesta
 * en cuanto exista el cálculo diario automático en paralelo con el botón.
 */

/** tx falso que registra el ORDEN de las llamadas. */
function makeTx(ultimoRunN: number | null) {
  const orden: string[] = [];
  return {
    orden,
    $queryRaw: vi.fn(async () => { orden.push('LOCK'); return []; }),
    calculationRun: {
      findFirst: vi.fn(async () => {
        orden.push('READ_MAX');
        return ultimoRunN === null ? null : { runN: ultimoRunN };
      }),
      create: vi.fn(async ({ data }: { data: { runN: number } }) => {
        orden.push(`CREATE_${data.runN}`);
        return { id: 'run-1', runN: data.runN };
      }),
    },
    calculationNode: { create: vi.fn(async () => ({ id: 'node-1' })) },
  };
}

const params = {
  structureId: 'struct-1',
  engineVersion: 'v1',
  executedBy: 'user-1',
  inputsSnapshot: {},
  results: {},
  tree: [],
  audit: { actor: { id: 'user-1' }, after: {} },
};

beforeEach(() => vi.clearAllMocks());

describe('persistCalculationRun — asignación de runN', () => {
  it('toma el lock de la estructura ANTES de leer el máximo', async () => {
    const tx = makeTx(41);

    await persistCalculationRun(tx as never, params as never);

    // Si el lock va después de la lectura, la carrera ya está perdida.
    expect(tx.orden[0]).toBe('LOCK');
    expect(tx.orden[1]).toBe('READ_MAX');
  });

  it('bloquea la fila de ESA estructura, no una tabla entera', async () => {
    const tx = makeTx(41);

    await persistCalculationRun(tx as never, params as never);

    const sql = tx.$queryRaw.mock.calls[0]![0] as unknown as string[];
    const texto = Array.isArray(sql) ? sql.join('?') : String(sql);

    expect(texto).toMatch(/FOR UPDATE/i);
    expect(texto).toMatch(/cost_structures/i);
    expect(texto).toMatch(/WHERE\s+id\s*=/i);
    // Dos empresas distintas tienen que poder calcular a la vez.
    expect(texto).not.toMatch(/LOCK\s+TABLE/i);
  });

  it('el correlativo sigue al último de la estructura', async () => {
    const tx = makeTx(41);
    const { runN } = await persistCalculationRun(tx as never, params as never);
    expect(runN).toBe(42);
  });

  it('la primera corrida de una estructura arranca en 1', async () => {
    const tx = makeTx(null);
    const { runN } = await persistCalculationRun(tx as never, params as never);
    expect(runN).toBe(1);
  });

  it('el lock se pide con el id de la estructura que se está calculando', async () => {
    const tx = makeTx(1);
    await persistCalculationRun(tx as never, { ...params, structureId: 'otra-estructura' } as never);

    const valores = tx.$queryRaw.mock.calls[0]!.slice(1);
    expect(valores).toContain('otra-estructura');
  });
});
