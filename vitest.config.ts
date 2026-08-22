import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { TESTS_CON_BASE } from './tests/db-dependent.mjs';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Los que necesitan una base Postgres viva corren aparte
    // (`npm run test:integration`, con su propio config). Sin esta exclusión
    // reventarían acá, en la máquina de cualquiera que no levantó Docker — y en
    // el job de CI que no tiene base.
    //
    // La lista sale de `tests/db-dependent.mjs`, que también alimenta el config
    // de integración: así una no se puede desalinear de la otra. Antes esto
    // decía solo `tests/integration/**` y cinco archivos que necesitaban base
    // quedaban en el limbo — se salteaban acá y tampoco los agarraba el otro
    // config. Eran 61 tests que no corrían en ningún lado.
    exclude: ['**/node_modules/**', '**/dist/**', ...TESTS_CON_BASE],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/infrastructure/http/server.ts'],
    },
  },
});
