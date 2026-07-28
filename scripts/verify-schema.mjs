#!/usr/bin/env node
/**
 * verify-schema.mjs
 *
 * Comprueba que TODAS las tablas que el código espera existan de verdad en la
 * base. Corre después de las migraciones, antes de levantar el servidor.
 *
 * Por qué existe
 * --------------
 * El 28/07/2026 la app estuvo sirviendo tráfico con `audit_logs` inexistente.
 * La migración `init` había creado nueve tablas y muerto justo antes de la
 * décima, pero `_prisma_migrations` la daba por aplicada. Resultado:
 *
 *   · `prisma migrate deploy` decía "no pending migrations" y salía 0.
 *   · `/health` respondía 200.
 *   · Y las 38 llamadas a `recordAudit()` tiraban 500 — login, alta de
 *     empresas, cálculo de estructuras, cierre de períodos. Todo.
 *
 * Nadie se enteró hasta que un usuario no pudo entrar. Un chequeo de
 * migraciones NO alcanza: Prisma creía que estaba todo bien. Hay que mirar la
 * base.
 *
 * Por qué solo tablas y no drift completo
 * ---------------------------------------
 * `prisma migrate diff` detectaría también diferencias de columnas, pero este
 * repo tiene drift cosmético conocido y aceptado (defaults de uuid, los índices
 * `tsvector`/`ivfflat` de vault_chunks que Prisma no modela — ver DECISIONES.md).
 * Un chequeo de drift total bloquearía todos los deploys por ruido.
 *
 * Una tabla faltante, en cambio, nunca es benigna.
 *
 * Uso: node scripts/verify-schema.mjs   → sale 0 si está todo, 1 si falta algo.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Tablas esperadas = los `@@map("...")` del schema. Los 39 modelos lo tienen. */
function tablasEsperadas() {
  const schema = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
  const nombres = [...schema.matchAll(/@@map\("([^"]+)"\)/g)].map((m) => m[1]);
  return [...new Set(nombres)].sort();
}

async function main() {
  const esperadas = tablasEsperadas();
  if (esperadas.length === 0) {
    console.error('[verify-schema] No se encontró ningún @@map en schema.prisma — ¿cambió el formato?');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  let existentes;
  try {
    const filas = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `;
    existentes = new Set(filas.map((f) => f.table_name));
  } catch (err) {
    console.error('[verify-schema] No se pudo consultar la base:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }

  const faltantes = esperadas.filter((t) => !existentes.has(t));

  if (faltantes.length === 0) {
    console.log(`[verify-schema] OK — las ${esperadas.length} tablas del schema existen en la base.`);
    process.exit(0);
  }

  console.error('');
  console.error('═══════════════════════════════════════════════════════════');
  console.error('  ESQUEMA INCOMPLETO — la base NO tiene todo lo que el');
  console.error('  código necesita. El servidor NO va a arrancar.');
  console.error('═══════════════════════════════════════════════════════════');
  console.error('');
  console.error(`Faltan ${faltantes.length} de ${esperadas.length} tablas:`);
  for (const t of faltantes) console.error(`  · ${t}`);
  console.error('');
  console.error('Ojo: `prisma migrate status` puede decir que está todo aplicado.');
  console.error('Que la migración figure aplicada no garantiza que haya corrido entera.');
  console.error('');
  console.error('Para resolverlo, contra la base afectada:');
  console.error('  1. npx prisma migrate status            (ver el estado real)');
  console.error('  2. crear a mano lo que falte, tomando el DDL de la migración');
  console.error('     correspondiente en prisma/migrations/');
  console.error('  3. volver a desplegar');
  console.error('');
  process.exit(1);
}

main().catch((err) => {
  console.error('[verify-schema] Error inesperado:', err);
  process.exit(1);
});
