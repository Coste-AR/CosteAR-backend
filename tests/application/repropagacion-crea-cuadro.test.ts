import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * LA REPROPAGACIÓN INFORMABA MESES QUE NO TOCABA.
 *
 * Al reabrir un período, `repropagateForward` reescribe la existencia inicial de
 * los meses siguientes. Lo hacía con `updateMany`, que si no encuentra la fila
 * no escribe nada **y no falla**: el método informaba haber repropagado un mes
 * en el que no había escrito una sola fila, y esa mentira quedaba asentada en la
 * bitácora — justo en la traza que el costista consulta cuando pregunta por qué
 * cambió un número.
 *
 * Lo encontró una simulación end-to-end contra un Postgres real, no la suite:
 * los mocks devolvían lo que se les pedía, así que el no-op era invisible.
 */

const DEPT = 'dept-1';
const PER_SIGUIENTE = 'per-2';

function makeDb() {
  return {
    costStructure: {
      findFirst: vi.fn(async () => ({
        id: 'st-1',
        userId: 'user-1',
        costingSystem: 'PROCESSES',
        company: { periodicity: 'MONTHLY' },
      })),
    },
    costPeriod: {
      findMany: vi.fn(async () => [
        { id: PER_SIGUIENTE, code: '2026-08', label: 'Agosto 2026' },
      ]),
      findFirst: vi.fn(async () => ({ id: 'per-1', code: '2026-07', label: 'Julio 2026' })),
    },
    processDepartment: {
      findMany: vi.fn(async () => [{ id: DEPT, name: 'Molienda', sequence: 1 }]),
    },
    unitMovementSchedule: {
      findMany: vi.fn(async () => [
        { departmentId: DEPT, finalWipMpAvance: 1, finalWipConvAvance: 0.5, initialWipCostMo: 0, initialWipCostCif: 0, periodCostMo: 100, periodCostCif: 100 },
      ]),
      upsert: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };
}

/** Informe del motor sobre el período que se reabre. */
const processCalc = {
  getProductionReport: vi.fn(async () => ({
    departments: [
      {
        id: DEPT,
        conversionUnified: true,
        schedule: { finalWip: 200 },
        report: {
          elements: [
            { element: 'MP', valuacionEF: 5000 },
            { element: 'CC', valuacionEF: 2000 },
          ],
          previousDepartment: null,
        },
      },
    ],
  })),
};

beforeEach(() => vi.clearAllMocks());

async function repropagar(db: ReturnType<typeof makeDb>) {
  const { CostPeriodPropagationService } = await import(
    '@/application/cost-structures/cost-period-propagation-service.js'
  );
  const svc = new CostPeriodPropagationService(db as never, processCalc as never);
  return svc.repropagateForward('user-1', 'st-1', '2026-07');
}

describe('Repropagación hacia adelante', () => {
  it('CREA el cuadro del mes siguiente si todavía no existe', async () => {
    const db = makeDb();

    const tocados = await repropagar(db);

    // Con `updateMany` esto no escribía nada y el test de más abajo (el que
    // verifica lo que se informa) igual pasaba: por eso el bug sobrevivió.
    expect(db.unitMovementSchedule.upsert).toHaveBeenCalledOnce();
    const llamada = db.unitMovementSchedule.upsert.mock.calls[0]![0];
    expect(llamada.where).toEqual({
      departmentId_periodId: { departmentId: DEPT, periodId: PER_SIGUIENTE },
    });
    expect(llamada.create.initialWip).toBe(200);
    expect(llamada.create.periodId).toBe(PER_SIGUIENTE);
    expect(tocados).toHaveLength(1);
  });

  it('el arrastre que escribe es el mismo por crear que por actualizar', async () => {
    const db = makeDb();

    await repropagar(db);

    const { create, update } = db.unitMovementSchedule.upsert.mock.calls[0]![0];
    // Si los dos caminos escribieran cosas distintas, el número de un mes
    // dependería de si su cuadro ya existía o no.
    const { departmentId: _d, periodId: _p, ...creado } = create;
    expect(creado).toEqual(update);
  });

  it('la existencia inicial nueva es la final del período anterior, valuada', async () => {
    const db = makeDb();

    await repropagar(db);

    const { create } = db.unitMovementSchedule.upsert.mock.calls[0]![0];
    // Identidad de la cátedra: el inventario final del período 1 es el inicial
    // del 2, con el mismo costo y los mismos grados de avance.
    expect(create.initialWip).toBe(200);
    expect(create.initialWipCostMp).toBe(5000);
    expect(create.initialWipMpAvance).toBe(1);
    expect(create.initialWipConvAvance).toBe(0.5);
    // Conversión unificada: los 2000 se reparten entre MO y CIF, sin perderse.
    expect(create.initialWipCostMo + create.initialWipCostCif).toBeCloseTo(2000, 6);
  });

  it('ya no se usa updateMany, que era el que fallaba en silencio', async () => {
    const db = makeDb();

    await repropagar(db);

    expect(db.unitMovementSchedule.updateMany).not.toHaveBeenCalled();
  });
});
