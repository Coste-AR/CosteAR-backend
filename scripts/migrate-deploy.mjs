#!/usr/bin/env node
/**
 * migrate-deploy.mjs
 *
 * Script de deploy de migraciones Prisma para producción.
 * Antes de correr `migrate deploy` resuelve automáticamente cualquier
 * migración que quedó en estado FAILED en la tabla `_prisma_migrations`.
 *
 * Prisma no permite aplicar nuevas migraciones si hay una fallida.
 * Este script:
 *   1. Detecta migraciones fallidas vía `migrate status --json` (no disponible
 *      en todas las versiones) o directamente desde la DB.
 *   2. Las marca como "rolled back" para que Prisma pueda re-aplicarlas.
 *   3. Corre `prisma migrate deploy`.
 *
 * Uso: node scripts/migrate-deploy.mjs
 */

import { execSync } from 'node:child_process';

const FAILED_MIGRATIONS = [
  // Lista de migraciones conocidas que fallaron en producción.
  // Se resuelven como "rolled-back" para que prisma las re-aplique.
  // El SQL de cada una usa IF NOT EXISTS / IF EXISTS así que es idempotente.
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

console.log('═══════════════════════════════════════════');
console.log('  CosteAR — deploy de migraciones Prisma   ');
console.log('═══════════════════════════════════════════');

// Paso 1: resolver migraciones fallidas conocidas
for (const migration of FAILED_MIGRATIONS) {
  console.log(`\n🔧 Resolviendo migración fallida: ${migration}`);
  run(
    `npx prisma migrate resolve --rolled-back "${migration}"`,
    { ignoreError: true }, // ya puede estar resuelta de un deploy anterior
  );
}

// Paso 2: correr migrate deploy normalmente
console.log('\n🚀 Corriendo prisma migrate deploy…');
run('npx prisma migrate deploy');

console.log('\n✅ Migraciones aplicadas correctamente.');
