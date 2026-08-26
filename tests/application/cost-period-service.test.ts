import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostPeriodService } from '@/application/cost-structures/cost-period-service.js';
import { CostPeriodPropagationService } from '@/application/cost-structures/cost-period-propagation-service.js';
import { ENGINE_VERSION } from '@/domain/calculations/calculate.js';
import { ValidationError } from '@/domain/errors/domain-error.js';

vi.mock('@/application/audit/audit-logger.js', () => ({
  recordAudit: vi.fn(async () => undefined),
}));

/**
 * C — Fases 1 y 3. Las tres operaciones del período: abrir, cerrar y reabrir.
 *
 * Reglas que se fijan acá:
 *   · Un período nuevo NO arrastra lo que es del mes (compras, consumos,
 *     actividad real, CIP real). Arrastrarlo sería costear julio con los
 *     movimientos de junio.
 *   · SÍ arrastra la EXISTENCIA FINAL de cada materia prima como existencia
 *     inicial, valuada al PPP con el que cerró (Fase 3). Es la única cifra del
 *     mes anterior que viaja: contablemente es el punto de partida del que abre.
 *   · Al abrir el siguiente, la estructura (donde escribe la app) queda con lo
 *     arrastrado: la pantalla amanece en el mes nuevo.
 *   · NO se puede cerrar un período con centros sin actividad real / CIP real
 *     (la regla de E3): el cierre es cuando el sistema exige lo que falta.
 *   · Reabrir se puede, pero exige motivo y deja rastro.
 */

const USER = 'user-1';
const STRUCTURE = 'struct-1';

/**
 * Junio, cerrado. La ficha de la chapa:
 *   existencia inicial   100 u × $1.000  = $100.000
 *   compra              +400 u × $1.200  = $480.000  → saldo 500 u, $580.000, PPP $1.160
 *   consumo             -200 u × $1.160  = $232.000  → saldo 300 u, $348.000, PPP $1.160
 * Julio tiene que abrir con 300 unidades a $1.160 (no con las 100 a $1.000 de junio).
 */
const junio = {
  id: 'per-junio',
  structureId: STRUCTURE,
  userId: USER,
  code: '2026-06',
  label: 'Junio 2026',
  status: 'CLOSED' as const,
  closedAt: new Date('2026-07-02'),
  salesUnitPrice: 5000,
  salesQuantity: 120,
  rawMaterialConfig: {
    materials: [
      {
        name: 'Chapa',
        unit: 'kg',
        // La ficha va completa: desde la Fase 4 el cierre CORRE el motor sobre los
        // datos del período, y el motor exige el insumo entero (Wilson + política
        // de stock), como en un período real.
        wilson: { annualDemand: 6000, orderCost: 5000, holdingRate: 0.3, unitCost: 1200 },
        stockPolicy: {
          minConsumption: 10,
          maxConsumption: 30,
          minLeadTime: 2,
          maxLeadTime: 5,
          safetyStock: 50,
        },
        initialStock: { quantity: 100, unitCost: 1000 },
        movements: [
          { date: '05/06/2026', type: 'purchase', detail: 'Compra', quantity: 400, unitCost: 1200 },
          { date: '20/06/2026', type: 'consumption', detail: 'Consumo', quantity: 200 },
        ],
      },
    ],
  },
  directLaborConfig: {
    workingDays: {
      totalDaysPerYear: 365,
      unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 0, holidaysOnWeekend: 0 },
      paidAbsence: { holidays: 15, vacations: 14, sickness: 5, specialLeaves: 2, workAccidents: 0 },
    },
    itcs: {
      derivationBase: 0.23,
      fixedArt: 0.05,
      uncertainRemunerative: [],
      uncertainNonRemunerative: [],
    },
    departments: [{ name: 'Corte', basicRemuneration: 800000, hoursWorked: 160 }],
  },
  indirectCostConfig: {
    centers: [{ id: 'corte', name: 'Corte', type: 'productive' }],
    concepts: [{ name: 'Alquiler', amount: { fixed: 300000, variable: 0 }, distribution: { corte: 40 } }],
    serviceDistributions: [],
    productiveSettings: [
      { centerId: 'corte', normalCapacity: 160, actualActivity: 150, actualCip: 350000 },
    ],
  },
};

