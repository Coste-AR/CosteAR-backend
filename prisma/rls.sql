-- Row-Level Security para CosteAR
-- ---------------------------------------------------------------------------
-- Aplicar DESPUÉS de `prisma migrate deploy` (o `migrate dev`).
-- Refuerza el aislamiento multi-tenant a nivel de base de datos: aunque un bug
-- en la capa de aplicación olvide filtrar por userId, PostgreSQL no devuelve
-- filas de otros tenants.
--
-- El backend setea, en cada transacción de datos de tenant:
--     SELECT set_config('app.user_id', '<uuid>', true);
-- (ver src/infrastructure/database/prisma.ts → withTenant)
--
-- Nota: el rol de aplicación NO debe ser superusuario ni tener BYPASSRLS,
-- de lo contrario las políticas se ignoran. Crear un rol dedicado en prod.
-- ---------------------------------------------------------------------------

-- Helper: lee el tenant actual desde la variable de sesión.
CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- companies
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON companies;
CREATE POLICY tenant_isolation ON companies
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

-- cost_structures
ALTER TABLE cost_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_structures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cost_structures;
CREATE POLICY tenant_isolation ON cost_structures
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

-- cost_calculations
ALTER TABLE cost_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_calculations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cost_calculations;
CREATE POLICY tenant_isolation ON cost_calculations
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

-- alerts
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON alerts;
CREATE POLICY tenant_isolation ON alerts
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

-- alert_settings
ALTER TABLE alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON alert_settings;
CREATE POLICY tenant_isolation ON alert_settings
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

-- ---------------------------------------------------------------------------
-- Trazabilidad Total v1 — aislamiento vía join a cost_structures.userId
-- (estas tablas no tienen userId propio; el tenant se define por la
-- estructura de costos a la que pertenecen). trace_audit_log no lleva RLS
-- directo porque sus entidades son de tipos heterogéneos (entityType/entityId
-- genéricos) y no hay una sola columna que resuelva el dueño; el filtro se
-- hace en la capa de aplicación.
-- ---------------------------------------------------------------------------

-- data_points
ALTER TABLE data_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_points FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON data_points;
CREATE POLICY tenant_isolation ON data_points
  USING ("structureId" IN (SELECT id FROM cost_structures WHERE "userId" = current_app_user_id()))
  WITH CHECK ("structureId" IN (SELECT id FROM cost_structures WHERE "userId" = current_app_user_id()));

-- data_point_versions
ALTER TABLE data_point_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_point_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON data_point_versions;
CREATE POLICY tenant_isolation ON data_point_versions
  USING ("dataPointId" IN (
    SELECT dp.id FROM data_points dp
    JOIN cost_structures cs ON cs.id = dp."structureId"
    WHERE cs."userId" = current_app_user_id()
  ))
  WITH CHECK ("dataPointId" IN (
    SELECT dp.id FROM data_points dp
    JOIN cost_structures cs ON cs.id = dp."structureId"
    WHERE cs."userId" = current_app_user_id()
  ));

-- evidence (T-04)
--
-- Hasta agosto de 2026 esta tabla estaba EXENTA de RLS, y el motivo escrito era
-- honesto: "su vínculo con el tenant es indirecto y opcional (puede no tener
-- dueño)". Era cierto porque NADIE creaba filas — la tabla tenía 0 registros y
-- ningún productor en todo el backend. Una tabla vacía se puede dejar afuera
-- sin consecuencias; una tabla donde ahora se guardan las facturas de los
-- clientes, no.
--
-- Desde que existe el alta (POST /api/v1/evidence) todo comprobante nace con
-- `uploadedBy` = el costista que lo subió, así que el dueño es directo y la
-- política es la de siempre. Las filas con `uploadedBy` NULL (heredadas o
-- huérfanas por baja de usuario, la FK es ON DELETE SET NULL) quedan invisibles
-- desde la app a propósito: un comprobante sin dueño no es de nadie.
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON evidence;
CREATE POLICY tenant_isolation ON evidence
  USING ("uploadedBy" = current_app_user_id())
  WITH CHECK ("uploadedBy" = current_app_user_id());

