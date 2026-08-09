import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

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
    // Los de integración necesitan una base Postgres viva y corren aparte
    // (`npm run test:integration`, con su propio config). Sin esta exclusión
    // reventarían acá, en la máquina de cualquiera que no levantó Docker — y en
    // el job de CI que hoy no tiene base.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/infrastructure/http/server.ts'],
    },
  },
});
