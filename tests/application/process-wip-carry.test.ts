import { describe, it, expect, vi } from 'vitest';
import { CostPeriodPropagationService } from '@/application/cost-structures/cost-period-propagation-service.js';
import {
  ProcessCostingEngine,
  type ProcessCalculationInput,
  type ProcessDepartmentInput,
} from '@/application/cost-structures/process-costing/process-costing-engine.js';

vi.mock('@/application/audit/audit-logger.js', () => ({
  recordAudit: vi.fn(async () => undefined),
}));

/**
 * B18 · FX-P2 — ARRASTRE DE EXISTENCIAS ENTRE PERÍODOS (Azur Alcoholes, abril → mayo).
 *
 * Caso de cátedra: Clase 22 — "Cálculo de costos por procesos: abril y mayo".
 * El insumo de abril es el de FX-P1 (Clases 21-22).
 *
 * Regla de la cátedra: "el inventario final del período 1 es el inventario
 * inicial del período 2". En Costeo por Procesos la producción no se corta a fin
 * de mes: lo que quedó a medio hacer en cada departamento es, literalmente, con
 * lo que arranca el mes siguiente — mismas unidades, mismos grados de avance, y
 * el costo con el que cerraron.
 *
 * Lo que fija este test:
 *   · Cerrar abril y abrir mayo deja el cuadro de movimiento de mayo con la EI ya
 *     cargada, SIN que el costista recargue nada a mano.
 *   · El costo viaja repartido por elemento, y en los departamentos sucesivos
 *     viaja además el COSTO DEL DEPARTAMENTO ANTERIOR que la EF ya traía adentro
 *     (costo modificado + CAUP). Esa última cifra es la que antes se perdía: el
 *     motor la aceptaba por input pero no había columna donde guardarla.
 *   · Una estructura de Órdenes no arrastra nada de esto (cero regresión).
 *
 * Los números de abril NO están escritos a mano acá: se derivan corriendo el
 * motor real sobre el insumo de FX-P1, y el test los ancla contra los valores de
 * la cátedra ($3,75 y $6,532) antes de mirar el arrastre. Si el fixture ancla
 * cambiara, este test falla de frente en vez de verificar en silencio otra cosa.
 */

const USER = 'user-1';
const STRUCTURE = 'struct-azur';
const ABRIL = 'per-abril';

const DESTILADO = 'dept-destilado';
const PURIFICADO = 'dept-purificado';

// --- FX-P1 · el insumo de abril, igual al del test ancla del motor (B17) -------

const destilado: ProcessDepartmentInput = {
  id: DESTILADO,
  name: 'Destilado',
  sequence: 1,
  conversionUnified: true,
  periodId: ABRIL,
  units: {
    initialWip: 5000,
    startedInProduction: 30000,
    transferredOut: 30000,
    finishedInStock: 0,
    normalLossPct: 0.02,
    totalLossReported: 1600,
    // finalWip derivada = 3.400
  },
  finalWipConversionAvance: 0.8,
  costs: { mpInicial: 8800, mpPeriodo: 60000, moInicial: 6510, moPeriodo: 52500 },
};

const purificado: ProcessDepartmentInput = {
  id: PURIFICADO,
  name: 'Purificado',
  sequence: 2,
  conversionUnified: true,
  periodId: ABRIL,
  units: {
    initialWip: 3320,
    receivedFromPrevious: 30000,
    unitIncrease: 2000,
    transferredOut: 29000,
    finishedInStock: 0,
    normalLossPct: 0.01,
    // finalWip derivada = 6.000
  },
  finalWipConversionAvance: 0.4,
  costs: { mpInicial: 5000, mpPeriodo: 30000, moInicial: 12800, moPeriodo: 50000 },
  initialWipTransferredCost: 11120,
};

const abrilInput: ProcessCalculationInput = { departments: [destilado, purificado] };

/** El informe de abril tal como lo produce el motor real. */
function informeDeAbril() {
  const { results } = new ProcessCostingEngine().run(abrilInput);
  return {
    product: 'Alcohol',
    period: 'Abril 2026',
    finalUnitCost: results.finalUnitCost,
    finalDepartmentName: results.finalDepartmentName,
    departments: results.departments,
  };
}

// --- Andamiaje -----------------------------------------------------------------

