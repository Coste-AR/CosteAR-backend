import { describe, it, expect, beforeAll, afterAll, type TestContext } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Prueba de fuego del aislamiento multi-tenant: con el contexto puesto en el
 * inquilino A, ¿la base devuelve ALGUNA fila del inquilino B?
 *
 * Por qué existe: hasta agosto de 2026 el aislamiento dependía enteramente de
 * que cada servicio se acordara del `where userId`. Las políticas RLS estaban
 * escritas pero eran inertes, porque el rol de la app es SUPERUSER (implica
 * BYPASSRLS) y Postgres ni siquiera las evalúa. Un test que corriera con ese
 * rol y viera cero filas ajenas estaría midiendo el `where` de la query, no la
 * política — y daría verde exactamente igual con la base sin políticas.
 *
 * Por eso este archivo se NIEGA a dar verde con un rol que saltea RLS: o corre
 * contra un rol sin BYPASSRLS, o se saltea GRITANDO. Un test de aislamiento
 * que pasa en silencio es peor que no tener test: da una garantía falsa.
 *
 * Cómo correrlo de verdad (Postgres local):
 *
 *   CREATE ROLE costear_rls_probe LOGIN PASSWORD 'probe' NOSUPERUSER NOBYPASSRLS;
 *   GRANT USAGE ON SCHEMA public TO costear_rls_probe;
 *   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO costear_rls_probe;
 *
 *   RLS_PROBE_DATABASE_URL=postgresql://costear_rls_probe:probe@localhost:5433/costear \
 *     npx vitest run tests/security/rls-cross-tenant.test.ts
 *
 * En un CI que ya tenga ese rol, `RLS_REQUIRE_PROBE=1` convierte el skip en
 * fallo: sirve para que el día que el rol desaparezca, se entere alguien.
 */

