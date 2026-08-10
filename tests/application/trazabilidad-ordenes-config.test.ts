import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!process.env.DATABASE_URL) {
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

/**
 * T-01 — EL CASO COMPLETO DE ÓRDENES CARGADO POR LOS ENDPOINTS DE CONFIG.
 *
 * La promesa del producto es que todo número se puede abrir hasta su origen. El
 * árbol de derivación se dibujaba entero, pero casi ninguna hoja tenía dato
 * detrás: los `DataPoint` solo nacían cuando el formulario de Materia Prima los
 * posteaba uno por uno, y solo para los movimientos agregados en esa misma
 * sesión de edición. Una estructura cargada por la API, por Excel o por la
 * ingesta de comprobantes quedaba con el árbol completo y NADA clickeable.
 *
 * Esta prueba carga un caso completo SIN pasar por el formulario de MP —solo
 * `updateConfig` / `updateSales`, que es lo que hacen la API, el importador y el
 * poblador automático— y exige que las hojas de MP, MOD, CIP y Venta lleguen al
 * árbol con su `sourceDpVersionIds`.
 *
 * Corre contra Postgres real (el árbol y la reconciliación son escrituras
 * transaccionales; mockearlas probaría el mock). Sin `DATABASE_URL`, se saltea.
 */

const HAY_BASE = Boolean(process.env.DATABASE_URL);
const suite = HAY_BASE ? describe : describe.skip;

const USER = 'ee000000-0000-4000-8000-000000000001';
const COMPANY = 'ee000000-0000-4000-8000-000000000002';
const STRUCTURE = 'ee000000-0000-4000-8000-000000000003';
/** Estructura con MP ya cargada "de antes", sin un solo data point (huérfana). */
const HUERFANA = 'ee000000-0000-4000-8000-000000000004';
const PERIOD = '2026-08';

const ctx = { ipAddress: '127.0.0.1', userAgent: 'vitest' };
const actor = { id: USER, role: 'COSTISTA', area: 'costista', device: 'vitest' };

/** Materia prima con existencia inicial, Wilson y dos movimientos del período. */
const configMP = {
  materials: [
    {
      id: 'chapa',
      code: 'CH-18',
      name: 'Chapa BWG 18',
      unit: 'kg',
      wilson: { annualDemand: 6000, orderCost: 500, holdingRate: 0.3, unitCost: 1200 },
      stockPolicy: {
        minConsumption: 10,
        maxConsumption: 30,
        minLeadTime: 5,
        maxLeadTime: 10,
        safetyStock: 50,
      },
      initialStock: { quantity: 300, unitCost: 1160 },
      movements: [
        { date: '2026-08-05', type: 'purchase', detail: 'Factura A-0001', quantity: 200, unitCost: 1300 },
        { date: '2026-08-20', type: 'consumption', detail: 'Vale 77', quantity: 350 },
      ],
    },
  ],
};

/** DOS departamentos a propósito: "Remuneración básica" se repite en el árbol. */
const configMOD = {
  workingDays: {
    totalDaysPerYear: 365,
    unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 3, holidaysOnWeekend: 4 },
    paidAbsence: { holidays: 12, vacations: 14, sickness: 5, specialLeaves: 2, workAccidents: 1 },
  },
  itcs: {
    derivationBase: 0.27,
    fixedArt: 0.015,
    uncertainRemunerative: [{ name: 'Vacaciones', coefficient: 0.06 }],
    uncertainNonRemunerative: [{ name: 'Ropa de trabajo', coefficient: 0.01 }],
  },
  departments: [
    { name: 'Corte', basicRemuneration: 900000, hoursWorked: 1600 },
    { name: 'Armado', basicRemuneration: 750000, hoursWorked: 1400 },
  ],
};

