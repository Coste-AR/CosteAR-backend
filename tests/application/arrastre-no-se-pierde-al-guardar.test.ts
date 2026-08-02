import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * LA PLATA SIN LAS UNIDADES QUE LA JUSTIFICAN.
 *
 * Escenario real detectado en auditoría: julio deja 2.000 pollos a medio hacer
 * que pasan a agosto con $1.300.000 encima. Al guardar el cuadro de agosto sin
 * mandar la existencia inicial, el sistema:
 *
 *   · reescribía las UNIDADES a 0 (venían del body, y el body no las trae);
 *   · conservaba los IMPORTES (undefined ⇒ Prisma no toca la columna).
 *
 * Quedaban $1.300.000 sin las 2.000 unidades que los justifican, y el costo
 * unitario se inflaba 11% porque el mismo costo se repartía entre menos
 * unidades.
 *
 * Lo peor: el informe seguía CUADRANDO. El error es coherente consigo mismo, así
 * que la verificación de "cuadra / no cuadra" —la garantía que el producto le
 * muestra al costista— no lo detectaba. Alguien que revisara el informe lo daba
 * por bueno.
 *
 * La existencia inicial NO es un dato de este formulario: la escribe el arrastre
 * desde el período anterior. Si el guardado no la trae, se conserva.
 */

const DEPT = 'dept-1';
const PERIOD = 'per-ago';

/** Lo que dejó julio: 2.000 unidades al 100% de MP y 50% de conversión. */
const arrastreDeJulio = {
  initialWip: 2000,
  initialWipMpAvance: 1,
  initialWipConvAvance: 0.5,
};

function makeDb() {
  const guardado: { data?: Record<string, unknown> } = {};
  return {
    guardado,
    costStructure: {
      findFirst: vi.fn(async () => ({ id: 'st-1', productName: 'Pollo', costingSystem: 'PROCESSES' })),
    },
    processDepartment: {
      findFirst: vi.fn(async () => ({
        id: DEPT, name: 'Faena', sequence: 1, defaultConversionAvanceEqualsMO: true,
      })),
    },
    costPeriod: { findFirst: vi.fn(async () => ({ id: PERIOD, structureId: 'st-1', label: 'Agosto' })) },
    unitMovementSchedule: {
      findUnique: vi.fn(async () => arrastreDeJulio),
      upsert: vi.fn(async ({ update }: { update: Record<string, unknown> }) => {
        guardado.data = update;
        return { id: 'ums-1' };
      }),
    },
    traceAuditLog: { create: vi.fn(async () => ({})) },
    operatorMembership: { findFirst: vi.fn(async () => null) },
    // Cada valor cargado a mano se persiste como DataPoint versionado. Acá no se
    // prueba eso, pero el guardado lo hace, así que el doble tiene que aguantarlo.
    dataPoint: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'dp-1' })),
      update: vi.fn(async () => ({ id: 'dp-1' })),
    },
    dataPointVersion: {
      create: vi.fn(async () => ({ id: 'dpv-1' })),
      findFirst: vi.fn(async () => null),
    },
  };
}

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: {},
  withTenant: (_u: string, fn: (tx: unknown) => unknown) => fn(globalThis.__tx),
}));

const actor = { id: 'user-1', role: 'COSTISTA', area: 'planta' };

async function guardar(db: ReturnType<typeof makeDb>, body: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).__tx = db;
  const { UnitMovementService } = await import(
    '@/application/cost-structures/process-costing/unit-movement-service.js'
  );
  const svc = new UnitMovementService(db as never);
  return svc.save('user-1', 'st-1', DEPT, PERIOD, body as never, actor as never);
}

beforeEach(() => vi.clearAllMocks());

describe('El arrastre del período anterior sobrevive a un guardado', () => {
  it('un guardado que NO trae la existencia inicial la conserva', async () => {
    const db = makeDb();

    // El formulario del mes manda lo suyo: puestas, transferidas, EF. La
    // existencia inicial no la toca porque no es suya.
    await guardar(db, {
      startedInProduction: 8000,
      transferredOut: 9000,
      finalWip: 1000,
      finalWipMpAvance: 1,
      finalWipConvAvance: 0.5,
    });

    // Sin el arreglo, acá había 0: la plata quedaba sin las unidades.
    expect(db.guardado.data!.initialWip).toBe(2000);
  });

  it('conserva también los grados de avance con los que venía', async () => {
    const db = makeDb();

    await guardar(db, {
      startedInProduction: 8000,
      transferredOut: 9000,
      finalWip: 1000,
      finalWipMpAvance: 1,
      finalWipConvAvance: 0.5,
    });

    // Estos se pisaban con null (`body.X ?? null`), que es peor que dejarlos:
    // el motor perdía con qué avance venían esas unidades.
    expect(db.guardado.data!.initialWipMpAvance).toBe(1);
    expect(db.guardado.data!.initialWipConvAvance).toBe(0.5);
  });

  it('si el costista SÍ la manda, gana lo que él escribió', async () => {
    const db = makeDb();

    // Conservar no puede volverse "no se puede corregir nunca": si hay un
    // recuento que dice otra cosa, el dato del costista manda.
    await guardar(db, {
      initialWip: 1800,
      initialWipMpAvance: 0.9,
      startedInProduction: 8000,
      transferredOut: 8800,
      finalWip: 1000,
    });

    expect(db.guardado.data!.initialWip).toBe(1800);
    expect(db.guardado.data!.initialWipMpAvance).toBe(0.9);
  });

  it('sin cuadro previo (primer período) la existencia inicial es 0, no explota', async () => {
    const db = makeDb();
    db.unitMovementSchedule.findUnique = vi.fn(async () => null);

    await guardar(db, { startedInProduction: 8000, transferredOut: 7000, finalWip: 1000 });

    // En el primer período de una campaña ningún departamento tiene existencia
    // inicial: no falta el dato, no existe.
    expect(db.guardado.data!.initialWip).toBe(0);
  });
});
