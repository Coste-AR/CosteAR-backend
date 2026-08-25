#!/usr/bin/env node
/**
 * migrate-dev.mjs
 *
 * Reemplaza `npx prisma migrate dev` en el flujo de desarrollo local.
 *
 * PROBLEMA: vault_chunks tiene una columna generada (contentTsv tsvector GENERATED ALWAYS AS)
 * y dos índices (HNSW sobre embedding, GIN sobre contentTsv) que Prisma no puede modelar en
 * el schema. Cada vez que Prisma genera una migración nueva, incluye sentencias DROP sobre esos
 * objetos que romperían el RAG si se aplicaran. Desde agosto 2026 se venía filtrando a mano.
 * Este script automatiza ese paso. Ver issue #72.
 *
 * FASE 3 (issue #72): de las 10 sentencias que se filtraban, 7 no eran un límite de Prisma
 * sino schema desactualizado — la base tenía DEFAULTs, un índice y una FK que el schema no
 * declaraba. Se cerraron declarándolos. Quedan las 3 de vault_chunks, que sí son estructurales.
 * Las 7 cerradas ya no se filtran: si reaparecen, el script ABORTA (ver scripts/lib/filtrar-deriva.mjs).
 *
 * Uso:
 *   node scripts/migrate-dev.mjs <nombre-de-migración>
 *   npm run prisma:migrate <nombre>          ← alias en package.json
 *
 * Flujo:
 *   1. prisma migrate dev --create-only --name <nombre>  → genera el SQL sin aplicar
 *   2. Lee el SQL y filtra las sentencias de deriva conocida
 *   3. Guarda el SQL limpio y muestra qué se filtró
 *   4. prisma migrate deploy                             → aplica la migración limpia
 *   5. prisma generate                                   → regenera el cliente
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { filtrarDeriva } from './lib/filtrar-deriva.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');

function run(cmd) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

function newestMigrationDir() {
  const entries = readdirSync(MIGRATIONS_DIR)
    .filter((d) => /^\d{14}_/.test(d))
    .map((d) => ({ name: d, mtime: statSync(join(MIGRATIONS_DIR, d)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0]?.name ?? null;
}

// ── main ──────────────────────────────────────────────────────────────────────

const name = process.argv[2];
if (!name) {
  console.error('Error: falta el nombre de la migración.');
  console.error('Uso: npm run prisma:migrate <nombre>');
  process.exit(1);
}

// 1. Generar el SQL sin aplicar
run(`npx prisma migrate dev --create-only --name ${name}`);

// 2. Localizar el archivo recién creado
const migDir = newestMigrationDir();
if (!migDir) {
  console.error('No se encontró ninguna carpeta de migración en prisma/migrations/.');
  process.exit(1);
}

const sqlPath = join(MIGRATIONS_DIR, migDir, 'migration.sql');
const original = readFileSync(sqlPath, 'utf8');

// 3. Decidir qué se filtra y qué aborta (lógica pura, testeada sin base ni red)
const { sql: limpio, filtradas, reabiertas } = filtrarDeriva(original);

// 3.bis Deriva que la Fase 3 cerró y volvió a aparecer: se para acá.
//       Filtrarla en silencio es lo que la mantuvo viva durante meses.
if (reabiertas.length > 0) {
  console.error(`\n⛔ Reapareció deriva que estaba cerrada (${reabiertas.length}):\n`);
  reabiertas.forEach(({ reason, cerradaCon }) => {
    console.error(`   · ${reason}`);
    console.error(`     se había cerrado con: ${cerradaCon}`);
  });
  console.error(`\n   Significa que el schema volvió a separarse de la base.`);
  console.error(`   La migración quedó SIN aplicar en:`);
  console.error(`   ${sqlPath}`);
  console.error(`\n   Arreglá el schema y volvé a correr. No filtres esto a mano.\n`);
  process.exit(1);
}

// 4. Si se filtró deriva estructural, guardar el SQL limpio con encabezado explicativo
if (filtradas.length > 0) {
  const header = [
    `-- Generado por scripts/migrate-dev.mjs — issue #72`,
    `-- Se filtraron ${filtradas.length} sentencia(s) de deriva ESTRUCTURAL (Prisma no las modela):`,
    ...filtradas.map((r) => `--   · ${r}`),
    `-- ADITIVA (DOM-06): solo CREATE/ALTER ADD. Sin DROPs sobre tablas con datos.`,
    '',
  ].join('\n');

  writeFileSync(sqlPath, header + limpio, 'utf8');

  console.log(`\n⚠  Deriva estructural filtrada (${filtradas.length} sentencia(s)):`);
  filtradas.forEach((r) => console.log(`   · ${r}`));
  console.log(`\n   SQL limpio guardado en:`);
  console.log(`   ${sqlPath}`);
  console.log(`\n   Revisalo antes de continuar. Si algo no tiene sentido, no mergees.\n`);
} else {
  console.log('\n✓ Sin deriva detectada. La migración no fue modificada.');
}

// 5. Aplicar la migración limpia (deploy es no-interactivo, igual que en producción)
run('npx prisma migrate deploy');

// 6. Regenerar el cliente Prisma
run('npx prisma generate');

console.log('\n✅ Migración aplicada correctamente.');
console.log(`   ${migDir}`);
