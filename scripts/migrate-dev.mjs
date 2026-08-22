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

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');

// Deriva preexistente conocida (issue #72): sentencias que Prisma genera SIEMPRE por no poder
// modelar columnas generadas ni índices sobre tipos Unsupported.
// Cada objeto tiene: { pattern: RegExp, reason: string }
// El pattern se evalúa contra el bloque completo (puede ser multi-línea con flag 's').
const DRIFT_PATTERNS = [
  {
    pattern: /DROP INDEX "vault_chunks_embedding_idx"/s,
    reason: 'índice HNSW de embedding semántico (vault_chunks_embedding_idx)',
  },
  {
    pattern: /DROP INDEX "vault_chunks_content_tsv_idx"/s,
    reason: 'índice GIN full-text de la bóveda (vault_chunks_content_tsv_idx)',
  },
  {
    pattern: /DROP INDEX "data_entries_uploadedBy_idx"/s,
    reason: 'índice data_entries_uploadedBy_idx (deriva preexistente)',
  },
  {
    pattern: /ALTER TABLE "vault_chunks"[\s\S]*?"contentTsv"/s,
    reason: 'ALTER sobre columna generada vault_chunks.contentTsv',
  },
  {
    pattern: /ALTER TABLE "cost_config_versions" DROP CONSTRAINT "cost_config_versions_structureId_fkey"/s,
    reason: 'DROP CONSTRAINT cost_config_versions_structureId_fkey (deriva preexistente)',
  },
  {
    pattern: /ALTER TABLE "allocation_base_values"[\s\S]*?"id" DROP DEFAULT/s,
    reason: 'DROP DEFAULT en allocation_base_values.id (deriva preexistente)',
  },
  {
    pattern: /ALTER TABLE "allocation_bases"[\s\S]*?"id" DROP DEFAULT/s,
    reason: 'DROP DEFAULT en allocation_bases.id (deriva preexistente)',
  },
  {
    pattern: /ALTER TABLE "cost_config_versions"[\s\S]*?"id" DROP DEFAULT/s,
    reason: 'DROP DEFAULT en cost_config_versions.id (deriva preexistente)',
  },
  {
    pattern: /ALTER TABLE "cost_periods"[\s\S]*?"id" DROP DEFAULT/s,
    reason: 'DROP DEFAULT en cost_periods.id (deriva preexistente)',
  },
  {
    pattern: /ALTER TABLE "cost_periods"[\s\S]*?"updatedAt" DROP DEFAULT/s,
    reason: 'DROP DEFAULT en cost_periods.updatedAt (deriva preexistente)',
  },
];

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

// 3. Filtrar deriva: separar en bloques por líneas en blanco, filtrar los que
//    coincidan con patrones de deriva, reconstruir el SQL limpio.
const rawBlocks = original.split(/\n\n+/);
const cleanBlocks = [];
const warnings = [];

for (const block of rawBlocks) {
  const trimmed = block.trim();
  if (!trimmed) continue;

  const matched = DRIFT_PATTERNS.find(({ pattern }) => pattern.test(trimmed));
  if (matched) {
    warnings.push(matched.reason);
  } else {
    cleanBlocks.push(block);
  }
}

// 4. Si se filtró algo, guardar el SQL limpio con encabezado explicativo
if (warnings.length > 0) {
  const header = [
    `-- Generado por scripts/migrate-dev.mjs — issue #72`,
    `-- Se filtraron ${warnings.length} sentencia(s) de deriva preexistente:`,
    ...warnings.map((r) => `--   · ${r}`),
    `-- ADITIVA (DOM-06): solo CREATE/ALTER ADD. Sin DROPs sobre tablas con datos.`,
    '',
  ].join('\n');

  writeFileSync(sqlPath, header + cleanBlocks.join('\n\n'), 'utf8');

  console.log(`\n⚠  Deriva filtrada (${warnings.length} sentencia(s)):`);
  warnings.forEach((r) => console.log(`   · ${r}`));
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
