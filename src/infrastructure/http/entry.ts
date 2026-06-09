/**
 * Entry point separado: registra handlers de error ANTES de importar server.ts.
 * En ESM los imports se ejecutan antes que el cuerpo del módulo, por eso
 * los handlers en server.ts no capturan errores de módulos importados.
 * Este archivo usa import() dinámico para poder atrapar esos errores.
 */
process.on('uncaughtException', (err) => {
  process.stderr.write(`[FATAL] uncaughtException: ${err?.stack ?? err}\n`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[FATAL] unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}\n`);
  process.exit(1);
});

process.stderr.write('[entry] Cargando servidor...\n');

try {
  await import('./server.js');
} catch (err) {
  process.stderr.write(`[FATAL] Error al cargar server.js: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
}
