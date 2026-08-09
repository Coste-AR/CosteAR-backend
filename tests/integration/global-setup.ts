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

  // Migrar y aplicar políticas necesita permisos de DUEÑO; los tests corren con
  // el rol de la APLICACIÓN, que a propósito no los tiene. Si `MIGRATION_DATABASE_URL`
  // está definida, cada cosa usa la conexión que le corresponde.
  //
  // Que sean dos roles distintos no es ceremonia. Con un superusuario, Postgres
  // ignora RLS por completo y esta suite pasaría en verde probando solo los
  // filtros de la capa de aplicación — sin decir una palabra sobre la mitad de
  // la protección. Es exactamente lo que pasó en la primera corrida de CI de
  // esta rama, y lo detectó el propio test del rol.
  const env = {
    ...process.env,
    DATABASE_URL: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  };

  const run = (script: string) =>
    execFileSync(process.execPath, [join(ROOT, 'scripts', script)], {
      cwd: ROOT,
      env,
      stdio: 'inherit',
    });

  run('migrate-deploy.mjs');
  run('apply-rls.mjs');
}
