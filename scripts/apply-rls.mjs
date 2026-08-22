// Aplica las políticas de Row-Level Security (prisma/rls.sql) a la base.
// Ejecutar después de las migraciones: `node scripts/apply-rls.mjs`.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const sql = readFileSync(join(ROOT, 'prisma', 'rls.sql'), 'utf8');

// A diferencia del CLI de Prisma, este script usa PrismaClient directo y NADIE
// le carga el .env. Sin esto, correrlo en local tiraba "Environment variable not
// found: DATABASE_URL" y —peor— salía con éxito: el dev se quedaba sin políticas
// RLS creyendo que las había aplicado. En una app multi-tenant eso es un agujero
// de aislamiento entre inquilinos, no un detalle.
if (!process.env.DATABASE_URL) {
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

if (!process.env.DATABASE_URL) {
  console.error(
    '✖ No se puede aplicar RLS: falta DATABASE_URL.\n' +
      `  Definila en el entorno o en ${join(ROOT, '.env')} (ver .env.example) y volvé a correr.`,
  );
  process.exit(1);
}

// Prisma no acepta múltiples comandos en una sola llamada (prepared statement),
// así que separamos por ';' y ejecutamos cada statement por separado.
// Se respeta el cuerpo de funciones $$...$$ para no cortar la función SQL.
function splitStatements(input) {
  const noComments = input
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const statements = [];
  let current = '';
  let inDollar = false;
  for (const part of noComments.split(/(\$\$)/)) {
    if (part === '$$') {
      inDollar = !inDollar;
      current += part;
      continue;
    }
    if (inDollar) {
      current += part;
      continue;
    }
    const segments = part.split(';');
    for (let i = 0; i < segments.length; i++) {
      current += segments[i];
      if (i < segments.length - 1) {
        if (current.trim()) statements.push(current.trim());
        current = '';
      }
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const prisma = new PrismaClient();
try {
  const statements = splitStatements(sql);
  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
  }
  console.info(`✔ Políticas RLS aplicadas (${statements.length} statements)`);
} catch (err) {
  // El script SÍ falla: quien lo corre a mano (`npm run db:rls`, `db:setup`)
  // tiene que enterarse de que la base quedó SIN aislamiento entre inquilinos.
  // Que el arranque del servidor tolere el fallo es una decisión de `entry.ts`,
  // que ignora este código a propósito para no dejar la app caída — pero ahora
  // lo registra en vez de tragárselo.
  console.error('✖ NO se aplicaron las políticas RLS:', err?.message ?? err);
  console.error('  La base quedó SIN aislamiento entre inquilinos. Resolvé esto antes de usarla.');
  await prisma.$disconnect();
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