/** DOS centros productivos: "CIP real" también se repite en el árbol. */
const configCIP = {
  centers: [
    { id: 'prod1', name: 'Corte', type: 'productive' },
    { id: 'prod2', name: 'Armado', type: 'productive' },
  ],
  concepts: [
    {
      name: 'Alquiler',
      amount: { fixed: 200000, variable: 0 },
      distribution: { prod1: 0.6, prod2: 0.4 },
    },
    {
      name: 'Energía',
      amount: { fixed: 40000, variable: 160000 },
      distribution: { prod1: 0.5, prod2: 0.5 },
    },
  ],
  serviceDistributions: [],
  productiveSettings: [
    { centerId: 'prod1', normalCapacity: 1600, actualActivity: 1500, actualCip: 250000 },
    { centerId: 'prod2', normalCapacity: 1400, actualActivity: 1350, actualCip: 160000 },
  ],
};

interface Nodo {
  label: string;
  sourceDpVersionIds: string[];
  children: Nodo[];
}

/** Aplana el árbol anotando la etiqueta del padre (hay hojas homónimas). */
function aplanar(nodes: Nodo[], padre = ''): { padre: string; label: string; origen: string[] }[] {
  return nodes.flatMap((n) => [
    { padre, label: n.label, origen: n.sourceDpVersionIds },
    ...aplanar(n.children, n.label),
  ]);
}