if (!process.env.DATABASE_URL) {
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

const ADMIN_URL = process.env.DATABASE_URL;
const PROBE_URL = process.env.RLS_PROBE_DATABASE_URL ?? ADMIN_URL;
const EXIGIR_PROBE = process.env.RLS_REQUIRE_PROBE === '1';

/** Tablas protegidas y la columna por la que se identifica cada fila sembrada. */
const TABLAS_PROTEGIDAS = [
  'companies',
  'cost_structures',
  'cost_periods',
  'cost_calculations',
  'alerts',
  'alert_settings',
  'data_points',
  'data_point_versions',
  // T-04: desde que los comprobantes tienen alta y dueño (`uploadedBy`), esta
  // tabla dejó de estar exenta. Guarda las facturas de los clientes: es la
  // última tabla que uno querría sin aislamiento.
  'evidence',
  'calculation_runs',
  'calculation_nodes',
  'process_departments',
  'unit_movement_schedules',
  'joint_cost_allocations',
  'joint_cost_by_product_lines',
  'cost_ledger_entries',
  'allocation_bases',
  'allocation_base_values',
  'cost_config_versions',
  'classification_audits',
  'company_target_budgets',
  'empresa_connections',
  'processed_caes',
  'supplier_fingerprints',
  'late_data_decisions',
  'vault_chat_sessions',
  'vault_chat_messages',
  'validation_history',
  'audit_logs',
] as const;

type Tabla = (typeof TABLAS_PROTEGIDAS)[number];

/** ids fijos y reconocibles: si algo queda colgado, se ve de lejos en la base. */
function ids(tag: 'a' | 'b'): Record<Tabla | 'user' | 'dataEntry', string> {
  const h = tag.repeat(8);
  const u = (n: number) => `${h}-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    user: u(1),
    companies: u(2),
    cost_structures: u(3),
    cost_periods: u(4),
    cost_calculations: u(5),
    alerts: u(6),
    alert_settings: u(7),
    data_points: u(8),
    data_point_versions: u(9),
    calculation_runs: u(10),
    calculation_nodes: u(11),
    process_departments: u(12),
    unit_movement_schedules: u(13),
    joint_cost_allocations: u(14),
    joint_cost_by_product_lines: u(15),
    cost_ledger_entries: u(16),
    allocation_bases: u(17),
    allocation_base_values: u(18),
    cost_config_versions: u(19),
    classification_audits: u(20),
    company_target_budgets: u(21),
    empresa_connections: u(22),
    processed_caes: u(23),
    supplier_fingerprints: u(24),
    late_data_decisions: u(25),
    vault_chat_sessions: u(26),
    vault_chat_messages: u(27),
    validation_history: u(28),
    audit_logs: u(29),
    dataEntry: u(30),
    evidence: u(31),
  };
}

const A = ids('a');
const B = ids('b');
/** Base "del sistema" (companyId NULL): tiene que verla todo el mundo. */
const BASE_SISTEMA = 'cccccccc-0000-4000-8000-000000000001';

/** Orden inverso de dependencias para limpiar sin pelearse con las FKs. */
const ORDEN_BORRADO: string[] = [
  'audit_logs',
  'validation_history',
  'vault_chat_messages',
  'vault_chat_sessions',
  'late_data_decisions',
  'supplier_fingerprints',
  'processed_caes',
  'classification_audits',
  'cost_config_versions',
  'allocation_base_values',
  'allocation_bases',
  'cost_ledger_entries',
  'joint_cost_by_product_lines',
  'joint_cost_allocations',
  'unit_movement_schedules',
  'process_departments',
  'calculation_nodes',
  'calculation_runs',
  'data_point_versions',
  'evidence', // después de las versiones: son las que la referencian
  'data_points',
  'cost_calculations',
  'alert_settings',
  'alerts',
  'company_target_budgets',
  'cost_periods',
  'cost_structures',
  'data_entries',
  'empresa_connections',
  'companies',
];

async function sembrar(db: PrismaClient, t: ReturnType<typeof ids>, tag: string): Promise<void> {
  // SQL crudo a propósito: el objetivo es probar la BASE, no el mapeo de
  // Prisma. Corre con el rol de la app (superusuario acá), que puede insertar
  // sin contexto de tenant. Statement por statement: Prisma los manda como
  // prepared statements y no acepta varios comandos en una sola llamada.
  const sql = `
    INSERT INTO users (id, email, "passwordHash", name, "updatedAt")
      VALUES ('${t.user}', 'rls-probe-${tag}@costear.test', 'x', 'Probe ${tag}', now());
    INSERT INTO companies (id, "userId", name, "updatedAt")
      VALUES ('${t.companies}', '${t.user}', 'Empresa ${tag}', now());
    INSERT INTO cost_structures (id, "companyId", "userId", "productName", period, "updatedAt")
      VALUES ('${t.cost_structures}', '${t.companies}', '${t.user}', 'Producto ${tag}', '2026-08', now());
    INSERT INTO cost_periods (id, "structureId", "companyId", "userId", code, label, "startDate", "endDate", "updatedAt")
      VALUES ('${t.cost_periods}', '${t.cost_structures}', '${t.companies}', '${t.user}', '2026-08', 'Agosto 2026', '2026-08-01', '2026-08-31', now());
    INSERT INTO cost_calculations (id, "costStructureId", "userId", "rawMaterialConsumed", "directLaborTotal", "indirectCostsApplied", "productionCost", "costOfGoodsSold", "grossMargin", "grossMarginPct", detail)
      VALUES ('${t.cost_calculations}', '${t.cost_structures}', '${t.user}', 1, 1, 1, 3, 3, 1, 10, '{}'::jsonb);
    INSERT INTO alerts (id, "userId", type, message)
      VALUES ('${t.alerts}', '${t.user}', 'MARGIN_BELOW_THRESHOLD', 'alerta ${tag}');
    INSERT INTO alert_settings (id, "userId", "updatedAt")
      VALUES ('${t.alert_settings}', '${t.user}', now());
    INSERT INTO data_points (id, "structureId", element, "fieldKey", label, "sourceArea")
      VALUES ('${t.data_points}', '${t.cost_structures}', 'MP', 'mp.compra.precio', 'Compra ${tag}', 'costista');
    INSERT INTO evidence (id, kind, reference, counterparty, "uploadedBy")
      VALUES ('${t.evidence}', 'factura', 'Factura A 0001-0000000${tag === 'a' ? 1 : 2}', 'Proveedor ${tag}', '${t.user}');
    INSERT INTO data_point_versions (id, "dataPointId", "versionN", method, "createdBy", "actorRole", "actorArea", "evidenceId")
      VALUES ('${t.data_point_versions}', '${t.data_points}', 1, 'manual', '${t.user}', 'COSTISTA', 'costista', '${t.evidence}');
    INSERT INTO calculation_runs (id, "structureId", "runN", "engineVersion", "executedBy", "inputsSnapshot", results)
      VALUES ('${t.calculation_runs}', '${t.cost_structures}', 1, 'test', '${t.user}', '{}'::jsonb, '{}'::jsonb);
    INSERT INTO calculation_nodes (id, "runId", ord, label)
      VALUES ('${t.calculation_nodes}', '${t.calculation_runs}', 1, 'nodo ${tag}');
    INSERT INTO process_departments (id, "structureId", name, sequence, "updatedAt")
      VALUES ('${t.process_departments}', '${t.cost_structures}', 'Depto ${tag}', 1, now());
    INSERT INTO unit_movement_schedules (id, "departmentId", "periodId", "updatedAt")
      VALUES ('${t.unit_movement_schedules}', '${t.process_departments}', '${t.cost_periods}', now());
    INSERT INTO joint_cost_allocations (id, "structureId", "departmentId", "periodId", method, "jointCostTotal")
      VALUES ('${t.joint_cost_allocations}', '${t.cost_structures}', '${t.process_departments}', '${t.cost_periods}', 'PHYSICAL_UNITS', 100);
    INSERT INTO joint_cost_by_product_lines (id, "allocationId", "productName", kind, "unitsObtained")
      VALUES ('${t.joint_cost_by_product_lines}', '${t.joint_cost_allocations}', 'Coproducto ${tag}', 'coproduct', 10);
    INSERT INTO cost_ledger_entries (id, "companyId", "costistId", period, "costSection", "documentType", description, amount)
      VALUES ('${t.cost_ledger_entries}', '${t.companies}', '${t.user}', '2026-08', 'MATERIA_PRIMA', 'FACTURA_COMPRA', 'compra ${tag}', 500);
    INSERT INTO allocation_bases (id, "companyId", code, name, unit)
      VALUES ('${t.allocation_bases}', '${t.companies}', 'base_${tag}', 'Base ${tag}', 'm2');
    INSERT INTO allocation_base_values (id, "baseId", "structureId", "centerId", value)
      VALUES ('${t.allocation_base_values}', '${t.allocation_bases}', '${t.cost_structures}', 'centro-1', 42);
    INSERT INTO cost_config_versions (id, "structureId", section, "versionN", value)
      VALUES ('${t.cost_config_versions}', '${t.cost_structures}', 'rawMaterial', 1, '{}'::jsonb);
    INSERT INTO empresa_connections (id, "companyId", "costistId", "apiKey", "updatedAt")
      VALUES ('${t.empresa_connections}', '${t.companies}', '${t.user}', 'apikey-${tag}', now());
    INSERT INTO data_entries (id, "connectionId", "costistId", "rawContent", "updatedAt")
      VALUES ('${t.dataEntry}', '${t.empresa_connections}', '${t.user}', 'documento ${tag}', now());
    INSERT INTO classification_audits (id, "dataEntryId", "companyId", "costistId", "qualityGate", "corroboratingSignals", "documentType", "costSection", confidence)
      VALUES ('${t.classification_audits}', '${t.dataEntry}', '${t.companies}', '${t.user}', 'PASS', '[]'::jsonb, 'FACTURA_COMPRA', 'MATERIA_PRIMA', 90);
    INSERT INTO processed_caes (id, cae, "dataEntryId", "companyId")
      VALUES ('${t.processed_caes}', 'cae-${tag}', '${t.dataEntry}', '${t.companies}');
    INSERT INTO validation_history (id, "entryId", "costistId", "fromStatus", "toStatus")
      VALUES ('${t.validation_history}', '${t.dataEntry}', '${t.user}', 'PENDING', 'APPROVED');
    INSERT INTO company_target_budgets (id, "companyId", "updatedAt")
      VALUES ('${t.company_target_budgets}', '${t.companies}', now());
    INSERT INTO supplier_fingerprints (id, "costistId", "companyId", "supplierCuit", "documentType", "costSection", "updatedAt")
      VALUES ('${t.supplier_fingerprints}', '${t.user}', '${t.companies}', '2030000000${tag === 'a' ? 1 : 2}', 'FACTURA_COMPRA', 'MATERIA_PRIMA', now());
    INSERT INTO late_data_decisions (id, "dataPointId", "structureId", "userId", "targetPeriodCode", "policyAtDetection")
      VALUES ('${t.late_data_decisions}', '${t.data_points}', '${t.cost_structures}', '${t.user}', '2026-07', 'ASK');
    INSERT INTO vault_chat_sessions (id, "userId", "updatedAt")
      VALUES ('${t.vault_chat_sessions}', '${t.user}', now());
    INSERT INTO vault_chat_messages (id, "sessionId", role, content)
      VALUES ('${t.vault_chat_messages}', '${t.vault_chat_sessions}', 'USER', 'mensaje ${tag}');
    INSERT INTO audit_logs (id, "userId", action)
      VALUES ('${t.audit_logs}', '${t.user}', 'test.rls.${tag}');
  `;

  for (const stmt of sql.split(';').map((s) => s.trim())) {
    if (stmt) await db.$executeRawUnsafe(stmt);
  }
}

async function limpiar(db: PrismaClient): Promise<void> {
  const todos = [...Object.values(A), ...Object.values(B), BASE_SISTEMA]
    .map((id) => `'${id}'`)
    .join(',');

  // `cost_config_versions` y `data_point_versions` tienen triggers append-only
  // que prohíben DELETE — están para eso. Se apagan SOLO dentro de esta
  // transacción (SET LOCAL vuelve solo al terminar) y solo para borrar los
  // datos de prueba; ninguna tabla queda desprotegida después.
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    for (const tabla of ORDEN_BORRADO) {
      await tx.$executeRawUnsafe(`DELETE FROM ${tabla} WHERE id IN (${todos})`);
    }
    await tx.$executeRawUnsafe(`DELETE FROM users WHERE id IN ('${A.user}','${B.user}')`);
  });
}

let admin: PrismaClient | undefined;
let probe: PrismaClient | undefined;

/** Cuenta filas visibles con el contexto de tenant puesto en `userId`. */
async function visiblesComo(userId: string, tabla: string, id: string): Promise<number> {
  const filas = await probe!.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM ${tabla} WHERE id = '${id}'`,
    );
  });
  return filas[0]?.n ?? 0;
}

