import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * COSTOS DEL PERÍODO EN EL CUADRO DE MOVIMIENTO (extensión de B15).
 *
 * El cuadro de movimiento mueve UNIDADES; los importes con los que esas unidades
 * se valúan viven en la misma fila `(departamento, período)` pero no entraban por
 * ningún lado: no había endpoint que escribiera `periodCostMp/Mo/Cif`, así que el
 * motor los leía siempre en 0 y el costo por procesos daba cero. Se cargan en el
 * mismo acto que las unidades, porque pertenecen al mismo departamento y período.
 *
 * Lo que se fija acá:
 *   · los seis importes se persisten;
 *   · cada uno queda trazable como DataPoint con SU elemento del costo real
 *     (MP / MOD / CIP), no con el MP genérico que usan las unidades;
 *   · un campo ausente NO se pisa — los costos de la existencia inicial los
 *     escribe el arrastre entre períodos (B18) y guardar unidades no debe
 *     borrarlos;
 *   · el costo del departamento anterior vuelve en la lectura, pero es de solo
 *     lectura: lo escribe la apertura del período, no el costista.
 */

const mockTx = {
  costStructure: { findFirst: vi.fn() },
  processDepartment: { findFirst: vi.fn() },
  costPeriod: { findFirst: vi.fn() },
  unitMovementSchedule: { findUnique: vi.fn(), upsert: vi.fn() },
  dataPoint: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  dataPointVersion: { create: vi.fn(), findFirst: vi.fn() },
  traceAuditLog: { create: vi.fn() },
  // El cuadro resuelve el NOMBRE de quien informó el recuento para devolverlo a
  // la pantalla (D7): un uuid no le sirve a nadie. Estos casos no cargan
  // recuento, así que devuelve null y el serializador dice "no consta".
  user: { findUnique: vi.fn(async () => null) },
};

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: mockTx,
  withTenant: (_userId: string, fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
}));

const actor = { id: 'user-1', role: 'COSTISTA', area: 'planta', device: 'test · 127.0.0.1' };

/** Un cuadro que cuadra: 1.000 + 9.000 entran; 8.000 + 450 + EF derivada salen. */
const UNIDADES = {
  initialWip: 1000,
  startedInProduction: 9000,
  transferredOut: 8000,
  normalLossPct: 0.05,
  finalWipConvAvance: 0.5,
  sourceArea: 'planta' as const,
  method: 'manual' as const,
};

const COSTOS = {
  periodCostMp: 60000,
  periodCostMo: 30000,
  periodCostCif: 22500,
  initialWipCostMp: 8800,
  initialWipCostMo: 4000,
  initialWipCostCif: 2510,
};

function mockContext() {
  mockTx.costStructure.findFirst.mockResolvedValue({
    id: 'st-1',
    userId: 'user-1',
    productName: 'Alcohol Fino',
    costingSystem: 'PROCESSES',
  });
  mockTx.processDepartment.findFirst.mockResolvedValue({
    id: 'dept-1',
    name: 'Destilado',
    sequence: 1,
    defaultConversionAvanceEqualsMO: true,
  });
  mockTx.costPeriod.findFirst.mockResolvedValue({ id: 'per-1', label: 'Abril 2026' });
  mockTx.unitMovementSchedule.upsert.mockImplementation(
    async (args: { create: Record<string, unknown> }) => ({ id: 'sch-1', ...args.create }),
  );
}

async function makeService() {
  const { UnitMovementService } = await import(
    '@/application/cost-structures/process-costing/unit-movement-service.js'
  );
  return new UnitMovementService(mockTx as never);
}

/** Lo que realmente se mandó a persistir en el upsert. */
function datosPersistidos(): Record<string, unknown> {
  const [args] = mockTx.unitMovementSchedule.upsert.mock.calls[0] as [
    { create: Record<string, unknown> },
  ];
  return args.create;
}

/** Los DataPoints creados, por fieldKey. */
function dataPointsCreados() {
  return mockTx.dataPoint.create.mock.calls.map(([args]: any) => args.data);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTx.dataPoint.create.mockResolvedValue({ id: 'dp-x' });
  mockTx.dataPointVersion.create.mockResolvedValue({ id: 'v1', versionN: 1 });
  mockTx.dataPoint.findFirst.mockResolvedValue(null);
  mockTx.dataPoint.findMany.mockResolvedValue([]);
  mockTx.unitMovementSchedule.findUnique.mockResolvedValue(null);
});

