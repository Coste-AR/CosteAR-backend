import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * ¿Por qué este chequeo es un TEST ESTÁTICO y no una consulta a pg_policies?
 *
 * Porque el CI (.github/workflows) no levanta Postgres: corre lint, build y
 * `npm run test`, nada más. Un test que consultara la base tendría que
 * saltearse cuando no hay conexión, y un chequeo de aislamiento que se saltea
 * en el único lugar donde todos los cambios pasan obligatoriamente no protege
 * nada — pasa en verde el día que alguien agrega una tabla sin política.
 *
 * Las dos fuentes que compara (prisma/schema.prisma y prisma/rls.sql) son las
 * mismas que definen la realidad: el schema crea las tablas y rls.sql aplica
 * las políticas. Si divergen, divergen ACÁ, sin base de datos de por medio.
 *
 * El complemento con base viva —comprobar que las políticas efectivamente
 * filtran— es tests/security/rls-cross-tenant.test.ts.
 */

/**
 * Tablas SIN política de tenant, a propósito. Cada una con su motivo.
 *
 * Agregar una entrada acá es una decisión consciente que queda escrita; NO
 * poner nada y que el test siga verde es lo que este archivo evita.
 */
const EXENTAS: Record<string, string> = {
  // --- Identidad y autenticación: se usan ANTES de saber quién es el tenant ---
  users:
    'Es la tabla de tenants, no una tabla POR tenant. El login busca por email/CUIT ' +
    'sin contexto: una política por userId haría imposible autenticarse.',
  refresh_tokens:
    'La rotación de sesión busca por hash del token para AVERIGUAR de quién es. ' +
    'Si hiciera falta el tenant para leerla, nunca se podría refrescar una sesión.',
  password_resets:
    'Mismo caso: se busca por hash del token, con el usuario deslogueado por definición.',
  terms_acceptances:
    'Parte del bloque de identidad: se lee junto con el usuario en el login/me, ' +
    'antes de abrir la transacción de tenant. El scoping es por userId en la query.',

  // --- Catálogos y datos compartidos: no pertenecen a ningún tenant ---
  macro_snapshots: 'Datos públicos (BCRA/INDEC/ARCA), iguales para todos los tenants.',
  vault_chunks: 'Conocimiento compartido de la bóveda, no dato de un cliente.',
  vault_edit_proposals: 'Propuestas de edición de la bóveda; se revisan desde el panel admin.',
  system_alerts: 'Alertas de Sentry sobre la app, no sobre un tenant.',
  terms_versions: 'El texto de los T&C es el mismo para todos.',

  // --- Trazabilidad heredada (ya documentado en rls.sql desde Trazabilidad v1) ---
  evidence:
    'Su vínculo con el tenant es indirecto y opcional (puede no tener dueño). ' +
    'El filtro de pertenencia se hace en la capa de aplicación.',
  trace_audit_log:
    'Bitácora append-only de trazabilidad, con entidades de tipos heterogéneos ' +
    '(entityType/entityId genéricos): no hay una sola columna que resuelva el dueño.',

  // --- Doble actor: la fila tiene DOS dueños legítimos ---
  data_entries:
    'La escribe el operario de la empresa (EMPRESA_OPERATOR, cuyo app.user_id NO es ' +
    'el del costista) y la ingesta por apiKey, que no tiene usuario alguno. Un ' +
    'predicado por costistId dejaría afuera al actor que más carga documentos.',
  operator_memberships:
    'Une a un operario con una conexión: la ve el operario Y el costista dueño de la ' +
    'conexión. Con un solo predicado por columna, uno de los dos queda sin acceso.',
  operator_invites:
    'Se lee por CÓDIGO, por alguien que todavía no aceptó la invitación y puede no ' +
    'tener cuenta. Exigir contexto de tenant rompería el alta por invitación.',

  // --- Corpus cross-tenant por diseño ---
  daily_signals:
    'Corpus del pipeline nocturno de aprendizaje: se escribe desde muchos tenants y se ' +
    'lee ENTERO y a propósito por el job nocturno y el panel admin, sin contexto de ' +
    'tenant. Una política de SELECT por userId dejaría al job leyendo cero filas en ' +
    'silencio. No existe ninguna ruta de lectura para un costista (verificado: solo ' +
    'nightly-learning-service y admin.routes leen la tabla); el control es que esas ' +
    'rutas son admin-only.',
};

function leerSchema(): string {
  return readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
}

function leerRls(): string {
  return readFileSync(join(ROOT, 'prisma', 'rls.sql'), 'utf8');
}

