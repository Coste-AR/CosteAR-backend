/**
 * Guarda contra deriva del contrato de API (#282, fase 1).
 *
 * Regenera `openapi/openapi.json` y `openapi/types.d.ts` en un directorio
 * temporal y los compara byte a byte contra lo commiteado. Mismo patrón que
 * `check:tests-base`: si alguien cambió una ruta convertida sin correr
 * `npm run openapi:generate`, esto falla el CI en vez de dejar el artefacto
 * publicado mentir sobre lo que la API realmente devuelve.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const FILES = ['openapi.json', 'types.d.ts'];

// Se invoca el CLI de tsx directo con `node`, sin pasar por `npx`/shell: en
// Windows, `execFileSync` con `shell: true` no cita un path con espacios
// (`CosteAR rep\...`) y el shell lo trocea. Con `node <cli.mjs> ...` no hace
// falta shell ni `.cmd`.
const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');

const tmp = mkdtempSync(join(tmpdir(), 'costear-openapi-'));

try {
  execFileSync(
    process.execPath,
    [tsxCli, join(ROOT, 'scripts', 'generate-openapi.ts'), tmp],
    { cwd: ROOT, stdio: 'inherit' },
  );

  let stale = false;
  for (const file of FILES) {
    const committed = readFileSync(join(ROOT, 'openapi', file), 'utf-8');
    const fresh = readFileSync(join(tmp, file), 'utf-8');
    if (committed !== fresh) {
      stale = true;
      console.error(`✖ openapi/${file} está desactualizado respecto de las rutas convertidas.`);
    }
  }

  if (stale) {
    console.error(
      '\nCorré `npm run openapi:generate` y commiteá el resultado — el contrato publicado ' +
        'tiene que ser exactamente lo que las rutas convertidas devuelven hoy.',
    );
    process.exit(1);
  }

  console.log('✔ openapi/openapi.json y openapi/types.d.ts coinciden con las rutas convertidas.');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