/** Los cuadros de movimiento de abril tal como quedaron persistidos. */
const schedulesAbril = [
  {
    departmentId: DESTILADO,
    periodId: ABRIL,
    finalWipMpAvance: null,
    finalWipConvAvance: 0.8,
    initialWipCostMo: 6510,
    periodCostMo: 52500,
    initialWipCostCif: null,
    periodCostCif: null,
  },
  {
    departmentId: PURIFICADO,
    periodId: ABRIL,
    finalWipMpAvance: null,
    finalWipConvAvance: 0.4,
    initialWipCostMo: 12800,
    periodCostMo: 50000,
    initialWipCostCif: null,
    periodCostCif: null,
  },
];

const abril = {
  id: ABRIL,
  structureId: STRUCTURE,
  code: '2026-04',
  label: 'Abril 2026',
  status: 'CLOSED' as const,
  salesUnitPrice: null,
  salesQuantity: null,
  rawMaterialConfig: { materials: [] },
  directLaborConfig: {},
  indirectCostConfig: {},
};

function makeDb(opts: {
  costingSystem?: string;
  departments?: { id: string; name: string; sequence: number }[];
  schedules?: Record<string, unknown>[];
} = {}) {
  const createdSchedules: Record<string, unknown>[] = [];
  const db: Record<string, unknown> = {
    costStructure: {
      findFirst: vi.fn(async () => ({
        id: STRUCTURE,
        userId: USER,
        companyId: 'comp-1',
        period: '2026-04',
        deletedAt: null,
        costingSystem: opts.costingSystem ?? 'PROCESSES',
        productName: 'Alcohol',
        rawMaterialConfig: { materials: [] },
        directLaborConfig: {},
        indirectCostConfig: {},
        salesUnitPrice: null,
        salesQuantity: null,
        productionQuantity: null,
        company: { id: 'comp-1', periodicity: 'MONTHLY' },
      })),
      update: vi.fn(async () => ({ id: STRUCTURE })),
    },
    costPeriod: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        where.status === 'OPEN' ? null : abril,
      ),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'per-mayo',
        ...data,
      })),
    },
    costConfigVersion: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    processDepartment: {
      findMany: vi.fn(async () =>
        opts.departments ?? [
          { id: DESTILADO, name: 'Destilado', sequence: 1 },
          { id: PURIFICADO, name: 'Purificado', sequence: 2 },
        ],
      ),
    },
    unitMovementSchedule: {
      findMany: vi.fn(async () => opts.schedules ?? schedulesAbril),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdSchedules.push(data);
        return data;
      }),
    },
  };
  db.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return { db, createdSchedules };
}

/** Servicio de cálculo de Procesos stubbeado con el informe REAL de abril. */
function makeProcessCalc() {
  return { getProductionReport: vi.fn(async () => informeDeAbril()) };
}

const ctx = { ip: '127.0.0.1', userAgent: 'test' } as never;

async function abrirMayo(opts: Parameters<typeof makeDb>[0] = {}) {
  const { db, createdSchedules } = makeDb(opts);
  const svc = new CostPeriodPropagationService(db as never, makeProcessCalc() as never);
  const periodo = await svc.openNext(USER, STRUCTURE, { recipe: true }, ctx);
  return { periodo, createdSchedules, db };
}

// --- Tests ---------------------------------------------------------------------