function makeDb(overrides: Record<string, unknown> = {}) {
  const db: Record<string, unknown> = {
    costStructure: {
      findFirst: vi.fn(async () => ({
        id: STRUCTURE,
        userId: USER,
        companyId: 'comp-1',
        period: '2026-06',
        deletedAt: null,
        rawMaterialConfig: junio.rawMaterialConfig,
        directLaborConfig: junio.directLaborConfig,
        indirectCostConfig: junio.indirectCostConfig,
        salesUnitPrice: 5000,
        salesQuantity: 120,
        company: { id: 'comp-1', periodicity: 'MONTHLY' },
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: STRUCTURE, ...data })),
    },
    costPeriod: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'per-nuevo', ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'per-x', ...data })),
    },
    costConfigVersion: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
    },
    // Por defecto no hay datos sin imputar: el cierre no se traba por eso.
    dataPoint: {
      findMany: vi.fn(async () => []),
    },
    // El cierre corre el detector de anomalias y persiste lo que encuentre en la
    // MISMA transaccion. Ojo: la variacion de CIF no necesita historia, asi que
    // puede haber alertas ya en el primer periodo cerrado.
    alert: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    ...overrides,
  };
  // La apertura corre en una transacción: acá el "tx" es el mismo mock.
  db.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return db as {
    costStructure: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    costPeriod: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    costConfigVersion: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    dataPoint: { findMany: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

/** El período abierto no existe todavía; el último cerrado es junio. */
function afterJunio(db: ReturnType<typeof makeDb>) {
  db.costPeriod.findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    where.status === 'OPEN' ? null : junio,
  );
}

const ctx = { ip: '127.0.0.1', userAgent: 'test' } as never;

type NuevoPeriodo = {
  code: string;
  label: string;
  status: string;
  salesUnitPrice: number | null;
  salesQuantity: number | null;
  rawMaterialConfig: {
    materials: { movements: unknown[]; initialStock: { quantity: number; unitCost: number } }[];
  };
  directLaborConfig: { departments: { basicRemuneration: number; hoursWorked: number }[] };
  indirectCostConfig: {
    concepts: { amount: { fixed: number } }[];
    productiveSettings: { actualActivity: number; actualCip: number; normalCapacity: number }[];
  };
};

describe('ABRIR período', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
  });

  it('abre el mes siguiente al último cerrado (junio → julio)', async () => {
    afterJunio(db);

    const svc = new CostPeriodPropagationService(db as never);
    const nuevo = await svc.openNext(USER, STRUCTURE, { recipe: true }, ctx);

    expect(nuevo.code).toBe('2026-07');
    expect(nuevo.label).toBe('Julio 2026');
    expect(nuevo.status).toBe('OPEN');
  });

  it('NO arrastra lo que es del mes: compras, consumos, actividad real ni CIP real', async () => {
    afterJunio(db);

    const svc = new CostPeriodPropagationService(db as never);
    const nuevo = (await svc.openNext(USER, STRUCTURE, { recipe: true }, ctx)) as never as NuevoPeriodo;

    // Los movimientos de junio NO viajan a julio.
    expect(nuevo.rawMaterialConfig.materials[0]!.movements).toEqual([]);
    // El cierre de junio NO viaja a julio; la capacidad normal sí.
    const ps = nuevo.indirectCostConfig.productiveSettings[0]!;
    expect(ps.actualActivity).toBe(0);
    expect(ps.actualCip).toBe(0);
    expect(ps.normalCapacity).toBe(160);
    // Las unidades vendidas son del mes; el precio de lista se conserva.
    expect(nuevo.salesQuantity).toBe(0);
    expect(nuevo.salesUnitPrice).toBe(5000);
  });

  it('🔑 la existencia final de junio es la existencia inicial de julio, al PPP de cierre', async () => {
    afterJunio(db);

    const svc = new CostPeriodPropagationService(db as never);
    const nuevo = (await svc.openNext(USER, STRUCTURE, { recipe: true }, ctx)) as never as NuevoPeriodo;

    // 100 @ 1000 + 400 @ 1200 = 500 u a PPP 1160; se consumen 200 → quedan 300 @ 1160.
    expect(nuevo.rawMaterialConfig.materials[0]!.initialStock).toEqual({
      quantity: 300,
      unitCost: 1160,
    });
  });

  it('deja la estructura lista para el mes nuevo (la pantalla amanece en julio)', async () => {
    afterJunio(db);

    const svc = new CostPeriodPropagationService(db as never);
    await svc.openNext(USER, STRUCTURE, { recipe: true }, ctx);

    expect(db.costStructure.update).toHaveBeenCalledTimes(1);
    const data = db.costStructure.update.mock.calls[0]![0].data as NuevoPeriodo & { period: string };
    expect(data.period).toBe('2026-07');
    expect(data.rawMaterialConfig.materials[0]!.movements).toEqual([]);
    expect(data.rawMaterialConfig.materials[0]!.initialStock).toEqual({
      quantity: 300,
      unitCost: 1160,
    });
    // Y el reseteo queda versionado (historial append-only, R1).
    expect(db.costConfigVersion.create).toHaveBeenCalled();
  });

  it('si la ficha de stock del mes que cierra no cuadra, no abre e indica cuál MP', async () => {
    const roto = {
      ...junio,
      rawMaterialConfig: {
        materials: [
          {
            name: 'Chapa',
            initialStock: { quantity: 10, unitCost: 1000 },
            // Se consumen 50 unidades que nunca existieron: la ficha no cierra.
            movements: [{ date: '20/06/2026', type: 'consumption', detail: 'Consumo', quantity: 50 }],
          },
        ],
      },
    };
    db.costPeriod.findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      where.status === 'OPEN' ? null : roto,
    );

    const svc = new CostPeriodPropagationService(db as never);
    await expect(svc.openNext(USER, STRUCTURE, { recipe: true }, ctx)).rejects.toThrow(/Chapa/);
    expect(db.costPeriod.create).not.toHaveBeenCalled();
    expect(db.costStructure.update).not.toHaveBeenCalled();
  });

  it('sin pedir arrastre de importes, los importes arrancan en cero', async () => {
    afterJunio(db);

    const svc = new CostPeriodPropagationService(db as never);
    const nuevo = (await svc.openNext(
      USER,
      STRUCTURE,
      { recipe: true, amounts: false },
      ctx,
    )) as never as NuevoPeriodo;

    expect(nuevo.indirectCostConfig.concepts[0]!.amount.fixed).toBe(0);
    expect(nuevo.directLaborConfig.departments[0]!.basicRemuneration).toBe(0);
    // Pero la receta queda: el departamento sigue existiendo con sus horas.
    expect(nuevo.directLaborConfig.departments[0]!.hoursWorked).toBe(160);
  });

  it('si el costista pide arrastrar los importes, vienen los del mes anterior', async () => {
    afterJunio(db);

    const svc = new CostPeriodPropagationService(db as never);
    const nuevo = (await svc.openNext(
      USER,
      STRUCTURE,
      { recipe: true, amounts: true },
      ctx,
    )) as never as NuevoPeriodo;

    expect(nuevo.indirectCostConfig.concepts[0]!.amount.fixed).toBe(300000);
    expect(nuevo.directLaborConfig.departments[0]!.basicRemuneration).toBe(800000);
  });

  it('el PRIMER período fotografía lo que ya hay cargado y no toca la pantalla', async () => {
    // Sin períodos previos: no hay de dónde arrastrar.
    const svc = new CostPeriodPropagationService(db as never);
    const nuevo = (await svc.openNext(USER, STRUCTURE, { recipe: true }, ctx)) as never as NuevoPeriodo;

    expect(nuevo.code).toBe('2026-06'); // el período histórico tipeado de la estructura
    // La foto es tal cual: los movimientos cargados siguen ahí.
    expect(nuevo.rawMaterialConfig.materials[0]!.movements).toHaveLength(2);
    expect(nuevo.rawMaterialConfig.materials[0]!.initialStock).toEqual({
      quantity: 100,
      unitCost: 1000,
    });
    // Y NO se resetea la estructura: sería borrarle el trabajo al costista.
    expect(db.costStructure.update).not.toHaveBeenCalled();
  });

  it('no deja abrir un período nuevo si hay uno abierto', async () => {
    db.costPeriod.findFirst = vi.fn(async () => ({ ...junio, status: 'OPEN', label: 'Junio 2026' }));

    const svc = new CostPeriodPropagationService(db as never);
    await expect(svc.openNext(USER, STRUCTURE, { recipe: true }, ctx)).rejects.toThrow(ValidationError);
  });
});

