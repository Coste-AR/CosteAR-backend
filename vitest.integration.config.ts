import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

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
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['./tests/integration/global-setup.ts'],
    // Una sola base compartida: correr en paralelo haría que un archivo borre
    // los datos que otro está usando.
    fileParallelism: false,
    // Levantar la base, migrar y sembrar es lento comparado con un mock.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
