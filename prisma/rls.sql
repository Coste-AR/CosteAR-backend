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
-- estructura de costos a la que pertenecen). evidence y trace_audit_log no
-- llevan RLS directo porque su vínculo con el tenant es indirecto/opcional;
-- el filtro de pertenencia se hace en la capa de aplicación (mismo patrón que
-- el resto del código: requireStructure/requireDataPoint por userId).
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
