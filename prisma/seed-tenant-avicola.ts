// Seed de un tenant del vertical avícola.
//
// Uso:
//   tsx --env-file=.env prisma/seed-tenant-avicola.ts --company <uuid> [--structure <uuid>]
//   tsx --env-file=.env prisma/seed-tenant-avicola.ts --company <uuid> --dry-run
//
// QUÉ HACE Y QUÉ NO
// -----------------
// Carga las unidades de medida y los parámetros de costeo del rubro para una
// empresa que YA EXISTE.
//
// **No crea la empresa ni el usuario.** Es a propósito: un tenant de un cliente
// real se da de alta por el flujo normal de la aplicación, con su usuario, su
// invitación y su rastro de auditoría. Un script que inventa una empresa deja un
// registro que nadie decidió y que no se parece a los demás.
//
// Es IDEMPOTENTE: se puede correr las veces que haga falta. Solo agrega lo que
// falta y nunca pisa un valor que alguien haya confirmado.
//
// El relevamiento del cliente y sus cifras viven en el repo privado (CLI-02).

import { PrismaClient, Prisma } from '@prisma/client';
import { PARAMETROS_AVICOLA } from '../src/domain/parametros/parametros-costeo.js';

const prisma = new PrismaClient();


/**
 * Unidades del negocio. El orden importa: cada una referencia a su base, así que
 * la base tiene que existir antes.
 *
 * `factor` es cuántas unidades BASE entran en una de ésta.
 */
const UNIDADES = [
  { codigo: 'huevo', nombre: 'Huevo', base: null, factor: 1 },
  { codigo: 'maple', nombre: 'Maple (30 huevos)', base: 'huevo', factor: 30 },
  { codigo: 'cajon', nombre: 'Cajón de huevo (360 huevos)', base: 'huevo', factor: 360 },
  { codigo: 'ave', nombre: 'Ave (gallina ponedora)', base: null, factor: 1 },
  { codigo: 'kg', nombre: 'Kilogramo', base: null, factor: 1 },
  { codigo: 'tn', nombre: 'Tonelada', base: 'kg', factor: 1000 },
] as const;

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const companyId = arg('company');
  const structureId = arg('structure') ?? null;
  const dryRun = process.argv.includes('--dry-run');

  if (!companyId) {
    throw new Error(
      'Falta --company <uuid>.\n\n' +
        'Este seed configura una empresa que ya existe; no la crea. Dala de alta por el ' +
        'flujo normal de la aplicación y volvé con su id.',
    );
  }

  const empresa = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, userId: true },
  });

  if (!empresa) {
    throw new Error(`No existe una empresa con id ${companyId}.`);
  }

  console.log(`Empresa: ${empresa.name} (${empresa.id})`);
  console.warn(
    '⚠  Verificá que sea la empresa correcta: esto carga parámetros del rubro avícola.',
  );
  if (dryRun) console.log('— dry-run: no se escribe nada —');

  const userId = empresa.userId;

  // --- Unidades de medida -------------------------------------------------
  const idPorCodigo = new Map<string, string>();
  let unidadesNuevas = 0;

  for (const u of UNIDADES) {
    const existente = await prisma.unidadMedida.findFirst({
      where: { companyId, codigo: u.codigo, deletedAt: null },
      select: { id: true },
    });

    if (existente) {
      idPorCodigo.set(u.codigo, existente.id);
      continue;
    }

    if (dryRun) {
      console.log(`  + unidad ${u.codigo} (${u.nombre}) ×${u.factor}`);
      idPorCodigo.set(u.codigo, `dry-${u.codigo}`);
      unidadesNuevas++;
      continue;
    }

    const creada = await prisma.unidadMedida.create({
      data: {
        companyId,
        userId,
        codigo: u.codigo,
        nombre: u.nombre,
        factor: new Prisma.Decimal(u.factor),
        baseId: u.base ? (idPorCodigo.get(u.base) ?? null) : null,
      },
      select: { id: true },
    });
    idPorCodigo.set(u.codigo, creada.id);
    unidadesNuevas++;
  }

  console.log(`Unidades: ${unidadesNuevas} nueva(s), ${UNIDADES.length - unidadesNuevas} ya estaban`);

  // --- Parámetros de costeo ------------------------------------------------
  // Se cargan a nivel EMPRESA (structureId null) salvo que se pase --structure.
  // Nunca se pisa un parámetro ya confirmado: si alguien lo revisó con el
  // cliente, ese valor gana sobre el default del catálogo.
  let creados = 0;
  let respetados = 0;

  for (const def of PARAMETROS_AVICOLA) {
    const existente = await prisma.parametroCosteo.findFirst({
      where: { companyId, structureId, periodId: null, clave: def.clave, deletedAt: null },
      select: { id: true, confirmado: true },
    });

    if (existente) {
      respetados++;
      if (existente.confirmado) {
        console.log(`  = ${def.clave} — ya confirmado, no se toca`);
      }
      continue;
    }

    if (dryRun) {
      console.log(`  + ${def.clave} = ${def.valorDefault}${def.seguro ? '' : '  (sin confirmar)'}`);
      creados++;
      continue;
    }

    await prisma.parametroCosteo.create({
      data: {
        companyId,
        userId,
        structureId,
        periodId: null,
        clave: def.clave,
        valorNum: new Prisma.Decimal(def.valorDefault),
        unidadId: def.unidad ? (idPorCodigo.get(def.unidad) ?? null) : null,
        descripcion: def.nota ? `${def.descripcion} — ${def.nota}` : def.descripcion,
        // NUNCA se marca confirmado desde un seed. Confirmado significa que lo
        // dijo el cliente, y un script no habló con nadie.
        confirmado: false,
      },
    });
    creados++;
  }

  console.log(`Parámetros: ${creados} nuevo(s), ${respetados} ya estaban`);

  const sinConfirmar = PARAMETROS_AVICOLA.filter((p) => !p.seguro);
  console.log(`\n⚠  ${sinConfirmar.length} parámetros quedan SIN CONFIRMAR y hay que cerrarlos con el cliente:`);
  for (const p of sinConfirmar) {
    console.log(`   · ${p.clave} = ${p.valorDefault} — ${p.nota}`);
  }
  console.log(
    '\nMientras sigan sin confirmar, el costo que salga es una estimación con los ' +
      'supuestos del relevamiento, no el costo real de la empresa.',
  );
}

main()
  .catch((e) => {
    console.error(`\n✖ ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