describe('PREVIEW de apertura (qué voy a traer del mes anterior)', () => {
  it('muestra con qué existencia y a qué PPP arranca cada materia prima', async () => {
    const db = makeDb();
    afterJunio(db);

    const svc = new CostPeriodPropagationService(db as never);
    const preview = await svc.previewNext(USER, STRUCTURE);

    expect(preview.isFirst).toBe(false);
    expect(preview.next.label).toBe('Julio 2026');
    expect(preview.from?.label).toBe('Junio 2026');
    expect(preview.openingStock).toEqual([
      { name: 'Chapa', unit: 'kg', quantity: 300, unitCost: 1160, value: 348000 },
    ]);
    expect(preview.amounts).toEqual({ wages: 800000, indirect: 300000 });
    expect(preview.openingStockError).toBeNull();
    // Es solo mirar: no crea ni modifica nada.
    expect(db.costPeriod.create).not.toHaveBeenCalled();
    expect(db.costStructure.update).not.toHaveBeenCalled();
  });

  it('si la ficha no cuadra, lo dice en vez de romper el diálogo', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      where.status === 'OPEN'
        ? null
        : {
            ...junio,
            rawMaterialConfig: {
              materials: [
                {
                  name: 'Chapa',
                  initialStock: { quantity: 10, unitCost: 1000 },
                  movements: [
                    { date: '20/06', type: 'consumption', detail: 'Consumo', quantity: 50 },
                  ],
                },
              ],
            },
          },
    );

    const svc = new CostPeriodPropagationService(db as never);
    const preview = await svc.previewNext(USER, STRUCTURE);

    expect(preview.openingStock).toEqual([]);
    expect(preview.openingStockError).toMatch(/Chapa/);
  });
});

