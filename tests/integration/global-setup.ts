import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Deja la base de integración lista: esquema al día y políticas RLS aplicadas.
 *
 * Corre UNA vez por corrida, antes de todos los archivos de test.
 *
 * `apply-rls.mjs` es imprescindible acá, no un extra: sin él las tablas tienen
 * las columnas pero ninguna política, y un test de aislamiento pasaría o
 * fallaría por motivos que no tienen nada que ver con lo que quiere probar.
 * (En producción ese mismo script corre en cada boot desde `entry.ts` y NO es
 * fatal si falla — o sea que la app puede arrancar sin aislamiento y solo dejar
 * un WARN en los logs. Ese es justamente uno de los agujeros que esta suite
 * existe para vigilar.)
 */
export async function setup(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'Los tests de integración necesitan DATABASE_URL apuntando a una base DESECHABLE.\n' +
        'Local:  docker compose up -d postgres  (y usar la URL del .env, puerto 5433)\n' +
        'CI:     la define el job de integración.\n' +
        'Se crean y borran datos: NUNCA apuntar esto a producción.',
    );
  }

  const run = (script: string) =>
    execFileSync(process.execPath, [join(ROOT, 'scripts', script)], {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
    });

  run('migrate-deploy.mjs');
  run('apply-rls.mjs');
}
