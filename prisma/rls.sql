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
