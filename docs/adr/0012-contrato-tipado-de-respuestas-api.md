# 0012 — Contrato tipado y versionado de respuestas API

- **Fecha:** 2026-09-10
- **Estado:** Aceptada (fase 1 — prueba de concepto)
- **Decide:** Alan (sesión de Claude), a partir del issue
- **Contexto de origen:** issue #282

## Contexto

`Coste-AR/CosteAR-frontend#128` necesita tipos de la API que no puedan divergir del servidor sin
que el build falle. Hoy este repo no publica OpenAPI ni ningún contrato máquina-legible de
respuestas: `tsconfig.json` tiene `declaration: false`, y los schemas Zod que existen describen
entradas (`params`/`query`/`body`), no lo que cada ruta devuelve. Copiar interfaces a mano en el
frontend no sirve: un rename de campo en el backend compilaría igual del otro lado hasta que
alguien actualizara la copia a mano.

Medido contra `origin/dev`: ninguna de las ~35 rutas de `src/infrastructure/http/routes/` declara
un `schema.response` de Fastify. No hay ninguna herramienta de OpenAPI instalada.

## Decisión

**Fase 1 (este PR):** probar el mecanismo completo sobre UNA sola ruta real
(`GET /periods/:id/tablero-dueno`, el tablero del dueño de #252) antes de convertir las otras
cuatro pantallas que pide el issue (auth/sesión, empresas/estructuras de costos,
configuración/cálculo/simulación, validaciones/carga de datos). Las cuatro quedan para PRs
siguientes contra el mismo issue — convertir las cinco de una sería un PR que nadie puede revisar
(PR-03) y arriesgaría entregar las cinco a medias.

Componentes:

- **`fastify-type-provider-zod@4.0.2`** como *type provider*: las rutas que lo usan declaran
  `schema.response[status]` con un schema Zod, y Fastify valida/serializa la respuesta real contra
  ese schema en cada request — no es documentación que pueda desincronizarse del handler, es la
  serialización. Fijado a la v4 porque las versiones ≥5 piden `zod >=4.1.5` (peer dependency) y
  este repo tiene `zod@^3.24.1` en decenas de schemas de entrada; migrar todo el repo a Zod 4 no es
  parte de este issue.
- **`@fastify/swagger@9.8.1`** genera el documento OpenAPI 3.1 desde esos mismos schemas
  (`fastify-type-provider-zod` expone `jsonSchemaTransform` para esto). Es el mismo schema que
  valida en runtime: no hay un segundo lugar donde described qué devuelve la ruta.
- **`openapi-typescript@7.13.0`** (devDependency) convierte el JSON generado en un `.d.ts` de solo
  tipos — sin Fastify, sin Prisma, sin nada de servidor: lo que el frontend puede importar sin
  acoplarse al backend.
- **Artefacto versionado:** `openapi/openapi.json` + `openapi/types.d.ts`, committeados en el repo,
  regenerados por `npm run openapi:generate` y verificados contra deriva por `npm run
  check:openapi` (falla si el commiteado no coincide con lo recién generado — mismo patrón que
  `check:tests-base`). El SHA del commit que los generó es la versión: el frontend pinea un SHA o
  un tag de release, no un número de versión manual que alguien tiene que acordarse de subir.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| `zod-to-openapi` (`@asteasolutions/zod-to-openapi`) sin type provider | Genera el documento OpenAPI pero no ata la serialización real de Fastify al schema: un handler podría devolver algo distinto del schema documentado y nada lo detectaría en runtime ni en `tsc`. No cumple "handlers are checked against them". |
| Migrar todo el repo a Zod 4 para usar `fastify-type-provider-zod` last version | Cambio masivo, no pedido por el issue, con riesgo de romper los ~35 archivos de schemas de entrada existentes. Zod 3 sigue soportado por la v4 del type provider. |
| Un paquete de tipos escrito a mano y sincronizado por convención | Es exactamente lo que el issue dice que no alcanza: compila igual si alguien lo olvida actualizar. |
| Publicar el JSON generado sin `.d.ts` y que el frontend corra `openapi-typescript` en su propio build | Funciona, pero acopla el build del frontend a una herramienta y versión específicas de generación; publicar el `.d.ts` ya resuelto es más simple de consumir y es lo que pide "type-only... no importa Fastify, Prisma, etc." de forma más directa. |
| Convertir las cinco pantallas en este mismo PR | PR-03: un PR de ese tamaño no se revisa. Además, retrofitear `schema.response` a rutas que hoy no lo tienen puede cambiar el shape serializado si el handler devolvía campos extra — mejor validarlo ruta por ruta. |

## Consecuencias

**A favor**

- El contrato lo genera el mismo schema que valida en runtime: no puede haber un documento
  desactualizado que diga una cosa mientras el handler hace otra, porque **es** lo que serializa.
- `check:openapi` en CI falla si alguien cambia una ruta convertida sin regenerar el artefacto —
  cierra exactamente el "CI fails when generated output is stale" del issue.
- El `.d.ts` generado no importa nada de servidor: se puede copiar a un paquete o publicarlo como
  artefacto de un release sin arrastrar Fastify/Prisma al bundle del navegador.

**En contra / lo que aceptamos pagar**

- Dos dependencias productivas nuevas (`fastify-type-provider-zod`, `@fastify/swagger`) y una de
  desarrollo (`openapi-typescript`).
- Retrofitear `schema.response` a las ~34 rutas restantes es trabajo real, no automatizable: cada
  una necesita que alguien mire qué devuelve HOY el handler y lo declare, sin inventar campos que
  no estén. Queda para las fases siguientes de #282.
- `fastify-type-provider-zod@4.0.2` es una versión vieja (compatible con Zod 3): si el repo migra a
  Zod 4 en el futuro, hay que revisar si conviene saltar a una versión más nueva del provider.

**Qué se rompe si alguien la revierte sin leer esto**

- Sacar `fastify-type-provider-zod`/`@fastify/swagger` de `app.ts` sin sacar también
  `schema.response` de las rutas convertidas hace que Fastify intente validar contra un compilador
  de schema que ya no está registrado.
- Borrar `openapi/openapi.json` sin correr `openapi:generate` deja `check:openapi` (y el CI) en rojo
  la próxima vez que alguien toque una ruta convertida.
