/**
 * Genera el contrato de respuestas de la API (#282, fase 1).
 *
 * A propósito NO construye la app entera (`buildApp`): eso arrastra Redis y
 * Prisma con `DATABASE_URL` real, que el job liviano de CI no tiene por qué
 * levantar solo para leer un schema. Arma una instancia mínima con el mismo
 * type provider y registra ÚNICAMENTE las rutas que ya declaran
 * `schema.response` — el documento solo describe lo que de verdad está
 * contrastado contra el handler.
 *
 * `check:openapi` corre este mismo script y compara el resultado contra lo
 * commiteado: si no coincide, `openapi/openapi.json` o `openapi/types.d.ts`
 * quedaron desactualizados.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod';
import openapiTS, { astToString } from 'openapi-typescript';
import { registerOwnerDashboardRoutes } from '../src/infrastructure/http/routes/owner-dashboard.routes.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Rutas ya convertidas al contrato tipado. Crece en las próximas fases de #282. */
const CONVERTED_ROUTES = [registerOwnerDashboardRoutes];

async function buildSchemaOnlyApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger, {
    openapi: { openapi: '3.1.0', info: { title: 'CosteAR API', version: '0.1.0' } },
    transform: jsonSchemaTransform,
  });
  for (const register of CONVERTED_ROUTES) {
    await register(app);
  }
  await app.ready();
  return app;
}

async function main() {
  const app = await buildSchemaOnlyApp();
  const document = app.swagger();
  // El orden de claves de `document` es determinista para el mismo código
  // (no depende de un Map/Set ni de iteración no ordenada): misma entrada,
  // mismo JSON, en cada corrida — que es lo que `check:openapi` necesita para
  // comparar por igualdad de string.
  const json = `${JSON.stringify(document, null, 2)}\n`;

  // `check:openapi` pasa un directorio temporal para no pisar lo commiteado
  // mientras compara; sin argumento, genera en el lugar real del repo.
  const outDirArg = process.argv[2];
  const openapiDir = outDirArg
    ? pathToFileURL(`${resolve(outDirArg)}/`)
    : new URL('../openapi/', import.meta.url);
  await mkdir(openapiDir, { recursive: true });
  await writeFile(new URL('openapi.json', openapiDir), json, 'utf-8');

  const ast = await openapiTS(document as never);
  const types = `${astToString(ast)}`;
  await writeFile(new URL('types.d.ts', openapiDir), types, 'utf-8');

  await app.close();
  console.log(`[openapi] generado desde ${CONVERTED_ROUTES.length} ruta(s) convertida(s) → ${ROOT}openapi/`);
}

main().catch((err) => {
  console.error('[openapi] falló la generación:', err);
  process.exit(1);
});
