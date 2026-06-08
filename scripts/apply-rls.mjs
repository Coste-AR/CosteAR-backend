// Aplica las políticas de Row-Level Security (prisma/rls.sql) a la base.
// Ejecutar después de las migraciones: `node scripts/apply-rls.mjs`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, '..', 'prisma', 'rls.sql'), 'utf8');

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
  console.error('Error aplicando RLS:', err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