suite('T-01 — un caso completo cargado por los endpoints de config deja trazable el árbol', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = new PrismaClient();
    await limpiar(db);
    const sql = [
      `INSERT INTO users (id, email, "passwordHash", name, "updatedAt")
         VALUES ('${USER}', 'traza-ordenes@costear.test', 'x', 'Costista', now())`,
      `INSERT INTO companies (id, "userId", name, "updatedAt")
         VALUES ('${COMPANY}', '${USER}', 'Metalúrgica del Sur', now())`,
      `INSERT INTO cost_structures (id, "companyId", "userId", "productName", period, "costingSystem", "updatedAt")
         VALUES ('${STRUCTURE}', '${COMPANY}', '${USER}', 'Portón corredizo', '${PERIOD}', 'ORDERS', now())`,
      // Escritura DIRECTA del JSON, como la hacen el poblador automático de
      // documentos y las importaciones por API: la sección queda cargada y sin
      // ningún dato trazable detrás. Es el huérfano que hay que reparar.
      `INSERT INTO cost_structures (id, "companyId", "userId", "productName", period, "costingSystem", "rawMaterialConfig", "updatedAt")
         VALUES ('${HUERFANA}', '${COMPANY}', '${USER}', 'Reja simple', '${PERIOD}', 'ORDERS', '${JSON.stringify(configMP)}'::jsonb, now())`,
    ];
    for (const s of sql) await db.$executeRawUnsafe(s);
  });

  afterAll(async () => {
    if (!db) return;
    await limpiar(db);
    await db.$disconnect();
  });

  it('las hojas de MP, MOD, CIP y Venta llegan al árbol con su dato de origen', async () => {
    const { CostStructureService } = await import(
      '@/application/cost-structures/cost-structure-service.js'
    );
    const { CalculationRunService } = await import(
      '@/application/cost-structures/calculation-run-service.js'
    );
    const svc = new CostStructureService(db);

    // NADA de esto pasa por el formulario de Materia Prima: son exactamente los
    // mismos llamados que hacen la API, el importador de Excel y el poblador.
    await svc.updateConfig(USER, STRUCTURE, 'rawMaterial', configMP, ctx);
    await svc.updateConfig(USER, STRUCTURE, 'directLabor', configMOD, ctx);
    await svc.updateConfig(USER, STRUCTURE, 'indirectCosts', configCIP, ctx);
    await svc.updateSales(USER, STRUCTURE, 5000, 800, ctx, 1000);

    const runs = new CalculationRunService(db);
    const { run } = await runs.calculate(USER, STRUCTURE, actor);
    const { tree } = (await runs.getTree(USER, run.id)) as { tree: Nodo[] };
    const hojas = aplanar(tree);

    const buscar = (padre: string, label: string) =>
      hojas.find((h) => h.padre === padre && h.label === label);

    // MP: el movimiento de compra, con su cantidad y su precio detrás.
    const compra = buscar('Materia Prima Consumida', 'Compra — Factura A-0001');
    expect(compra, 'falta la hoja de la compra en el árbol').toBeDefined();
    expect(compra!.origen.length).toBeGreaterThan(0);

    const consumo = buscar('Materia Prima Consumida', 'Consumo — Vale 77');
    expect(consumo!.origen.length).toBeGreaterThan(0);

    // MOD: "Remuneración básica" existe una vez por departamento. Las DOS tienen
    // que resolver, y a data points DISTINTOS (si resolvieran al mismo, el
    // drill-down de Armado mostraría el sueldo de Corte).
    const corte = buscar('Corte', 'Remuneración básica');
    const armado = buscar('Armado', 'Remuneración básica');
    expect(corte!.origen.length).toBeGreaterThan(0);
    expect(armado!.origen.length).toBeGreaterThan(0);
    expect(corte!.origen[0]).not.toBe(armado!.origen[0]);

    // CIP: "CIP real" existe una vez por centro. Mismo criterio.
    // T-09: el nodo del centro se rotula con su NOMBRE ('Corte'/'Armado'), no
    // con su id interno ('prod1'/'prod2'), que no le dice nada al costista.
    const cip1 = buscar('Corte', 'CIP real');
    const cip2 = buscar('Armado', 'CIP real');
    expect(cip1!.origen.length).toBeGreaterThan(0);
    expect(cip2!.origen.length).toBeGreaterThan(0);
    expect(cip1!.origen[0]).not.toBe(cip2!.origen[0]);

    // Venta.
    expect(buscar('Ingreso', 'Precio unitario')!.origen.length).toBeGreaterThan(0);
    expect(buscar('Ingreso', 'Cantidad')!.origen.length).toBeGreaterThan(0);

    // Y los insumos que todavía no tienen hoja propia en el árbol existen igual
    // como dato trazable (Wilson, existencia inicial, ITCS, capacidad normal).
    const claves = await db.dataPoint.findMany({
      where: { structureId: STRUCTURE, voidedAt: null },
      select: { fieldKey: true },
    });
    const set = new Set(claves.map((c) => c.fieldKey));
    for (const esperada of [
      'mp.chapa.wilson.demanda_anual',
      'mp.chapa.existencia_inicial.cantidad',
      'mod.itcs.base_derivacion',
      'mod.itcs.incierta_remunerativa.Vacaciones',
      'mod.dpto.Armado.horas',
      'cip.concepto.Energía.importe.variable',
      'cip.centro.prod2.capacidad_normal',
      'venta.cantidad_producida',
    ]) {
      expect(set.has(esperada), `falta el dato trazable «${esperada}»`).toBe(true);
    }
  });

  it('guardar la misma sección dos veces no crea versiones nuevas (idempotente)', async () => {
    const { CostStructureService } = await import(
      '@/application/cost-structures/cost-structure-service.js'
    );
    const svc = new CostStructureService(db);

    const antes = await db.dataPointVersion.count({
      where: { dataPoint: { structureId: STRUCTURE } },
    });
    const puntosAntes = await db.dataPoint.count({ where: { structureId: STRUCTURE } });

    await svc.updateConfig(USER, STRUCTURE, 'rawMaterial', configMP, ctx);
    await svc.updateConfig(USER, STRUCTURE, 'directLabor', configMOD, ctx);
    await svc.updateConfig(USER, STRUCTURE, 'indirectCosts', configCIP, ctx);
    await svc.updateSales(USER, STRUCTURE, 5000, 800, ctx, 1000);

    const despues = await db.dataPointVersion.count({
      where: { dataPoint: { structureId: STRUCTURE } },
    });
    const puntosDespues = await db.dataPoint.count({ where: { structureId: STRUCTURE } });

    expect(despues).toBe(antes);
    expect(puntosDespues).toBe(puntosAntes);
  });

  it('corregir un valor agrega una VERSIÓN al mismo dato, no un dato nuevo', async () => {
    const { CostStructureService } = await import(
      '@/application/cost-structures/cost-structure-service.js'
    );
    const svc = new CostStructureService(db);

    const antes = await db.dataPoint.findFirstOrThrow({
      where: { structureId: STRUCTURE, fieldKey: 'mod.dpto.Corte.remuneracion' },
      include: { versions: true },
    });

    const corregido = {
      ...configMOD,
      departments: [
        { name: 'Corte', basicRemuneration: 950000, hoursWorked: 1600 },
        configMOD.departments[1]!,
      ],
    };
    await svc.updateConfig(USER, STRUCTURE, 'directLabor', corregido, ctx);

    const despues = await db.dataPoint.findFirstOrThrow({
      where: { structureId: STRUCTURE, fieldKey: 'mod.dpto.Corte.remuneracion' },
      include: { versions: { orderBy: { versionN: 'desc' } } },
    });

    expect(despues.id).toBe(antes.id);
    expect(despues.versions.length).toBe(antes.versions.length + 1);
    expect(Number(despues.versions[0]!.valueNum)).toBe(950000);

    // Y la versión anterior sigue intacta (append-only, R1).
    expect(Number(despues.versions[1]!.valueNum)).toBe(900000);

    // Restaurar para no dejar la estructura con el valor corregido.
    await svc.updateConfig(USER, STRUCTURE, 'directLabor', configMOD, ctx);
  });

  it('repara los datos pre-trazabilidad al guardar, sin inventarles autor', async () => {
    const { CostStructureService } = await import(
      '@/application/cost-structures/cost-structure-service.js'
    );
    const svc = new CostStructureService(db);

    // Punto de partida: la sección está cargada y no hay NADA trazable.
    expect(await db.dataPoint.count({ where: { structureId: HUERFANA } })).toBe(0);

    // El costista abre la sección y aprieta Guardar sin tocar nada. Antes de
    // T-01 esto no reparaba nada: los data points seguían en cero.
    await svc.updateConfig(USER, HUERFANA, 'rawMaterial', configMP, ctx);

    const puntos = await db.dataPoint.findMany({
      where: { structureId: HUERFANA },
      include: { versions: true },
    });
    expect(puntos.length).toBeGreaterThan(0);

    // Ninguno se le atribuye a quien apretó Guardar hoy (§6 del manual).
    for (const p of puntos) {
      const v = p.versions[0]!;
      expect(v.reason).toBe('migración: dato pre-trazabilidad');
      expect(v.actorRole).toBe('desconocido (migrado)');
      expect(v.method).toBe('manual');
    }

    // Y un cambio POSTERIOR sí lleva el autor real: la reparación no contamina
    // lo que se carga de verdad después.
    const cambiado = {
      materials: [{ ...configMP.materials[0]!, initialStock: { quantity: 310, unitCost: 1160 } }],
    };
    await svc.updateConfig(USER, HUERFANA, 'rawMaterial', cambiado, ctx);

    const existencia = await db.dataPoint.findFirstOrThrow({
      where: { structureId: HUERFANA, fieldKey: 'mp.chapa.existencia_inicial.cantidad' },
      include: { versions: { orderBy: { versionN: 'desc' } } },
    });
    expect(existencia.versions.length).toBe(2);
    expect(existencia.versions[0]!.actorRole).toBe('COSTISTA');
    expect(existencia.versions[0]!.reason).toBe('Carga de la sección Materia Prima');
  });

  it('un insumo que desaparece de la sección se ANULA, nunca se borra', async () => {
    const { CostStructureService } = await import(
      '@/application/cost-structures/cost-structure-service.js'
    );
    const svc = new CostStructureService(db);

    const antes = await db.dataPoint.count({ where: { structureId: HUERFANA } });

    // Se borra el consumo de la planilla.
    const sinConsumo = {
      materials: [
        {
          ...configMP.materials[0]!,
          initialStock: { quantity: 310, unitCost: 1160 },
          movements: [configMP.materials[0]!.movements[0]!],
        },
      ],
    };
    await svc.updateConfig(USER, HUERFANA, 'rawMaterial', sinConsumo, ctx);

    const consumo = await db.dataPoint.findFirstOrThrow({
      where: { structureId: HUERFANA, label: 'Consumo — Vale 77' },
    });
    expect(consumo.voidedAt).not.toBeNull();
    expect(consumo.status).toBe('anulado');
    // Sigue existiendo: R1, nunca DELETE.
    expect(await db.dataPoint.count({ where: { structureId: HUERFANA } })).toBe(antes);
  });
});