/** Tablas reales que crea Prisma (una por modelo, vía @@map). */
function tablasDelSchema(): string[] {
  return [...new Set([...leerSchema().matchAll(/@@map\("([^"]+)"\)/g)].map((m) => m[1]))];
}

/** Lo que rls.sql realmente hace, tabla por tabla. */
function estadoEnRls(): Map<string, { enable: boolean; force: boolean; policies: string[] }> {
  const sql = leerRls();
  const estado = new Map<string, { enable: boolean; force: boolean; policies: string[] }>();
  const get = (t: string) => {
    if (!estado.has(t)) estado.set(t, { enable: false, force: false, policies: [] });
    return estado.get(t)!;
  };

  for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ENABLE ROW LEVEL SECURITY/gi)) {
    get(m[1]).enable = true;
  }
  for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)\s+FORCE ROW LEVEL SECURITY/gi)) {
    get(m[1]).force = true;
  }
  for (const m of sql.matchAll(/CREATE POLICY\s+(\w+)\s+ON\s+(\w+)/gi)) {
    get(m[2]).policies.push(m[1]);
  }
  return estado;
}

describe('cobertura de RLS: ninguna tabla de tenant se queda sin política', () => {
  it('toda tabla del schema está protegida o exenta con motivo escrito', () => {
    const rls = estadoEnRls();
    const desprotegidas = tablasDelSchema().filter(
      (t) => !EXENTAS[t] && (rls.get(t)?.policies.length ?? 0) === 0,
    );

    // Si este test se pone rojo: o la tabla nueva lleva su política en
    // prisma/rls.sql, o su exención va en EXENTAS con el motivo. No hay
    // tercera opción — el silencio es exactamente el agujero que abrió esto.
    expect(desprotegidas, `Tablas sin política y sin exención: ${desprotegidas.join(', ')}`).toEqual(
      [],
    );
  });

  it('toda tabla con política tiene además ENABLE y FORCE', () => {
    // Sin ENABLE la política es decorativa. Sin FORCE, el dueño de la tabla
    // (que es el rol de la app en esta base) se la saltea entera.
    const rls = estadoEnRls();
    const incompletas = [...rls.entries()]
      .filter(([, e]) => e.policies.length > 0 && (!e.enable || !e.force))
      .map(([t]) => t);

    expect(incompletas).toEqual([]);
  });

  it('las exenciones apuntan a tablas que existen y no se solapan con las protegidas', () => {
    const tablas = new Set(tablasDelSchema());
    const rls = estadoEnRls();

    // Una exención que quedó colgada de una tabla borrada es ruido que después
    // tapa una exención real.
    const fantasmas = Object.keys(EXENTAS).filter((t) => !tablas.has(t));
    expect(fantasmas, `Exenciones de tablas inexistentes: ${fantasmas.join(', ')}`).toEqual([]);

    const contradictorias = Object.keys(EXENTAS).filter(
      (t) => (rls.get(t)?.policies.length ?? 0) > 0,
    );
    expect(
      contradictorias,
      `Tablas exentas que igual tienen política: ${contradictorias.join(', ')}`,
    ).toEqual([]);
  });

  it('cada exención trae un motivo, no un placeholder', () => {
    const flojas = Object.entries(EXENTAS)
      .filter(([, motivo]) => motivo.trim().length < 40)
      .map(([t]) => t);

    expect(flojas, `Exenciones sin explicación real: ${flojas.join(', ')}`).toEqual([]);
  });

  it('las 12 tablas de la auditoría quedaron resueltas explícitamente', () => {
    // Fijación del hallazgo: estas 12 estaban con relrowsecurity=f y 0
    // políticas. Que este test siga verde significa que ninguna volvió al
    // limbo de "ni protegida ni exenta".
    const auditadas = [
      'cost_ledger_entries',
      'cost_periods',
      'allocation_bases',
      'classification_audits',
      'company_target_budgets',
      'empresa_connections',
      'processed_caes',
      'supplier_fingerprints',
      'daily_signals',
      'late_data_decisions',
      'vault_chat_sessions',
      'audit_logs',
    ];
    const rls = estadoEnRls();

    for (const t of auditadas) {
      const resuelta = (rls.get(t)?.policies.length ?? 0) > 0 || Boolean(EXENTAS[t]);
      expect(resuelta, `${t} quedó sin política y sin exención`).toBe(true);
    }

    // daily_signals es la única exenta de las 12 (ver DECISIONES.md).
    expect(auditadas.filter((t) => EXENTAS[t])).toEqual(['daily_signals']);
  });
});
