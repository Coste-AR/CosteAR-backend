import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { CON_ROL_DE_APP } from './tests/db-dependent.mjs';

/**
 * TESTS DE INTEGRACIÓN — contra una base Postgres de verdad.
 *
 * Aparte de `vitest.config.ts` a propósito. Los ~900 tests de esa suite corren
 * con Prisma mockeado y tardan medio minuto; estos necesitan una base viva y no
 * tienen por qué frenar la suite rápida ni fallar en la máquina de alguien que
 * no levantó Docker.
 *
 * Y hay cosas que SOLO se pueden probar acá. El aislamiento entre empresas
 * depende de RLS —políticas que vive en Postgres, no en TypeScript— más los
 * filtros por `userId` de la capa de aplicación. Un test con Prisma mockeado no
 * puede decir nada sobre ninguna de las dos: verifica que el código llamó a
 * `findFirst` con cierto `where`, no que la base efectivamente no devuelva las
 * filas de otro.
 *
 * Local:  docker compose up -d postgres && npm run test:integration
 * CI:     job aparte con un servicio `postgres` (ver .github/workflows/ci.yml)
 *
 * OJO EN LOCAL: el usuario `costear` de `docker-compose.yml` es SUPERUSUARIO, y
 * Postgres ignora RLS por completo para un superusuario. Corriendo así, el caso
 * que verifica el rol falla —correctamente— y los demás pasan por el motivo
 * equivocado: prueban los filtros de la capa de aplicación y nada de RLS.
 *
 * Para una corrida representativa hay que hacer lo mismo que el job de CI: crear
 * un rol de aplicación sin BYPASSRLS y apuntarle `DATABASE_URL`, dejando
 * `MIGRATION_DATABASE_URL` en el dueño. Es también la forma correcta de tener
 * producción, y es lo que `prisma/rls.sql` viene pidiendo en su encabezado.
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
    // La lista vive en `tests/db-dependent.mjs`, que también alimenta la
    // exclusión de la suite rápida — así no se pueden desalinear.
    //
    // Acá van SOLO los que corren con el rol de la aplicación (sin BYPASSRLS).
    // Los que siembran con SQL crudo necesitan el rol dueño y viven en
    // `vitest.db.config.ts` (`npm run test:db`).
    include: CON_ROL_DE_APP,
    globalSetup: ['./tests/integration/global-setup.ts'],
    // Una sola base compartida: correr en paralelo haría que un archivo borre
    // los datos que otro está usando.
    fileParallelism: false,
    // Levantar la base, migrar y sembrar es lento comparado con un mock.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