/**
 * Borra todo lo sembrado por esta prueba, en orden inverso de dependencias.
 *
 * Las tablas de histórico (`data_point_versions`, `trace_audit_log`) son
 * append-only por trigger: el DELETE solo se permite dentro de una PURGA
 * explícita (`app.purge_mode`), que es justamente el mecanismo previsto para
 * borrar de verdad. Todo en UNA transacción, porque `SET LOCAL` muere con ella.
 */
async function limpiar(db: PrismaClient): Promise<void> {
  // Se limpia por USUARIO, no por la constante STRUCTURE.
  //
  // El test crea más de una estructura (la del caso completo y la de datos
  // pre-trazabilidad), y borrar solo STRUCTURE dejaba huérfana a la otra: al
  // llegar al DELETE de companies, el cascade chocaba contra sus data_points y
  // toda la limpieza fallaba con
  //   `violates foreign key constraint "data_points_structureId_fkey"`.
  // Peor: el error tapaba el resultado real de los tests, que estaban en verde.
  const DE_ESTE_USER = `SELECT id FROM cost_structures WHERE "userId" = '${USER}'`;
  const sql = [
    `DELETE FROM calculation_nodes WHERE "runId" IN (SELECT id FROM calculation_runs WHERE "structureId" IN (${DE_ESTE_USER}))`,
    `DELETE FROM calculation_runs WHERE "structureId" IN (${DE_ESTE_USER})`,
    `DELETE FROM trace_audit_log WHERE "actorId" = '${USER}'`,
    `DELETE FROM late_data_decisions WHERE "dataPointId" IN (SELECT id FROM data_points WHERE "structureId" IN (${DE_ESTE_USER}))`,
    `DELETE FROM data_point_versions WHERE "dataPointId" IN (SELECT id FROM data_points WHERE "structureId" IN (${DE_ESTE_USER}))`,
    `DELETE FROM data_points WHERE "structureId" IN (${DE_ESTE_USER})`,
    `DELETE FROM cost_config_versions WHERE "structureId" IN (${DE_ESTE_USER})`,
    `DELETE FROM allocation_base_values WHERE "structureId" IN (${DE_ESTE_USER})`,
    `DELETE FROM allocation_bases WHERE "companyId" = '${COMPANY}'`,
    `DELETE FROM cost_calculations WHERE "costStructureId" IN (${DE_ESTE_USER})`,
    `DELETE FROM cost_periods WHERE "structureId" IN (${DE_ESTE_USER})`,
    `DELETE FROM audit_logs WHERE "userId" = '${USER}'`,
    `DELETE FROM cost_structures WHERE "userId" = '${USER}'`,
    `DELETE FROM companies WHERE id = '${COMPANY}'`,
    `DELETE FROM users WHERE id = '${USER}'`,
  ];
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.purge_mode', 'on', true)`);
    for (const s of sql) await tx.$executeRawUnsafe(s);
  });
}