describe('CERRAR período', () => {
  it('no deja cerrar si un centro no tiene actividad real y CIP real (regla de E3)', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => ({
      ...junio,
      status: 'OPEN',
      indirectCostConfig: {
        centers: [{ id: 'corte', name: 'Corte', type: 'productive' }],
        productiveSettings: [{ centerId: 'corte', normalCapacity: 160, actualActivity: 0, actualCip: 0 }],
      },
    }));

    const svc = new CostPeriodService(db as never);
    await expect(svc.close(USER, 'per-x', null, ctx)).rejects.toThrow(/Corte/);
    expect(db.costPeriod.update).not.toHaveBeenCalled();
  });

  it('F04 — no deja cerrar si hay un dato sin imputar, y lo nombra (422, sin endpoints ni ids)', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => ({ ...junio, status: 'OPEN' }));
    // El cierre está completo (E3 ok), pero cuelga un dato sin decidir su período.
    db.dataPoint.findMany = vi.fn(async () => [
      { id: 'dp-1', label: 'Compra — Proveedor Sur, 27/06' },
    ]);

    const svc = new CostPeriodService(db as never);

    await expect(svc.close(USER, 'per-x', null, ctx)).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('Compra — Proveedor Sur, 27/06'),
    });
    // No se cierra nada mientras haya datos sin imputar.
    expect(db.costPeriod.update).not.toHaveBeenCalled();

    // Regla #7: el mensaje no filtra endpoints ni el id interno del dato.
    // F05 — el 422 adjunta la lista ESTRUCTURADA de pendientes en `details`
    // para que el front los resuelva en el lugar del bloqueo (sin caer a la
    // lista vieja del último cálculo). El id solo abre la ficha; se muestra el
    // nombre.
    await svc.close(USER, 'per-x', null, ctx).catch((e: Error & { details?: unknown }) => {
      expect(e.message).not.toMatch(/POST|\/data-points|:id/);
      expect(e.message).not.toContain('dp-1');
      expect((e.details as { datosPendientes?: unknown }).datosPendientes).toEqual([
        { id: 'dp-1', nombre: 'Compra — Proveedor Sur, 27/06' },
      ]);
    });
  });

  it('F04 — una vez imputado el dato (sin pendientes), el período cierra normalmente', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => ({ ...junio, status: 'OPEN' }));
    db.dataPoint.findMany = vi.fn(async () => []); // ya no hay pendientes

    const svc = new CostPeriodService(db as never);
    const cerrado = await svc.close(USER, 'per-x', 'run-9', ctx);

    expect(cerrado.status).toBe('CLOSED');
    expect(cerrado.closedRunId).toBe('run-9');
  });

  it('con el cierre completo, congela el período', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => ({ ...junio, status: 'OPEN' }));

    const svc = new CostPeriodService(db as never);
    const cerrado = await svc.close(USER, 'per-x', 'run-9', ctx);

    expect(cerrado.status).toBe('CLOSED');
    expect(cerrado.closedBy).toBe(USER);
    expect(cerrado.closedRunId).toBe('run-9');
  });

  it('🔒 al cerrar, CORRE el motor y deja los números congelados en el período', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => ({ ...junio, status: 'OPEN' }));

    const svc = new CostPeriodService(db as never);
    await svc.close(USER, 'per-x', null, ctx);

    const data = (db.costPeriod.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    const snap = data.resultSnapshot;

    // El mes cerrado guarda SU resultado: no hay que recalcularlo nunca más.
    expect(data.resultEngineVersion).toBe(ENGINE_VERSION);
    expect(data.resultAt).toBeInstanceOf(Date);

    // La MP consumida es la de la ficha de junio: 200 u al PPP de $1.160 = $232.000.
    // Si esto cambia, el arrastre y la comparación mienten.
    expect(snap.rawMaterialConsumed).toBeCloseTo(232000, 2);
    expect(snap.productionCost).toBeGreaterThan(0);
    expect(snap.detail.rawMaterial.materials[0].name).toBe('Chapa');

    // `raw` son andamios internos (Money/Decimal): no se congelan.
    expect(snap.raw).toBeUndefined();
  });

  it('si el motor no puede calcular, el mes NO se cierra (nada de cerrar sin números)', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => ({
      ...junio,
      status: 'OPEN',
      // Sin la sección de mano de obra el motor no puede correr. Antes esto cerraba
      // igual y dejaba el mes firmado y vacío.
      directLaborConfig: null,
    }));

    const svc = new CostPeriodService(db as never);
    await expect(svc.close(USER, 'per-x', null, ctx)).rejects.toThrow(/no pudo calcular/i);
    expect(db.costPeriod.update).not.toHaveBeenCalled();
  });

  it('un período ya cerrado no se cierra dos veces', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => junio); // CLOSED

    const svc = new CostPeriodService(db as never);
    await expect(svc.close(USER, 'per-junio', null, ctx)).rejects.toThrow(ValidationError);
  });

  describe('#116 — amortización de activos al cerrar', () => {
    const conActivos = (activosAmortizables: unknown[], parametrosCosteo: unknown[] = []) => ({
      ...junio,
      status: 'OPEN',
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-30'),
      company: { activosAmortizables, parametrosCosteo },
    });

    it('suma la cuota de un activo dado de alta antes del período', async () => {
      const db = makeDb();
      db.costPeriod.findFirst = vi.fn(async () =>
        conActivos([
          {
            structureId: null,
            costoAdquisicion: 1_200_000,
            valorResidual: 0,
            vidaUtilMeses: 12,
            fechaAlta: new Date('2026-01-01'),
          },
        ]),
      );

      const svc = new CostPeriodService(db as never);
      await svc.close(USER, 'per-x', null, ctx);

      const snap = (db.costPeriod.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data
        .resultSnapshot;
      expect(snap.assetDepreciation).toBe(100_000); // 1.200.000 / 12
      expect(snap.realProductionCost).toBeGreaterThanOrEqual(snap.productionCost + 100_000);
    });

    it('un activo dado de alta ESTE período no aporta cuota (comprar no es costear)', async () => {
      const db = makeDb();
      db.costPeriod.findFirst = vi.fn(async () =>
        conActivos([
          {
            structureId: null,
            costoAdquisicion: 1_200_000,
            valorResidual: 0,
            vidaUtilMeses: 12,
            fechaAlta: new Date('2026-06-15'),
          },
        ]),
      );

      const svc = new CostPeriodService(db as never);
      await svc.close(USER, 'per-x', null, ctx);

      const snap = (db.costPeriod.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data
        .resultSnapshot;
      expect(snap.assetDepreciation).toBe(0);
    });

    it('sin vida útil propia, la resuelve del catálogo de parámetros de costeo (#115)', async () => {
      const db = makeDb();
      db.costPeriod.findFirst = vi.fn(async () =>
        conActivos(
          [
            {
              structureId: null,
              costoAdquisicion: 1_800_000,
              valorResidual: 0,
              vidaUtilMeses: null, // sin override: viene del catálogo
              fechaAlta: new Date('2026-01-01'),
            },
          ],
          [
            {
              clave: 'vida_util_lote_meses',
              valorNum: 18,
              periodId: null,
              structureId: null,
              confirmado: true,
            },
          ],
        ),
      );

      const svc = new CostPeriodService(db as never);
      await svc.close(USER, 'per-x', null, ctx);

      const snap = (db.costPeriod.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data
        .resultSnapshot;
      expect(snap.assetDepreciation).toBe(100_000); // 1.800.000 / 18
    });

    it('un activo de OTRA estructura no aporta cuota acá', async () => {
      const db = makeDb();
      db.costPeriod.findFirst = vi.fn(async () =>
        conActivos([
          {
            structureId: 'otra-estructura',
            costoAdquisicion: 1_200_000,
            valorResidual: 0,
            vidaUtilMeses: 12,
            fechaAlta: new Date('2026-01-01'),
          },
        ]),
      );

      const svc = new CostPeriodService(db as never);
      await svc.close(USER, 'per-x', null, ctx);

      const snap = (db.costPeriod.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data
        .resultSnapshot;
      expect(snap.assetDepreciation).toBe(0);
    });

    it('sin activos amortizables, da cero y el costo no cambia (DOM-05)', async () => {
      const db = makeDb();
      db.costPeriod.findFirst = vi.fn(async () => ({ ...junio, status: 'OPEN' }));

      const svc = new CostPeriodService(db as never);
      await svc.close(USER, 'per-x', null, ctx);

      const snap = (db.costPeriod.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data
        .resultSnapshot;
      expect(snap.assetDepreciation).toBe(0);
    });
  });
});

describe('REABRIR período', () => {
  it('exige un motivo de verdad (no sirve "porque sí")', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => junio);

    const svc = new CostPeriodService(db as never);
    await expect(svc.reopen(USER, 'per-junio', 'ups', ctx)).rejects.toThrow(ValidationError);
    expect(db.costPeriod.update).not.toHaveBeenCalled();
  });

  it('reabre y deja rastro: motivo, fecha y contador', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => junio);
    db.costPeriod.update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'per-junio',
      ...data,
      reopenCount: 1,
    }));

    const svc = new CostPeriodService(db as never);
    const r = await svc.reopen(USER, 'per-junio', 'Llegó tarde la factura de energía de junio', ctx);

    expect(r.status).toBe('OPEN');
    expect(r.reopenReason).toBe('Llegó tarde la factura de energía de junio');
    expect(r.reopenedAt).toBeInstanceOf(Date);
  });

  it('no se puede reabrir un período que está abierto', async () => {
    const db = makeDb();
    db.costPeriod.findFirst = vi.fn(async () => ({ ...junio, status: 'OPEN' }));

    const svc = new CostPeriodService(db as never);
    await expect(
      svc.reopen(USER, 'per-junio', 'Un motivo suficientemente largo', ctx),
    ).rejects.toThrow(ValidationError);
  });
});
