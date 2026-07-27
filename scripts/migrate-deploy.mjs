#!/usr/bin/env node
/**
 * migrate-deploy.mjs
 *
 * Script de deploy de migraciones Prisma para producción / staging.
 * Antes de correr `migrate deploy`, DETECTA y RESUELVE automáticamente
 * cualquier migración que haya quedado en estado FAILED en la tabla
 * `_prisma_migrations` (ej. un deploy cortado a la mitad, o timestamps
 * cruzados por trabajar en ramas paralelas).
 *
 * Prisma bloquea todos los deploys si hay UNA migración fallida (error P3009).
 * Este script:
 *   1. Lee `prisma migrate status` y extrae las migraciones fallidas.
 *   2. Las marca como "rolled-back" para que Prisma las re-aplique.
 *      (+ una lista manual de respaldo por si el parseo cambia de formato.)
 *   3. Corre `prisma migrate deploy`.
 *
 * ⚠ Límite conocido: si una migración fallida dejó objetos a medias (tablas/
 * tipos ya creados) y NO es idempotente, el re-apply puede volver a fallar con
 * "already exists". En ese caso hay que limpiar esos objetos a mano una vez.
 * El auto-resolve cubre el caso común (fallo limpio o migración idempotente).
 *
 * Uso: node scripts/migrate-deploy.mjs
 */

import { execSync } from 'node:child_process';

// Respaldo: migraciones conocidas que fallaron alguna vez. Se resuelven aunque
// el parseo de `migrate status` no las detecte. `resolve` es idempotente.
const KNOWN_FAILED_MIGRATIONS = [
  '20260608200000_unique_cuit_login',
];

function run(cmd, { ignoreError = false } = {}) {
  console.log(`▶ ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (err) {
    if (ignoreError) {
      console.warn(`⚠ comando falló (ignorado): ${cmd}`);
    } else {
      throw err;
    }
  }
}

/** Corre un comando y devuelve su salida (stdout+stderr), sin tirar si falla. */
function capture(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    // `migrate status` sale con código != 0 cuando hay migraciones pendientes o
    // fallidas, pero igual imprime la info que necesitamos.
    return `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
  }
}

/**
 * Detecta migraciones en estado FAILED parseando `prisma migrate status`.
 * Prisma imprime una sección tipo:
 *
 *   Following migration have failed:
 *   20260710210000_add_trazabilidad_total_v1
 *
 * Tomamos los nombres (14 dígitos + "_" + slug) que aparecen luego del
 * encabezado "failed", hasta la primera línea que ya no es un nombre.
 */
function detectFailedMigrations() {
  const output = capture('npx prisma migrate status');
  const lines = output.split('\n').map((l) => l.trim());
  const nameRe = /^(\d{14}_[A-Za-z0-9_]+)$/;
  const failed = new Set();

  let inFailedSection = false;
  for (const line of lines) {
    if (/have failed|migration.*failed/i.test(line)) {
      inFailedSection = true;
      // Algunos formatos ponen el nombre en la MISMA línea del encabezado.
      const inline = line.match(/(\d{14}_[A-Za-z0-9_]+)/);
      if (inline) failed.add(inline[1]);
      continue;
    }
    if (inFailedSection) {
      const m = line.match(nameRe);
      if (m) {
        failed.add(m[1]);
      } else if (line.length > 0) {
        // Se terminó la lista de nombres (llegó una oración o instrucción).
        inFailedSection = false;
      }
    }
  }
  return [...failed];
}

console.log('═══════════════════════════════════════════');
console.log('  CosteAR — deploy de migraciones Prisma   ');
console.log('═══════════════════════════════════════════');

// Paso 1: detectar (dinámico) + respaldo (manual) y resolver como rolled-back.
console.log('\n🔎 Buscando migraciones fallidas…');
const detected = detectFailedMigrations();
if (detected.length > 0) {
  console.log(`   Detectadas: ${detected.join(', ')}`);
} else {
  console.log('   No se detectaron migraciones fallidas.');
}

const toResolve = [...new Set([...detected, ...KNOWN_FAILED_MIGRATIONS])];
for (const migration of toResolve) {
  console.log(`\n🔧 Resolviendo migración fallida: ${migration}`);
  run(
    `npx prisma migrate resolve --rolled-back "${migration}"`,
    { ignoreError: true }, // ya puede estar resuelta / no existir en esta DB
  );
}

// Paso 2: correr migrate deploy normalmente.
console.log('\n🚀 Corriendo prisma migrate deploy…');
run('npx prisma migrate deploy');

console.log('\n✅ Migraciones aplicadas correctamente.');
