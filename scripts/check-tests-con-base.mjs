#!/usr/bin/env node
/**
 * GUARDA: ningún test que necesite base puede quedar sin correr.
 *
 * Busca todos los `tests/**\/*.test.ts` que se apoyan en `process.env.DATABASE_URL`
 * y verifica que cada uno esté listado en `tests/db-dependent.mjs`. Si falta uno,
 * falla — porque un archivo así, fuera de las listas, se saltea en silencio en
 * las dos suites y nadie se entera.
 *
 * Esto no es hipotético: es exactamente lo que pasó hasta el 15-08-2026. Cinco
 * archivos, 61 tests, sin correr en ningún lado, con el CI en verde. Entre ellos
 * los 34 que verifican que una empresa no vea los datos de otra.
 *
 * Corre en CI antes de los tests. También podés correrlo a mano:
 *   node scripts/check-tests-con-base.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TESTS_CON_BASE } from '../tests/db-dependent.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_TESTS = join(RAIZ, 'tests');

/** Convierte un glob simple (`**`, `*`) en RegExp. Alcanza para estos patrones. */
function globARegExp(glob) {
  const escapado = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000') // marcador temporal para `**/`
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?');
  return new RegExp(`^${escapado}$`);
}

const PATRONES = TESTS_CON_BASE.map(globARegExp);

/** Lista recursiva de archivos `.test.ts` bajo `tests/`, en rutas tipo POSIX. */
function listarTests(dir) {
  const salida = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...listarTests(ruta));
    else if (entrada.name.endsWith('.test.ts')) {
      salida.push(relative(RAIZ, ruta).split('\\').join('/'));
    }
  }
  return salida;
}

/**
 * ¿El archivo LEE `DATABASE_URL`, o solo la ASIGNA?
 *
 * Varios tests hacen `process.env.DATABASE_URL = 'postgresql://u:p@...'` con un
 * valor de mentira, nada más que para que el módulo instancie su cliente al
 * importarlo. Esos no necesitan base y no van en las listas. Los que sí la
 * necesitan la LEEN, para decidir si saltearse o para conectarse:
 *
 *     if (!process.env.DATABASE_URL) ...
 *     const ADMIN_URL = process.env.DATABASE_URL;
 *     const HAY_BASE = Boolean(process.env.DATABASE_URL);
 *
 * Se ignoran los comentarios para no contar menciones en la documentación.
 */
function leeLaBase(codigo) {
  const sinComentarios = codigo
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // Una lectura es toda mención que NO esté seguida de `=` de asignación.
  // El lookahead se pone pegado al token y consume los espacios adentro: si se
  // escribe `\s*(?!=...)`, el `\s*` retrocede a cero caracteres y el lookahead
  // pasa siempre, dando por lectura hasta las asignaciones.
  return /process\.env\.DATABASE_URL(?!\s*=[^=])/.test(sinComentarios);
}

const huerfanos = listarTests(DIR_TESTS).filter((archivo) => {
  const codigo = readFileSync(join(RAIZ, archivo), 'utf8');
  if (!leeLaBase(codigo)) return false;
  return !PATRONES.some((re) => re.test(archivo));
});

if (huerfanos.length > 0) {
  console.error('\n✗ Hay tests que necesitan base y no están en ninguna suite:\n');
  for (const archivo of huerfanos) console.error(`    ${archivo}`);
  console.error(
    '\n  Estos archivos usan `process.env.DATABASE_URL`, así que se saltean solos\n' +
      '  cuando no hay base. Como no están en `tests/db-dependent.mjs`, tampoco los\n' +
      '  incluye la suite de integración: no corren en ningún lado y el CI queda verde.\n' +
      '\n  Agregalos a `tests/db-dependent.mjs`, en la lista que corresponda:\n' +
      '    CON_ROL_DE_APP  si verifican RLS y deben correr SIN BYPASSRLS\n' +
      '    CON_ROL_DUENO   si siembran sus fixtures con SQL crudo\n',
  );
  process.exit(1);
}

console.log('✓ Todos los tests que necesitan base están en alguna suite.');