-- calculation_runs
ALTER TABLE calculation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculation_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON calculation_runs;
CREATE POLICY tenant_isolation ON calculation_runs
  USING ("structureId" IN (SELECT id FROM cost_structures WHERE "userId" = current_app_user_id()))
  WITH CHECK ("structureId" IN (SELECT id FROM cost_structures WHERE "userId" = current_app_user_id()));

-- calculation_nodes
ALTER TABLE calculation_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculation_nodes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON calculation_nodes;
CREATE POLICY tenant_isolation ON calculation_nodes
  USING ("runId" IN (
    SELECT cr.id FROM calculation_runs cr
    JOIN cost_structures cs ON cs.id = cr."structureId"
    WHERE cs."userId" = current_app_user_id()
  ))
  WITH CHECK ("runId" IN (
    SELECT cr.id FROM calculation_runs cr
    JOIN cost_structures cs ON cs.id = cr."structureId"
    WHERE cs."userId" = current_app_user_id()
  ));

-- ---------------------------------------------------------------------------
-- Costeo por Procesos (B03) — aislamiento vía join a cost_structures.userId
-- (process_departments no tiene userId propio; el tenant se define por la
-- estructura de costos a la que pertenece, mismo patrón que calculation_runs).
-- ---------------------------------------------------------------------------

-- process_departments
ALTER TABLE process_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON process_departments;
CREATE POLICY tenant_isolation ON process_departments
  USING ("structureId" IN (SELECT id FROM cost_structures WHERE "userId" = current_app_user_id()))
  WITH CHECK ("structureId" IN (SELECT id FROM cost_structures WHERE "userId" = current_app_user_id()));

-- unit_movement_schedules (B04): no tiene userId ni structureId propios; el
-- tenant se resuelve por la cadena departamento → estructura → dueño.
ALTER TABLE unit_movement_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_movement_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON unit_movement_schedules;
CREATE POLICY tenant_isolation ON unit_movement_schedules
  USING ("departmentId" IN (
    SELECT pd.id FROM process_departments pd
    JOIN cost_structures cs ON cs.id = pd."structureId"
    WHERE cs."userId" = current_app_user_id()
  ))
  WITH CHECK ("departmentId" IN (
    SELECT pd.id FROM process_departments pd
    JOIN cost_structures cs ON cs.id = pd."structureId"
    WHERE cs."userId" = current_app_user_id()
  ));

-- ---------------------------------------------------------------------------
-- Costeo por Procesos (B05) — Costos conjuntos.
-- Ni joint_cost_allocations ni joint_cost_by_product_lines tienen userId
-- propio; el tenant se resuelve por la cadena estructura → dueño (mismo patrón
-- que process_departments), y las líneas por la cadena línea → reparto →
-- estructura → dueño.
-- ---------------------------------------------------------------------------

-- joint_cost_allocations
ALTER TABLE joint_cost_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE joint_cost_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON joint_cost_allocations;
CREATE POLICY tenant_isolation ON joint_cost_allocations
  USING ("structureId" IN (SELECT id FROM cost_structures WHERE "userId" = current_app_user_id()))
  WITH CHECK ("structureId" IN (SELECT id FROM cost_structures WHERE "userId" = current_app_user_id()));

-- joint_cost_by_product_lines: aislamiento vía join reparto → estructura → dueño.
ALTER TABLE joint_cost_by_product_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE joint_cost_by_product_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON joint_cost_by_product_lines;
CREATE POLICY tenant_isolation ON joint_cost_by_product_lines
  USING ("allocationId" IN (
    SELECT jca.id FROM joint_cost_allocations jca
    JOIN cost_structures cs ON cs.id = jca."structureId"
    WHERE cs."userId" = current_app_user_id()
  ))
  WITH CHECK ("allocationId" IN (
    SELECT jca.id FROM joint_cost_allocations jca
    JOIN cost_structures cs ON cs.id = jca."structureId"
    WHERE cs."userId" = current_app_user_id()
  ));