function gritar(lineas: string[]): void {
  const ancho = Math.max(...lineas.map((l) => l.length)) + 4;
  const borde = '═'.repeat(ancho);
  console.error(`\n╔${borde}╗`);
  for (const l of lineas) console.error(`║  ${l.padEnd(ancho - 2)}║`);
  console.error(`╚${borde}╝\n`);
}

/**
 * El diagnóstico del entorno corre en la CARGA del módulo, no en un beforeAll:
 * vitest decide qué suites saltear cuando las colecta, así que para poder usar
 * `describe.skipIf` (y que el reporte muestre "skipped" en vez de 28 verdes
 * falsos) hay que saber antes de colectar si hay un rol que respete RLS.
 */
async function diagnosticar(): Promise<string | null> {
  if (!ADMIN_URL) return 'no hay DATABASE_URL: sin base no hay nada que verificar';

  admin = new PrismaClient({ datasourceUrl: ADMIN_URL });
  probe = new PrismaClient({ datasourceUrl: PROBE_URL });

  type Rol = { rolname: string; rolsuper: boolean; rolbypassrls: boolean };
  let rol: Rol | undefined;
  try {
    const filas = await probe.$queryRawUnsafe<Rol[]>(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    rol = filas[0];
  } catch (err) {
    return `no se pudo conectar a la base: ${(err as Error).message.split('\n')[0]}`;
  }

  if (!rol) return 'no se pudo identificar el rol de conexión';

  if (rol.rolsuper || rol.rolbypassrls) {
    return (
      `el rol "${rol.rolname}" saltea RLS ` +
      `(rolsuper=${rol.rolsuper}, rolbypassrls=${rol.rolbypassrls})`
    );
  }
  return null;
}

const motivoSkip = await diagnosticar();
const HAY_ROL_QUE_RESPETA_RLS = motivoSkip === null;

/** Grita el aviso. Se llama una sola vez, al colectar, si no hay rol válido. */
function avisarQueNoSeVerificoNada(): void {
  gritar([
    'AISLAMIENTO ENTRE INQUILINOS: NO VERIFICADO',
    '',
    `Motivo: ${motivoSkip}.`,
    '',
    'Este test NO probó nada. Las políticas RLS pueden estar rotas y este',
    'archivo se vería exactamente igual de verde.',
    '',
    'Para probarlo de verdad, creá un rol que no saltee RLS:',
    "  CREATE ROLE costear_rls_probe LOGIN PASSWORD 'probe' NOSUPERUSER NOBYPASSRLS;",
    '  GRANT USAGE ON SCHEMA public TO costear_rls_probe;',
    '  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO costear_rls_probe;',
    'y corré con RLS_PROBE_DATABASE_URL apuntando a ese rol.',
  ]);
}

if (!HAY_ROL_QUE_RESPETA_RLS) avisarQueNoSeVerificoNada();

// El "centinela": es el único bloque que corre SIEMPRE. Si el entorno no
// permite verificar nada, este test se saltea (nunca pasa en verde) y, con
// RLS_REQUIRE_PROBE=1, directamente falla.
describe('RLS: ¿este entorno puede verificar el aislamiento?', () => {
  it('hay un rol de conexión que NO saltea RLS', (ctx: TestContext) => {
    if (!HAY_ROL_QUE_RESPETA_RLS) {
      if (EXIGIR_PROBE) {
        throw new Error(
          `RLS_REQUIRE_PROBE=1 y el aislamiento no se pudo verificar: ${motivoSkip}. ` +
            'No se permite saltear este test en este entorno.',
        );
      }
      ctx.skip();
      return;
    }
    expect(motivoSkip).toBeNull();
  });
});

describe.skipIf(!HAY_ROL_QUE_RESPETA_RLS)('RLS: un inquilino no ve datos del otro', () => {
  beforeAll(async () => {
    await limpiar(admin!);
    await sembrar(admin!, A, 'a');
    await sembrar(admin!, B, 'b');
    await admin!.$executeRawUnsafe(
      `INSERT INTO allocation_bases (id, "companyId", code, name, unit, "isSystem")
         VALUES ('${BASE_SISTEMA}', NULL, 'base_sistema_probe', 'Base del sistema', 'm2', true)`,
    );
  }, 60_000);

  afterAll(async () => {
    await limpiar(admin!);
  });

  it.each(TABLAS_PROTEGIDAS)('%s: el inquilino A no ve la fila del inquilino B', async (tabla) => {
    const ajenas = await visiblesComo(A.user, tabla, B[tabla]);
    expect(ajenas, `${tabla}: A vio ${ajenas} fila(s) de B`).toBe(0);

    // Contracara imprescindible: una política `USING (false)` también daría
    // cero filas ajenas y sería inútil. Si A no ve ni lo suyo, el test tiene
    // que romperse igual.
    const propias = await visiblesComo(A.user, tabla, A[tabla]);
    expect(propias, `${tabla}: A no ve ni su propia fila`).toBe(1);
  });

  it('sin contexto de tenant no se ve NADA de ningún inquilino', async () => {
    // `current_app_user_id()` devuelve NULL y `columna = NULL` es NULL, no
    // true: el default seguro es no devolver nada. Vale la pena fijarlo,
    // porque es el estado en el que corre cualquier query que se haya
    // olvidado de withTenant().
    const filas = await probe!.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM cost_structures WHERE id IN ('${A.cost_structures}','${B.cost_structures}')`,
    );
    expect(filas[0].n).toBe(0);
  });

  it('la base de prorrateo DEL SISTEMA sí la ven todos', async () => {
    // allocation_bases mezcla catálogo compartido (companyId NULL) con bases
    // propias. Si la política se pasa de estricta, el prorrateo se queda sin
    // sus bases precargadas y nadie lo nota hasta que un cálculo da distinto.
    expect(await visiblesComo(A.user, 'allocation_bases', BASE_SISTEMA)).toBe(1);
    expect(await visiblesComo(B.user, 'allocation_bases', BASE_SISTEMA)).toBe(1);
  });

  it('audit_logs es append-only: se puede insertar, no modificar ni borrar', async () => {
    // El log de auditoría se escribe muchas veces SIN tenant (login fallido de
    // un email que no existe, jobs, webhooks): eso tiene que seguir andando.
    await expect(
      probe!.$executeRawUnsafe(
        `INSERT INTO audit_logs (id, "userId", action) VALUES (gen_random_uuid(), NULL, 'test.rls.sin-tenant')`,
      ),
    ).resolves.toBeGreaterThan(0);

    // Y sin políticas de UPDATE/DELETE, la bitácora no se puede reescribir:
    // cero filas afectadas, aunque la fila exista.
    const tocadas = await probe!.$executeRawUnsafe(
      `UPDATE audit_logs SET action = 'adulterado' WHERE action = 'test.rls.sin-tenant'`,
    );
    expect(tocadas).toBe(0);

    const borradas = await probe!.$executeRawUnsafe(
      `DELETE FROM audit_logs WHERE action = 'test.rls.sin-tenant'`,
    );
    expect(borradas).toBe(0);

    await admin!.$executeRawUnsafe(`DELETE FROM audit_logs WHERE action = 'test.rls.sin-tenant'`);
  });

  it('el inquilino A no puede ESCRIBIR una fila a nombre de B', async () => {
    // El WITH CHECK es la otra mitad del aislamiento: sin él, A podría
    // plantarle datos a B (o esconderle los suyos moviéndolos de dueño).
    await expect(
      probe!.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${A.user}, true)`;
        return tx.$executeRawUnsafe(
          `INSERT INTO cost_ledger_entries (id, "companyId", "costistId", period, "costSection", "documentType", description, amount)
             VALUES (gen_random_uuid(), '${B.companies}', '${B.user}', '2026-08', 'MATERIA_PRIMA', 'FACTURA_COMPRA', 'inyectada', 1)`,
        );
      }),
    ).rejects.toThrow();
  });
});

// A nivel de archivo: los clientes se crean al colectar, así que hay que
// soltarlos aunque la suite de arriba se haya salteado entera.
afterAll(async () => {
  await admin?.$disconnect();
  await probe?.$disconnect();
});
