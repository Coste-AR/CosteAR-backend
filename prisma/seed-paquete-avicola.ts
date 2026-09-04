import { PrismaClient } from '@prisma/client';
import { CATEGORIA_AVICOLA_POSTURA, PAQUETE_AVICOLA_POSTURA } from '../src/application/operacion/paquete-avicola.js';

const prisma = new PrismaClient();

/** Inserta el paquete global una vez; nunca lo actualiza ni pisa overrides. */
export async function seedPaqueteAvicola(db: PrismaClient = prisma) {
  const existente = await db.paqueteRubro.findFirst({
    where: { category: CATEGORIA_AVICOLA_POSTURA, companyId: null, structureId: null, periodId: null, userId: null },
  });
  if (existente) return { created: false, paquete: existente };
  const paquete = await db.paqueteRubro.create({
    data: { category: CATEGORIA_AVICOLA_POSTURA, companyId: null, structureId: null, periodId: null, userId: null, ...PAQUETE_AVICOLA_POSTURA },
  });
  return { created: true, paquete };
}

/** Carga sólo valores faltantes: una decisión existente jamás la pisa un seed. */
export async function aplicarParametrosSemilla(
  db: PrismaClient,
  input: { companyId: string; userId: string },
) {
  let creados = 0;
  for (const parametro of PAQUETE_AVICOLA_POSTURA.seedParameters) {
    const existente = await db.parametroCosteo.findFirst({
      where: { companyId: input.companyId, structureId: null, periodId: null, clave: parametro.clave, deletedAt: null },
    });
    if (existente) continue;
    await db.parametroCosteo.create({
      data: { companyId: input.companyId, userId: input.userId, clave: parametro.clave, valorNum: parametro.valor, confirmado: false },
    });
    creados++;
  }
  return { creados };
}

if (process.argv[1]?.endsWith('seed-paquete-avicola.ts')) {
  seedPaqueteAvicola().finally(() => prisma.$disconnect());
}