-- ===========================================================================
-- Cierre de la red de aislamiento (auditoría de RLS, 08/2026)
--
-- Hasta acá RLS cubría 13 tablas. Las que siguen son igual de sensibles y
-- estaban SIN política: el aislamiento dependía por completo de que cada
-- servicio se acordara del `where userId`. El día que un endpoint nuevo se lo
-- olvide, no hay nada abajo que lo frene — y ese endpoint no rompe ningún
-- test: devuelve datos de otro cliente con un 200.
--
-- La tabla exenta y el porqué de cada camino no obvio están en DECISIONES.md
-- ("Auditoría de RLS"). El chequeo automático que hace ruido cuando aparece
-- una tabla nueva sin política vive en tests/config/rls-coverage.test.ts.
-- ===========================================================================

-- --- Dueño directo (columna propia) ---------------------------------------

-- cost_periods: `userId` denormalizado justamente para esto.
ALTER TABLE cost_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_periods FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cost_periods;
CREATE POLICY tenant_isolation ON cost_periods
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

-- late_data_decisions: `userId` denormalizado (ver comentario en el schema).
ALTER TABLE late_data_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE late_data_decisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON late_data_decisions;
CREATE POLICY tenant_isolation ON late_data_decisions
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

-- vault_chat_sessions: conversaciones del usuario contra la bóveda.
ALTER TABLE vault_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_chat_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON vault_chat_sessions;
CREATE POLICY tenant_isolation ON vault_chat_sessions
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

-- cost_ledger_entries: el dueño es `costistId` (mismo rol que `userId` en el
-- resto del modelo: el costista ES el tenant).
ALTER TABLE cost_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_ledger_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cost_ledger_entries;
CREATE POLICY tenant_isolation ON cost_ledger_entries
  USING ("costistId" = current_app_user_id())
  WITH CHECK ("costistId" = current_app_user_id());

-- empresa_connections: `costistId` = dueño de la conexión empresa ↔ costista.
ALTER TABLE empresa_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresa_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON empresa_connections;
CREATE POLICY tenant_isolation ON empresa_connections
  USING ("costistId" = current_app_user_id())
  WITH CHECK ("costistId" = current_app_user_id());

-- supplier_fingerprints: base de aprendizaje POR costista (ver schema).
ALTER TABLE supplier_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_fingerprints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_fingerprints;
CREATE POLICY tenant_isolation ON supplier_fingerprints
  USING ("costistId" = current_app_user_id())
  WITH CHECK ("costistId" = current_app_user_id());

-- classification_audits: `costistId` propio (además de companyId/dataEntryId).
ALTER TABLE classification_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE classification_audits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON classification_audits;
CREATE POLICY tenant_isolation ON classification_audits
  USING ("costistId" = current_app_user_id())
  WITH CHECK ("costistId" = current_app_user_id());

-- validation_history: `costistId` propio. Su padre (data_entries) queda exento
-- por tener dos actores legítimos; el historial, en cambio, lo escribe siempre
-- el costista y no tiene esa ambigüedad.
ALTER TABLE validation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON validation_history;
CREATE POLICY tenant_isolation ON validation_history
  USING ("costistId" = current_app_user_id())
  WITH CHECK ("costistId" = current_app_user_id());

-- --- Dueño vía empresa (companyId → companies."userId") --------------------

-- company_target_budgets: 1-a-1 con la empresa, sin userId propio.
ALTER TABLE company_target_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_target_budgets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON company_target_budgets;
CREATE POLICY tenant_isolation ON company_target_budgets
  USING ("companyId" IN (SELECT id FROM companies WHERE "userId" = current_app_user_id()))
  WITH CHECK ("companyId" IN (SELECT id FROM companies WHERE "userId" = current_app_user_id()));

-- processed_caes: registro de CAEs ya vistos. Tiene companyId (no costistId),
-- así que el dueño sale por la empresa. NOTA: la deduplicación de CAE pasa a
-- ser POR TENANT (era global por el unique de `cae`); ver DECISIONES.md.
ALTER TABLE processed_caes ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_caes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON processed_caes;
CREATE POLICY tenant_isolation ON processed_caes
  USING ("companyId" IN (SELECT id FROM companies WHERE "userId" = current_app_user_id()))
  WITH CHECK ("companyId" IN (SELECT id FROM companies WHERE "userId" = current_app_user_id()));

