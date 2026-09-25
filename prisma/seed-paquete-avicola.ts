import { PrismaClient } from '@prisma/client';
import { CATEGORIA_AVICOLA_POSTURA, PAQUETE_AVICOLA_POSTURA } from '../src/application/operacion/paquete-avicola.js';
import { CATEGORIA_CONSTRUCCION_MODULAR, PAQUETE_CONSTRUCCION_MODULAR } from '../src/application/operacion/paquete-construccion-modular.js';

const prisma = new PrismaClient();

/** Inserta el paquete global una vez; actualiza sólo declaraciones del sistema, nunca overrides de tenant. */
export async function seedPaqueteAvicola(db: PrismaClient = prisma) {
  const existente = await db.paqueteRubro.findFirst({
    where: { category: CATEGORIA_AVICOLA_POSTURA, companyId: null, structureId: null, periodId: null, userId: null },
  });
  if (existente) {
    const paquete = await db.paqueteRubro.update({
      where: { id: existente.id },
      // Sólo se sincronizan declaraciones globales del paquete; los estados
      // por empresa viven en `ConfiguracionModuloRubro` y no se pisan aquí.
      data: {
        lexicon: PAQUETE_AVICOLA_POSTURA.lexicon,
        nombreProducto: PAQUETE_AVICOLA_POSTURA.nombreProducto,
        nombreProductoConfirmado: PAQUETE_AVICOLA_POSTURA.nombreProductoConfirmado,
        icons: PAQUETE_AVICOLA_POSTURA.icons,
        variants: PAQUETE_AVICOLA_POSTURA.variants,
        seedParameters: PAQUETE_AVICOLA_POSTURA.seedParameters,
        alertRules: PAQUETE_AVICOLA_POSTURA.alertRules,
        screens: PAQUETE_AVICOLA_POSTURA.screens,
        modulos: PAQUETE_AVICOLA_POSTURA.modulos,
      },
    });
    return { created: false, paquete };
  }
  const paquete = await db.paqueteRubro.create({
    data: { category: CATEGORIA_AVICOLA_POSTURA, companyId: null, structureId: null, periodId: null, userId: null, ...PAQUETE_AVICOLA_POSTURA },
  });
  return { created: true, paquete };
}

/** Inserta o sincroniza sólo la declaración global del paquete de construcción modular. */
export async function seedPaqueteConstruccionModular(db: PrismaClient = prisma) {
  const alcance = {
    category: CATEGORIA_CONSTRUCCION_MODULAR,
    companyId: null,
    structureId: null,
    periodId: null,
    userId: null,
  };
  const existente = await db.paqueteRubro.findFirst({ where: alcance });
  const data = {
    nombreProducto: PAQUETE_CONSTRUCCION_MODULAR.nombreProducto,
    nombreProductoConfirmado: PAQUETE_CONSTRUCCION_MODULAR.nombreProductoConfirmado,
    lexicon: PAQUETE_CONSTRUCCION_MODULAR.lexicon,
    icons: PAQUETE_CONSTRUCCION_MODULAR.icons,
    access: PAQUETE_CONSTRUCCION_MODULAR.access,
    variants: PAQUETE_CONSTRUCCION_MODULAR.variants,
    seedParameters: PAQUETE_CONSTRUCCION_MODULAR.seedParameters,
    alertRules: PAQUETE_CONSTRUCCION_MODULAR.alertRules,
    screens: PAQUETE_CONSTRUCCION_MODULAR.screens,
    modulos: PAQUETE_CONSTRUCCION_MODULAR.modulos,
  };
  const paquete = existente
    ? await db.paqueteRubro.update({ where: { id: existente.id }, data })
    : await db.paqueteRubro.create({ data: { ...alcance, ...data } });
  return { created: !existente, paquete };
}

/** Carga sólo valores faltantes: una decisión existente jamás la pisa un seed. */
export async function aplicarParametrosSemilla(
  db: PrismaClient,
  input: { companyId: string; userId: string },
) {
  let creados = 0;
  for (const parametro of PAQUETE_AVICOLA_POSTURA.seedParameters) {
    // Las preguntas de opción no reciben una respuesta inventada por el seed.
    // Sólo los parámetros numéricos con default se materializan como filas.
    if (!('valor' in parametro)) continue;
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
  Promise.all([seedPaqueteAvicola(), seedPaqueteConstruccionModular()])
    .finally(() => prisma.$disconnect());
}
