/**
 * DIAGNÓSTICO PRE-DEPLOY DE MIGRACIONES — solo LECTURA.
 *
 * Prisma bloquea todos los deploys si hay UNA migración marcada como fallida
 * (P3009). `migrate-deploy.mjs` resuelve el caso común marcándolas como
 * `rolled-back` para que se re-apliquen, y su propio encabezado documenta el
 * límite:
 *
 *   > si una migración fallida dejó objetos a medias (tablas/tipos ya creados)
 *   > y NO es idempotente, el re-apply puede volver a fallar con "already exists".
 *
 * Ese límite dejó de ser teórico. El 21-08, en la base de desarrollo,
 * `20260818031500_activos_amortizables_y_desperdicio` figuraba **iniciada y
 * nunca terminada** desde el 19-08 — y sin embargo TODOS sus objetos existían:
 * las tablas `activos_amortizables` y `desperdicio_registros`, el tipo
 * `NaturalezaDesperdicio` y sus columnas. Se había aplicado y quedó mal
 * registrada. Re-aplicarla habría fallado con `type ... already exists`.
 *
 * Este script contesta la pregunta que hay que hacerse ANTES de deployar:
 *
 *   ¿la migración fallida dejó algo hecho, o no dejó nada?
 *
 * Según la respuesta, la acción correcta es la OPUESTA en cada caso:
 *
 *   · No dejó nada          → `--rolled-back` y re-aplicar (lo que ya hace
 *                             `migrate-deploy.mjs`: no hace falta tocar nada).
 *   · Dejó TODO             → `--applied`. Marcarla rolled-back la haría
 *                             reintentar y fallar.
 *   · Dejó una PARTE        → limpieza a mano. No automatizar: hay que mirar
 *                             qué quedó y decidir.
 *
 * NO MODIFICA NADA. Solo mira y recomienda. La decisión de correr un `resolve`
 * sobre una base con datos es de una persona, no de un script.
 *
 * Uso:
 *   node scripts/check-migrations.mjs
 *   DATABASE_URL=<url de staging> node scripts/check-migrations.mjs
 *
 * Salida: código 0 si no hay nada que decidir; 1 si hay una migración fallida
 * que requiere una decisión (sirve para frenar un pipeline).
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL (o MIGRATION_DATABASE_URL) para poder mirar la base.');
  process.exit(2);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Objetos que una migración dice crear, leídos de su propio SQL. */
function objetosQueCrea(nombre) {
  const sqlPath = join(MIGRATIONS_DIR, nombre, 'migration.sql');
  if (!existsSync(sqlPath)) return null; // migración registrada que ya no está en el repo
  const sql = readFileSync(sqlPath, 'utf-8')
    // Los comentarios mencionan objetos a propósito (para explicar qué se filtró
    // y por qué). Si no se sacaran, el diagnóstico leería esas menciones como
    // sentencias reales y daría un veredicto equivocado.
    .replace(/^\s*--.*$/gm, '');

  const tablas = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"/gi)].map((m) => m[1]);
  const tipos = [...sql.matchAll(/CREATE TYPE "([^"]+)"/gi)].map((m) => m[1]);
  const columnas = [...sql.matchAll(/ALTER TABLE "([^"]+)"\s+ADD COLUMN (?:IF NOT EXISTS )?"([^"]+)"/gi)]
    .map((m) => ({ tabla: m[1], columna: m[2] }));

  return { tablas, tipos, columnas };
}

async function existeTabla(nombre) {
  const r = await prisma.$queryRawUnsafe(
    `select 1 from information_schema.tables where table_schema='public' and table_name=$1 limit 1`,
    nombre,
  );
  return r.length > 0;
}

async function existeTipo(nombre) {
  const r = await prisma.$queryRawUnsafe(`select 1 from pg_type where typname=$1 limit 1`, nombre);
  return r.length > 0;
}

