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
import { registerAuthRoutes } from '../src/infrastructure/http/routes/auth.routes.js';
import { registerCompanyRoutes } from '../src/infrastructure/http/routes/company.routes.js';
import { registerCostStructureRoutes } from '../src/infrastructure/http/routes/cost-structure.routes.js';
import { registerCostPeriodRoutes } from '../src/infrastructure/http/routes/cost-period.routes.js';
import { registerValidacionesRoutes } from '../src/infrastructure/http/routes/validaciones.routes.js';
import { registerTelemetriaPanelRoutes } from '../src/infrastructure/http/routes/telemetria-panel.routes.js';
import { registerPriceIndexRoutes } from '../src/infrastructure/http/routes/price-index.routes.js';
import { registerModulosRubroRoutes } from '../src/infrastructure/http/routes/modulos-rubro.routes.js';
import { registerMacroRoutes } from '../src/infrastructure/http/routes/macro.routes.js';
import { registerConceptoCosteoRoutes } from '../src/infrastructure/http/routes/concepto-costeo.routes.js';
import { registerClassifierAiCostRoutes } from '../src/infrastructure/http/routes/classifier-ai-cost.routes.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Rutas ya convertidas al contrato tipado. Crece en las próximas fases de #282. */
const CONVERTED_ROUTES = [
  registerAuthRoutes,
  registerCompanyRoutes,
  registerCostStructureRoutes,
  registerCostPeriodRoutes,
  registerOwnerDashboardRoutes,
  registerValidacionesRoutes,
  registerTelemetriaPanelRoutes,
  registerPriceIndexRoutes,
  registerModulosRubroRoutes,
  registerMacroRoutes,
  registerConceptoCosteoRoutes,
  registerClassifierAiCostRoutes,
];

async function buildSchemaOnlyApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger, {
    openapi: { openapi: '3.1.0', info: { title: 'CosteAR API', version: '1.0.0' } },
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
  const fullDocument = app.swagger() as {
    paths?: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    [key: string]: unknown;
  };
  // Un archivo de rutas puede contener operaciones todavía no migradas. Solo
  // publicamos las que declaran al menos una respuesta JSON con schema; así el
  // artefacto nunca presenta como tipado un endpoint cuyo handler aún no está
  // contrastado en el borde.
  const paths = Object.fromEntries(
    Object.entries(fullDocument.paths ?? {}).flatMap(([path, operations]) => {
      const typedOperations = Object.fromEntries(
        Object.entries(operations).filter(([, operation]) =>
          Object.values(operation.responses ?? {}).some((response) => {
            const content = (response as { content?: Record<string, { schema?: unknown }> }).content;
            return content?.['application/json']?.schema !== undefined;
          }),
        ),
      );
      return Object.keys(typedOperations).length > 0 ? [[path, typedOperations]] : [];
    }),
  );
  const document = { ...fullDocument, paths };
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
  const operationCount = Object.values(paths).reduce(
    (count, operations) => count + Object.keys(operations as object).length,
    0,
  );
  console.log(`[openapi] generado desde ${operationCount} operación(es) tipada(s) → ${ROOT}openapi/`);
}

main().catch((err) => {
  console.error('[openapi] falló la generación:', err);
  process.exit(1);
});
