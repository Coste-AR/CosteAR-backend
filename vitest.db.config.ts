import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { CON_ROL_DUENO } from './tests/db-dependent.mjs';

/**
 * TESTS CON BASE QUE SIEMBRAN CON SQL CRUDO — corren con el rol DUEÑO.
 *
 * Aparte de `vitest.integration.config.ts` por una razón concreta: el rol de
 * Postgres tiene que ser el opuesto.
 *
 *   - `vitest.integration.config.ts` corre con el rol de la APLICACIÓN, sin
 *     BYPASSRLS, porque prueba que las políticas RLS impidan ver datos ajenos.
 *   - este config corre con el rol DUEÑO, porque estos archivos insertan sus
 *     fixtures con `$executeRawUnsafe` y el rol de la app no puede: RLS los
 *     rechaza con `42501: new row violates row-level security policy`.
 *
 * `tests/security/rls-cross-tenant.test.ts` es el caso interesante: **siembra
 * con el dueño y verifica con `RLS_PROBE_DATABASE_URL`**, que apunta a un rol
 * restringido. Sin esa sonda no prueba nada, y el archivo se niega a dar verde
 * — con `RLS_REQUIRE_PROBE=1` directamente falla en vez de saltearse.
 *
 * Local:
 *   docker compose up -d postgres
 *   # crear el rol de sonda una sola vez:
 *   #   CREATE ROLE costear_rls_probe LOGIN PASSWORD 'probe' NOSUPERUSER NOBYPASSRLS;
 *   #   GRANT USAGE ON SCHEMA public TO costear_rls_probe;
 *   #   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO costear_rls_probe;
 *   MIGRATION_DATABASE_URL=<dueño> DATABASE_URL=<dueño> \
 *   RLS_PROBE_DATABASE_URL=<sonda> RLS_REQUIRE_PROBE=1 npm run test:db
 *
 * CI: mismo job que la suite de integración, con otras variables de entorno
 * (ver `.github/workflows/ci.yml`).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: CON_ROL_DUENO,
    globalSetup: ['./tests/integration/global-setup.ts'],
    // Una sola base compartida: en paralelo un archivo borraría los datos que
    // otro está usando.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