async function existeColumna(tabla, columna) {
  const r = await prisma.$queryRawUnsafe(
    `select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2 limit 1`,
    tabla,
    columna,
  );
  return r.length > 0;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  CosteAR — diagnóstico de migraciones (lectura)');
  console.log('═══════════════════════════════════════════════\n');

  // OJO CON EL CRITERIO: Prisma NO borra la fila del intento fallido. Cuando se
  // resuelve una migración, ESCRIBE UNA FILA NUEVA con `finished_at`. O sea que
  // una migración sana puede tener dos filas: la del intento que falló (con
  // `rolled_back_at`) y la de la resolución.
  //
  // Mirar fila por fila daría un falso positivo sobre migraciones ya resueltas
  // —y un diagnóstico de deploy que grita en falso se termina ignorando—. Por
  // eso se agrupa por nombre: una migración está en problemas solo si NINGUNA de
  // sus filas quedó terminada y sin revertir.
  const fallidas = await prisma.$queryRawUnsafe(`
    select migration_name, min(started_at) as started_at,
           max(finished_at) as finished_at, max(rolled_back_at) as rolled_back_at
    from _prisma_migrations
    group by migration_name
    having bool_and(finished_at is null or rolled_back_at is not null)
    order by min(started_at) asc
  `);

  if (fallidas.length === 0) {
    console.log('✅ No hay migraciones fallidas ni marcadas como revertidas.');
    console.log('   El deploy no va a cortar por P3009.\n');
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log(`⚠  ${fallidas.length} migración(es) en estado no-terminado:\n`);

  let hayQueDecidir = false;

  for (const m of fallidas) {
    const nombre = m.migration_name;
    console.log(`── ${nombre}`);
    console.log(`   iniciada: ${m.started_at?.toISOString?.() ?? m.started_at}`);
    console.log(`   terminada: ${m.finished_at ?? 'NUNCA'}`);
    console.log(`   revertida: ${m.rolled_back_at ?? 'no'}`);

    const objetos = objetosQueCrea(nombre);
    if (!objetos) {
      console.log('   ❓ No está su carpeta en prisma/migrations: no se puede saber qué creaba.');
      console.log('      Revisar a mano.\n');
      hayQueDecidir = true;
      continue;
    }

    const checks = [];
    for (const t of objetos.tablas) checks.push({ que: `tabla ${t}`, existe: await existeTabla(t) });
    for (const t of objetos.tipos) checks.push({ que: `tipo ${t}`, existe: await existeTipo(t) });
    for (const c of objetos.columnas) {
      checks.push({ que: `${c.tabla}.${c.columna}`, existe: await existeColumna(c.tabla, c.columna) });
    }

    if (checks.length === 0) {
      console.log('   ❓ No crea tablas, tipos ni columnas (puede ser solo índices o datos).');
      console.log('      Revisar el SQL a mano antes de decidir.\n');
      hayQueDecidir = true;
      continue;
    }

    const existen = checks.filter((c) => c.existe).length;
    for (const c of checks) console.log(`      ${c.existe ? '✔' : '✘'} ${c.que}`);

    if (existen === checks.length) {
      console.log('\n   🟡 YA ESTÁ APLICADA de hecho: todos sus objetos existen.');
      console.log('      Quedó mal registrada. La acción correcta es:');
      console.log(`         npx prisma migrate resolve --applied "${nombre}"`);
      console.log('      ⛔ NO correr migrate-deploy.mjs antes de eso: la marcaría');
      console.log('         rolled-back y la reintentaría → "already exists".\n');
      hayQueDecidir = true;
    } else if (existen === 0) {
      console.log('\n   🟢 No dejó nada hecho: re-aplicarla es seguro.');
      console.log('      Es el caso que `migrate-deploy.mjs` ya resuelve solo.\n');
    } else {
      console.log(`\n   🔴 PARCIAL: existen ${existen} de ${checks.length} objetos.`);
      console.log('      NO automatizar. Hay que mirar qué quedó a medias y limpiarlo');
      console.log('      a mano antes de reintentar.\n');
      hayQueDecidir = true;
    }
  }

  console.log('───────────────────────────────────────────────');
  if (hayQueDecidir) {
    console.log('Hay al menos una migración que requiere una DECISIÓN humana.');
    console.log('No deployar hasta resolverla.');
  } else {
    console.log('Todo lo fallido se puede re-aplicar solo: `migrate-deploy.mjs` alcanza.');
  }

  await prisma.$disconnect();
  process.exit(hayQueDecidir ? 1 : 0);
}

main().catch(async (e) => {
  console.error('El diagnóstico falló:', e.message);
  await prisma.$disconnect();
  process.exit(2);
});