-- --- Dueño vía estructura (structureId → cost_structures."userId") ---------

-- cost_config_versions: histórico append-only de la config del motor. Sin
-- userId propio; mismo patrón que calculation_runs.
ALTER TABLE cost_config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_config_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cost_config_versions;
CREATE POLICY tenant_isolation ON cost_config_versions
  USING ("structureId" IN (SELECT id FROM cost_structures WHERE "userId" = current_app_user_id()))
  WITH CHECK ("structureId" IN (SELECT id FROM cost_structures WHERE "userId" = current_app_user_id()));

-- allocation_base_values: los NÚMEROS de las bases de prorrateo. Protegerlos
-- es la mitad que importa: la base sin sus valores no dice nada, los valores
-- sin la base sí (m², horas máquina y focos de la planta del cliente).
ALTER TABLE allocation_base_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_base_values FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON allocation_base_values;
CREATE POLICY tenant_isolation ON allocation_base_values
  USING ("structureId" IN (SELECT id FROM cost_structures WHERE "userId" = current_app_user_id()))
  WITH CHECK ("structureId" IN (SELECT id FROM cost_structures WHERE "userId" = current_app_user_id()));

-- --- Dueño vía sesión de chat ---------------------------------------------

-- vault_chat_messages: el contenido de la conversación. Proteger la sesión y
-- dejar abiertos los mensajes sería proteger el sobre y no la carta.
ALTER TABLE vault_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_chat_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON vault_chat_messages;
CREATE POLICY tenant_isolation ON vault_chat_messages
  USING ("sessionId" IN (SELECT id FROM vault_chat_sessions WHERE "userId" = current_app_user_id()))
  WITH CHECK ("sessionId" IN (SELECT id FROM vault_chat_sessions WHERE "userId" = current_app_user_id()));

-- --- Catálogo mixto: filas del sistema + filas del tenant ------------------

-- allocation_bases: `companyId` NULL = base PRECARGADA DEL SISTEMA, común a
-- todos (superficie en m², horas máquina...). Con companyId = base propia del
-- cliente, que sí es dato suyo.
--
-- Por eso van DOS políticas y no una:
--   · `tenant_isolation` (FOR ALL) deja leer y escribir solo lo propio;
--   · `system_bases_readable` (FOR SELECT) suma las del sistema a la lectura.
-- Las permisivas se suman con OR por comando, así que el efecto es: veo las
-- mías + las del sistema, pero solo puedo tocar las mías. Una sola política
-- que incluyera `companyId IS NULL` en el USING dejaría a cualquier tenant
-- BORRAR el catálogo compartido — el USING también gobierna UPDATE y DELETE.
ALTER TABLE allocation_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_bases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON allocation_bases;
CREATE POLICY tenant_isolation ON allocation_bases
  USING ("companyId" IN (SELECT id FROM companies WHERE "userId" = current_app_user_id()))
  WITH CHECK ("companyId" IN (SELECT id FROM companies WHERE "userId" = current_app_user_id()));
DROP POLICY IF EXISTS system_bases_readable ON allocation_bases;
CREATE POLICY system_bases_readable ON allocation_bases
  FOR SELECT
  USING ("companyId" IS NULL);

-- --- Bitácora de auditoría: append-only, lectura por tenant ----------------

-- audit_logs es infraestructura, no dato de negocio, y tiene dos propiedades
-- que una política `userId = current_app_user_id()` a secas rompería:
--
--   1. Se escribe FUERA de todo contexto de tenant. `auth.login.failed` de un
--      email inexistente, jobs, webhooks: `userId` queda NULL a propósito. Con
--      un WITH CHECK por userId, esas escrituras fallarían y perderíamos
--      justamente los registros de seguridad que más importan.
--   2. Es append-only por diseño (ver el comentario del modelo).
--
-- Solución: políticas separadas por comando.
--   · lectura  → solo las filas del propio tenant (las de userId NULL no las
--                ve nadie desde la app; son para el operador de la base);
--   · escritura→ siempre permitida (el log nunca puede quedarse mudo);
--   · UPDATE/DELETE → SIN política a propósito. Con RLS activo y sin política
--     para esos comandos, Postgres no deja modificar ni borrar NINGUNA fila.
--     El append-only deja de ser una convención de la capa de aplicación y
--     pasa a estar enforced por la base.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_logs;
CREATE POLICY tenant_isolation ON audit_logs
  FOR SELECT
  USING ("userId" = current_app_user_id());
