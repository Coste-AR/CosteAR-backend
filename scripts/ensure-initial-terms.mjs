// Garantiza que exista una TermsVersion activa antes de aceptar tráfico.
// Idempotente: si ya hay una versión activa, no hace nada. Corre en cada
// boot (mismo patrón que apply-rls.mjs) porque es la única forma de
// garantizar, sin intervención manual, que un ambiente nuevo (o resetado)
// nunca deje pasar un registro/login sin términos vigentes — el service
// (`terms-service.ts`) tira error si `requireCurrentVersion()` no encuentra
// ninguna, y eso frenaría TODO el registro/login, no solo lo nuevo.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

if (!process.env.DATABASE_URL) {
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

if (!process.env.DATABASE_URL) {
  console.error('✖ No se puede sembrar Términos y Condiciones: falta DATABASE_URL.');
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const existing = await prisma.termsVersion.findFirst({ where: { isActive: true } });
  if (existing) {
    console.log(`[terms] Ya hay una versión activa (v${existing.version}) — nada que hacer.`);
  } else {
    const contentPath = join(ROOT, 'prisma', 'initial-terms.md');
    const content = readFileSync(contentPath, 'utf8');
    const created = await prisma.termsVersion.create({
      data: { version: 1, content, isActive: true },
    });
    console.log(`[terms] Sembrada la versión inicial (v${created.version}).`);
  }
} catch (err) {
  console.error('[terms] No se pudo sembrar la versión inicial:', err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