describe('Costos del período en el cuadro de movimiento', () => {
  it('persiste los seis importes junto con las unidades', async () => {
    mockContext();
    const service = await makeService();

    await service.save('user-1', 'st-1', 'dept-1', 'per-1', { ...UNIDADES, ...COSTOS }, actor);

    expect(datosPersistidos()).toMatchObject(COSTOS);
  });

  it('deja cada importe trazable con SU elemento del costo', async () => {
    mockContext();
    const service = await makeService();

    await service.save('user-1', 'st-1', 'dept-1', 'per-1', { ...UNIDADES, ...COSTOS }, actor);

    const porCampo = new Map(
      dataPointsCreados().map((d: any) => [String(d.fieldKey).split('.').pop(), d]),
    );

    expect(porCampo.get('periodCostMp')?.element).toBe('MP');
    expect(porCampo.get('periodCostMo')?.element).toBe('MOD');
    expect(porCampo.get('periodCostCif')?.element).toBe('CIP');
    expect(porCampo.get('initialWipCostCif')?.element).toBe('CIP');
    // Las unidades siguen yendo a MP: el cuadro sigue materia física, no un
    // elemento del costo puntual.
    expect(porCampo.get('initialWip')?.element).toBe('MP');
  });

  it('los importes se etiquetan en pesos, no en unidades', async () => {
    mockContext();
    const service = await makeService();

    await service.save('user-1', 'st-1', 'dept-1', 'per-1', { ...UNIDADES, ...COSTOS }, actor);

    const porCampo = new Map(
      dataPointsCreados().map((d: any) => [String(d.fieldKey).split('.').pop(), d]),
    );
    expect(porCampo.get('periodCostMp')?.unit).toBe('$');
    expect(porCampo.get('initialWip')?.unit).toBe('u');
  });

  it('un importe que no se manda NO se pisa (lo pudo escribir el arrastre B18)', async () => {
    mockContext();
    const service = await makeService();

    // Guardar solo unidades, sin tocar los costos.
    await service.save('user-1', 'st-1', 'dept-1', 'per-1', { ...UNIDADES }, actor);

    const datos = datosPersistidos();
    for (const campo of [
      'periodCostMp',
      'periodCostMo',
      'periodCostCif',
      'initialWipCostMp',
      'initialWipCostMo',
      'initialWipCostCif',
    ]) {
      // `undefined` ⇒ Prisma no toca la columna. Un `null` la borraría.
      expect(datos[campo]).toBeUndefined();
    }
  });

  it('la lectura devuelve los importes y el costo del departamento anterior', async () => {
    mockContext();
    mockTx.unitMovementSchedule.findUnique.mockResolvedValue({
      id: 'sch-1',
      initialWip: 1000,
      startedInProduction: 9000,
      receivedFromPrevious: null,
      unitIncrease: null,
      transferredOut: 8000,
      finishedInStock: 0,
      normalLossPct: 0.05,
      normalLoss: 450,
      totalLossReported: null,
      extraordinaryLoss: 0,
      finalWip: 1550,
      finalWipMpAvance: null,
      finalWipConvAvance: 0.5,
      initialWipMpAvance: null,
      initialWipConvAvance: null,
      ...COSTOS,
      initialWipCostPrevDept: 21192,
    });

    const service = await makeService();
    const { saved } = await service.get('user-1', 'st-1', 'dept-1', 'per-1');

    expect(saved).toMatchObject(COSTOS);
    expect(saved!.initialWipCostPrevDept).toBe(21192);
  });

  it('los impactos son los de Procesos, no los de Órdenes', async () => {
    // Un dato del cuadro de movimiento no repercute en el PPP ni en el COGS:
    // repercute en la produccion equivalente y, via el costo transferido, en las
    // etapas siguientes. Mostrarle a un costista de Procesos los impactos de
    // Ordenes es decirle algo falso sobre su propio numero.
    const { DataPointService } = await import('@/application/trazabilidad/data-point-service.js');
    const svc = new DataPointService(mockTx as never);
    // `impactsFor` es privado: se llega por el mismo camino que la ficha.
    const impactos = (
      svc as unknown as { impactsFor: (el: string, key?: string | null) => string[] }
    ).impactsFor.bind(svc);

    const cuadro = impactos('MP', 'proceso.cuadro.per-1.dept-1.finalWip');
    expect(cuadro).toContain('Producción equivalente');
    expect(cuadro).toContain('Existencia inicial del período siguiente');
    expect(cuadro).not.toContain('PPP');
    expect(cuadro).not.toContain('COGS');

    const costo = impactos('MOD', 'proceso.cuadro.per-1.dept-1.periodCostMo');
    expect(costo).toContain('Costo del período del departamento');
    expect(costo).toContain('Costo del producto terminado');

    // Órdenes no cambia: sin fieldKey de proceso, los impactos de siempre.
    expect(impactos('MP', 'mp.material.0.unitCost')).toContain('PPP');
    expect(impactos('MOD')).toContain('ITCS');
  });

  it('rechaza un importe negativo', async () => {
    mockContext();
    const { unitMovementInputSchema } = await import(
      '@/shared/schemas/unit-movement.schema.js'
    );
    const parsed = unitMovementInputSchema.safeParse({
      ...UNIDADES,
      periodCostMp: -1,
    });
    expect(parsed.success).toBe(false);
  });
});
