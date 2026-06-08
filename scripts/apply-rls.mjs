// Aplica las políticas de Row-Level Security (prisma/rls.sql) a la base.
// Ejecutar después de las migraciones: `node scripts/apply-rls.mjs`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, '..', 'prisma', 'rls.sql'), 'utf8');

const prisma = new PrismaClient();
try {
  await prisma.$executeRawUnsafe(sql);
  console.info('✔ Políticas RLS aplicadas');
} catch (err) {
  console.error('Error aplicando RLS:', err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
