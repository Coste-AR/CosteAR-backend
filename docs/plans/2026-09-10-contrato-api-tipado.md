# Plan — Contrato tipado y versionado de respuestas API (#282)

## Diagnóstico

Medido contra `origin/dev` (10-09-2026):

- Ninguna de las ~35 rutas de `src/infrastructure/http/routes/` declara `schema.response` de
  Fastify. `tsconfig.json` tiene `declaration: false`.
- Los schemas Zod existentes (`src/shared/schemas/*.schema.ts`) describen **entradas**
  (`params`/`query`/`body`), no lo que cada ruta devuelve.
- No hay tooling de OpenAPI instalado.

Esto significa que las cinco pantallas que #282 lista (auth/sesión, empresas/estructuras de costos,
configuración/cálculo/simulación, períodos/tablero, validaciones/carga de datos) requieren, cada
una, revisar ruta por ruta qué devuelve HOY el handler y declararlo — no es mecanizable de una,
porque declarar un schema que no coincide con el handler real sería peor que no tener contrato
(mentiría con más autoridad).

## Decisión técnica

Ver `docs/adr/0012-contrato-tipado-de-respuestas-api.md` para la decisión completa y las
alternativas descartadas. Resumen: `fastify-type-provider-zod@4.0.2` (compatible con `zod@^3`, que
ya usa todo el repo) + `@fastify/swagger@9.8.1` para generar el documento desde los mismos schemas
que validan en runtime + `openapi-typescript@7.13.0` para el `.d.ts` type-only.

## Fases

- **Fase 1 (este PR):** wiring completo del mecanismo (compilers, `@fastify/swagger`, scripts de
  generación y de chequeo de deriva, gate de CI, fixture de consumidor type-only) + UNA ruta real
  convertida de punta a punta: `GET /periods/:id/tablero-dueno`.
- **Fase 2 (PR separado):** auth/sesión (`auth.routes.ts`, `access-gate.routes.ts`).
- **Fase 3 (PR separado):** empresas y estructuras de costos (`company.routes.ts`,
  `cost-structure.routes.ts`).
- **Fase 4 (PR separado):** configuración, cálculo y simulación (`process-calculation.routes.ts`,
  `trazabilidad.routes.ts` — el endpoint `/structures/:id/calculate`).
- **Fase 5 (PR separado):** períodos restantes (`cost-period.routes.ts` — list/open/compare/close)
  y validaciones/carga de datos (`validaciones.routes.ts`).

Cada fase agrega su(s) archivo(s) a `CONVERTED_ROUTES` en `scripts/generate-openapi.ts` y su(s)
schema(s) de respuesta a `src/shared/schemas/`. El PR de cada fase corre el mismo procedimiento de
prueba: renombrar un campo, ver `typecheck`/`check:openapi`/`typecheck:openapi-consumer` en rojo,
restaurar, ver todo en verde de nuevo — documentado abajo.

## Procedimiento de verificación (repetible en cada fase)

1. `npm run openapi:generate` — regenera `openapi/openapi.json` y `openapi/types.d.ts`.
2. `npm run check:openapi` — falla si lo commiteado no coincide con lo recién generado.
3. `npm run typecheck:openapi-consumer` — typechequea `openapi/consumer-fixture.ts` con su propio
   `tsconfig.json`, que no extiende el del backend: prueba que el `.d.ts` es consumible sin
   Fastify/Prisma/servidor.
4. Prueba de rename (hecha a mano en esta sesión, ver bitácora): renombrar un campo en el schema de
   respuesta de una ruta convertida rompe `npm run typecheck` (el handler ya no matchea el schema
   declarado) y, tras regenerar, rompe `npm run typecheck:openapi-consumer` si el fixture lee ese
   campo. Restaurar el nombre deja las tres verificaciones en verde otra vez.

## Qué no cambia

- Los cuatro comandos de verificación estándar (`lint`, `typecheck`, `test`, `test:http`) siguen
  corriendo igual; se les suma `check:openapi` y `typecheck:openapi-consumer` como parte del mismo
  job liviano de CI (no necesitan Postgres).
- Las rutas no convertidas todavía no declaran `schema.response`: siguen funcionando exactamente
  igual que antes, el type provider no les exige nada.