describe('B18 · FX-P2 — arrastre de existencias entre períodos, abril → mayo (Clase 22)', () => {
  it('ancla: abril reproduce los costos unitarios de la cátedra ($3,75 y $6,532)', () => {
    const informe = informeDeAbril();
    const d = informe.departments.find((x) => x.name === 'Destilado')!;
    const p = informe.departments.find((x) => x.name === 'Purificado')!;

    expect(d.report.costoUnitarioTotalAcumulado).toBe(3.75);
    expect(p.report.costoUnitarioTotalAcumulado).toBe(6.532);
    // Las existencias finales que este test va a ver viajar a mayo.
    expect(d.report.valuacionExistenciaFinalPorElemento).toBe(11560);
    expect(p.report.valuacionExistenciaFinalPorElemento).toBe(31992);
  });

  it('abre mayo con el cuadro de movimiento de cada departamento ya cargado', async () => {
    const { periodo, createdSchedules } = await abrirMayo();

    expect((periodo as { code: string }).code).toBe('2026-05');
    expect(createdSchedules).toHaveLength(2);
    for (const s of createdSchedules) {
      expect(s.periodId).toBe('per-mayo');
    }
  });

  it('Destilado: la EF de abril (3.400 u al 80 % de conversión) es la EI de mayo', async () => {
    const { createdSchedules } = await abrirMayo();
    const d = createdSchedules.find((s) => s.departmentId === DESTILADO)!;

    expect(d.initialWip).toBe(3400);
    expect(d.initialWipConvAvance).toBe(0.8);
    // MP: 3.400 × $2,00 = $6.800 · Conversión: 3.400 × 0,80 × $1,75 = $4.760.
    expect(d.initialWipCostMp).toBe(6800);
    expect(d.initialWipCostMo).toBe(4760);
    expect(d.initialWipCostCif).toBe(0);
    // Departamento inicial: no hay etapa previa de la que traer costo.
    expect(d.initialWipCostPrevDept).toBe(0);
  });

  it('Purificado: arrastra además el costo del departamento anterior ($21.192)', async () => {
    const { createdSchedules } = await abrirMayo();
    const p = createdSchedules.find((s) => s.departmentId === PURIFICADO)!;

    expect(p.initialWip).toBe(6000);
    expect(p.initialWipConvAvance).toBe(0.4);
    // MP: 6.000 × $1,00 · Conversión: 6.000 × 0,40 × $2,00 = $4.800.
    expect(p.initialWipCostMp).toBe(6000);
    expect(p.initialWipCostMo).toBe(4800);
    // 6.000 u × $3,532 (costo modificado $3,50 + CAUP $0,032) = $21.192.
    expect(p.initialWipCostPrevDept).toBe(21192);
  });

  it('el total arrastrado es exactamente la existencia final valuada de abril', async () => {
    const { createdSchedules } = await abrirMayo();
    const total = createdSchedules.reduce(
      (a, s) =>
        a +
        Number(s.initialWipCostMp) +
        Number(s.initialWipCostMo) +
        Number(s.initialWipCostCif) +
        Number(s.initialWipCostPrevDept),
      0,
    );
    // $11.560 (Destilado) + $31.992 (Purificado).
    expect(total).toBe(43552);
  });

  it('reparte la conversión entre MO y CIF en la proporción con la que cerró el período', async () => {
    // Mismo Destilado, pero el período cerró con la conversión repartida 60/40
    // entre mano de obra y carga fabril.
    const { createdSchedules } = await abrirMayo({
      departments: [{ id: DESTILADO, name: 'Destilado', sequence: 1 }],
      schedules: [
        {
          departmentId: DESTILADO,
          periodId: ABRIL,
          finalWipMpAvance: null,
          finalWipConvAvance: 0.8,
          initialWipCostMo: 0,
          periodCostMo: 35406, // 60 % de 59.010
          initialWipCostCif: 0,
          periodCostCif: 23604, // 40 % de 59.010
        },
      ],
    });

    const d = createdSchedules.find((s) => s.departmentId === DESTILADO)!;
    // $4.760 de conversión repartidos 60/40.
    expect(d.initialWipCostMo).toBeCloseTo(2856, 6);
    expect(d.initialWipCostCif).toBeCloseTo(1904, 6);
    expect(Number(d.initialWipCostMo) + Number(d.initialWipCostCif)).toBeCloseTo(4760, 6);
  });

  it('una estructura de Órdenes no arrastra producción en proceso (cero regresión)', async () => {
    const { createdSchedules } = await abrirMayo({ costingSystem: 'ORDERS' });
    expect(createdSchedules).toHaveLength(0);
  });

  it('sin departamentos cargados, abrir el período nuevo no se bloquea', async () => {
    const { periodo, createdSchedules } = await abrirMayo({ departments: [] });
    expect((periodo as { code: string }).code).toBe('2026-05');
    expect(createdSchedules).toHaveLength(0);
  });

  it('sin cuadros de movimiento en el período que cierra, tampoco se bloquea', async () => {
    const { periodo, createdSchedules } = await abrirMayo({ schedules: [] });
    expect((periodo as { code: string }).code).toBe('2026-05');
    expect(createdSchedules).toHaveLength(0);
  });
});
