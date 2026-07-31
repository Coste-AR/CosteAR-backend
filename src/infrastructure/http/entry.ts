/**
 * Entry point de producción.
 *
 * Orden de operaciones:
 *   1. Arranca un mini HTTP server en el PORT de Railway → healthcheck pasa ✅
 *   2. Corre migraciones Prisma de forma async (sin bloquear el event loop)
 *   3. Aplica RLS (no fatal)
 *   4. Cierra el mini-server
 *   5. Arranca Fastify en el mismo puerto
 *
 * Esto garantiza que /health responde con 200 desde el primer segundo,
 * sin importar cuánto tarden las migraciones.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..'); // /app

const PORT = Number(process.env.PORT ?? 3000);

process.on('uncaughtException', (err) => {
  process.stderr.write(`[FATAL] uncaughtException: ${err?.stack ?? err}\n`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[FATAL] unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}\n`);
  process.exit(1);
});

/** Corre un script Node con output en tiempo real. Resuelve con exit code. */
function runScript(scriptPath: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: 'inherit',
      cwd: ROOT,
      env: process.env,
    });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', (err) => {
      process.stderr.write(`[entry] Error corriendo ${scriptPath}: ${err.message}\n`);
      resolve(1);
    });
  });
}

/**
 * Aborta el arranque de forma ruidosa y verificable.
 *
 * Cierra el pre-server ANTES de salir: si quedara escuchando, Railway vería el
 * healthcheck en verde mientras el proceso se muere, y el deploy podría darse
 * por bueno. Sale con 1 para que el reintento y, si persiste, el rollback a la
 * versión anterior queden en manos de la plataforma.
 */
async function abortar(motivo: string, explicacion: string): Promise<never> {
  process.stderr.write('\n');
  process.stderr.write('═══════════════════════════════════════════════════════════\n');
  process.stderr.write('  ARRANQUE ABORTADO\n');
  process.stderr.write('═══════════════════════════════════════════════════════════\n');
  process.stderr.write(`[entry] ${motivo}\n`);
  process.stderr.write(`[entry] ${explicacion}\n\n`);
  await new Promise<void>((resolve) => pre.close(() => resolve()));
  process.exit(1);
}

// ─── 1. Mini-server para el healthcheck ────────────────────────────────────

const pre = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'starting' }));
});

await new Promise<void>((resolve) => pre.listen(PORT, '0.0.0.0', resolve));
process.stderr.write(`[entry] Pre-server en :${PORT} — Railway puede hacer healthcheck\n`);

// ─── 2. Migraciones ─────────────────────────────────────────────────────────

process.stderr.write('[entry] Corriendo migraciones...\n');
const migrateCode = await runScript(join(ROOT, 'scripts', 'migrate-deploy.mjs'));
if (migrateCode !== 0) {
  await abortar(
    `Las migraciones salieron con código ${migrateCode}.`,
    'Arrancar igual deja la app sirviendo tráfico contra un esquema incompleto: las lecturas' +
    ' andan, las escrituras tiran 500, y el healthcheck da verde igual.',
  );
}

// ─── 2b. El esquema real, no el que Prisma cree que aplicó ──────────────────
//
// `migrate deploy` puede salir 0 y la base estar incompleta igual: si una
// migración quedó marcada como aplicada sin haber corrido entera, Prisma dice
// "no pending migrations" y sigue de largo. Pasó el 28/07/2026 con `audit_logs`
// y tuvo la app rota en producción sin que ninguna señal lo mostrara.
process.stderr.write('[entry] Verificando el esquema contra la base...\n');
const schemaCode = await runScript(join(ROOT, 'scripts', 'verify-schema.mjs'));
if (schemaCode !== 0) {
  await abortar(
    'Faltan tablas en la base (ver el detalle arriba).',
    'El servidor no arranca a propósito: es preferible que Railway mantenga la versión' +
    ' anterior a servir una app que falla en cada escritura.',
  );
}

// ─── 3. RLS (no fatal, pero NO silencioso) ──────────────────────────────────
//
// No frena el arranque a propósito: dejar la app caída por un fallo transitorio
// del script sería peor. Pero si falla, la base queda sin aislamiento entre
// inquilinos, así que tiene que verse en los logs igual que las migraciones.

const rlsCode = await runScript(join(ROOT, 'scripts', 'apply-rls.mjs'));
if (rlsCode !== 0) {
  process.stderr.write(
    `[entry] WARN: RLS salió con código ${rlsCode} — la base puede estar SIN aislamiento entre inquilinos\n`,
  );
}

// ─── 3b. Términos y condiciones — sembrar v1 si no hay ninguna versión activa ─
//
// Sin esto, un ambiente nuevo (o resetado) no tiene NINGUNA TermsVersion, y
// terms-service.ts tira error en requireCurrentVersion() — lo que bloquea
// TODO registro y login, no solo lo relacionado a términos. No fatal por el
// mismo motivo que RLS: preferible arrancar en modo degradado y que se vea
// en los logs, a que un fallo transitorio tumbe todo el arranque.

const termsCode = await runScript(join(ROOT, 'scripts', 'ensure-initial-terms.mjs'));
if (termsCode !== 0) {
  process.stderr.write(
    `[entry] WARN: siembra de Términos y Condiciones salió con código ${termsCode} — el registro/login puede estar bloqueado hasta que se resuelva\n`,
  );
}

// ─── 4. Cerrar pre-server y arrancar Fastify ────────────────────────────────

process.stderr.write('[entry] Cerrando pre-server y arrancando Fastify...\n');
await new Promise<void>((resolve) => pre.close(() => resolve()));

await import('./server.js');