DROP POLICY IF EXISTS audit_append_only ON audit_logs;
CREATE POLICY audit_append_only ON audit_logs
  FOR INSERT
  WITH CHECK (true);

-- unidades_medida y parametros_costeo: `userId` denormalizado, mismo patrón que
-- cost_periods. El aislamiento entre empresas es de Postgres, no de TypeScript
-- (DOM-07): sin estas políticas, un parámetro de costeo de un cliente sería
-- legible por otro.
ALTER TABLE unidades_medida ENABLE ROW LEVEL SECURITY;
ALTER TABLE unidades_medida FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON unidades_medida;
CREATE POLICY tenant_isolation ON unidades_medida
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

ALTER TABLE parametros_costeo ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametros_costeo FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parametros_costeo;
CREATE POLICY tenant_isolation ON parametros_costeo
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

-- Operación física genérica: ambas tablas tienen `userId` denormalizado para
-- que el aislamiento se aplique sin joins adicionales.
ALTER TABLE unidades_productivas ENABLE ROW LEVEL SECURITY;
ALTER TABLE unidades_productivas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON unidades_productivas;
CREATE POLICY tenant_isolation ON unidades_productivas
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

ALTER TABLE lotes_productivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes_productivos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lotes_productivos;
CREATE POLICY tenant_isolation ON lotes_productivos
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

ALTER TABLE paquetes_rubro ENABLE ROW LEVEL SECURITY;
ALTER TABLE paquetes_rubro FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON paquetes_rubro;
CREATE POLICY tenant_isolation ON paquetes_rubro USING ("userId" IS NULL OR "userId" = current_app_user_id()) WITH CHECK ("userId" IS NULL OR "userId" = current_app_user_id());

ALTER TABLE eventos_lote ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_lote FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON eventos_lote;
CREATE POLICY tenant_isolation ON eventos_lote
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

ALTER TABLE producciones_diarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE producciones_diarias FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON producciones_diarias;
CREATE POLICY tenant_isolation ON producciones_diarias
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

ALTER TABLE corridas_produccion ENABLE ROW LEVEL SECURITY;
ALTER TABLE corridas_produccion FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON corridas_produccion;
CREATE POLICY tenant_isolation ON corridas_produccion USING ("userId" = current_app_user_id()) WITH CHECK ("userId" = current_app_user_id());
ALTER TABLE consumos_corrida ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumos_corrida FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON consumos_corrida;
CREATE POLICY tenant_isolation ON consumos_corrida USING ("userId" = current_app_user_id()) WITH CHECK ("userId" = current_app_user_id());

-- activos_amortizables y desperdicio_registros (S-03 y S-04): `userId`
-- denormalizado, mismo patrón que cost_periods.
ALTER TABLE activos_amortizables ENABLE ROW LEVEL SECURITY;
ALTER TABLE activos_amortizables FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON activos_amortizables;
CREATE POLICY tenant_isolation ON activos_amortizables
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

ALTER TABLE desperdicio_registros ENABLE ROW LEVEL SECURITY;
ALTER TABLE desperdicio_registros FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON desperdicio_registros;
CREATE POLICY tenant_isolation ON desperdicio_registros
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());

-- reglas_alerta (S-05b): `userId` denormalizado, mismo patrón que cost_periods.
ALTER TABLE reglas_alerta ENABLE ROW LEVEL SECURITY;
ALTER TABLE reglas_alerta FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reglas_alerta;
CREATE POLICY tenant_isolation ON reglas_alerta
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());
