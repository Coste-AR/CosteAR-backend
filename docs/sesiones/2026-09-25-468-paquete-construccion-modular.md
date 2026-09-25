---
issue: 468
repo: CosteAR-backend
pr: 485
rama: feat/construccion-modular-f0
agente: codex
modelo: gpt-5
tanda: C1
inicio: 2026-09-25T10:06:39-03:00
fin: 2026-09-25T10:25:07-03:00
minutos: 19
tokens: no-informado
clears: 0
intentos_hasta_verde: 3
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-25 — Paquete de Construcción Modular

## Qué se hizo

- Se declaró `CONSTRUCCION_MODULAR` como segundo paquete de rubro, sin
  condicionales por cliente: léxico, cuatro modelos semilla, siete etapas,
  parámetros, KPI y preguntas de alta viven como datos del paquete.
- Los umbrales no declarados se publican con `valor: null`, origen `ausente` y
  `confirmado: false`; no se reemplazan por cero ni por una estimación.
- Las respuestas de alta actualizan el estado de `inventario`,
  `montaje-propio` y `plantillas` en la misma transacción que la respuesta y
  ambas mutaciones dejan auditoría.
- `PaqueteRubro` incorporó `nombreProductoConfirmado` mediante una migración
  aditiva. Las filas existentes conservan `true`; el nombre provisorio del
  paquete nuevo declara `false`.
- Se agregó un snapshot completo del paquete avícola como guarda de regresión.

## Recursos

- Tiempo: 19 minutos.
- Tokens: no informado.
- Intentos hasta verde: 3. La primera matriz completa tuvo tres timeouts HTTP
  por contención; los 31 casos focalizados y luego los 2.004 unitarios pasaron
  con un worker. Docker necesitó iniciarse y reutilizar los contenedores
  existentes antes de completar las suites con base.
- Comandos: `npm run briefing`, `npm ci`, `npm run prisma:generate`,
  `npm run lint`, `npm run typecheck`, `npm run test -- --maxWorkers=1`,
  `npm run test:http -- --maxWorkers=1`, `npm run db:setup`,
  `npm run test:integration -- --maxWorkers=1`,
  `npm run test:db -- --maxWorkers=1`, `npm run check:openapi`,
  `npm run typecheck:openapi-consumer`, `npm run check:tests-base` y
  `npx prisma validate`.

## Camino rojo deliberado

El test del paquete se escribió antes de la implementación y falló porque no
existía `paquete-construccion-modular.ts`. Después se verificó específicamente
que `umbral_desvio_margen_pp` queda ausente en vez de convertirse en cero.

## Decisiones tomadas sobre la marcha

- **Modelos:** se representaron en `variants`, el contenedor que ya usa el
  paquete avícola para alternativas visibles. Crear una tabla antes de que
  exista `PlantillaOrden` habría adelantado #469/#470. Constitución §4.
- **Etapas y onboarding:** se declararon dentro de `screens`, porque son
  contenido del paquete y todavía no existen las entidades operativas que
  crearán los issues siguientes. La alternativa era agregar columnas JSON
  específicas sin consumidores actuales.
- **Nombre provisorio:** se agregó un booleano tipado junto a
  `nombreProducto`, en lugar de esconder la confirmación en otro JSON. La
  migración es aditiva y deja explícita la diferencia entre dato decidido y
  propuesta. Constitución §2.
- **Índice de construcción:** no se declaró. El issue exige una API verificada
  y el núcleo no contiene una fuente sectorial comprobada; inventarla habría
  contradicho Constitución §2.
- **Preguntas reversibles:** se conservaron en un módulo de configuración
  siempre activo, separado de los módulos que controlan. Así apagar inventario
  no oculta la pregunta necesaria para volver a prenderlo.

## Dónde el issue no alcanzaba

- No especificaba en qué JSON existente debían vivir modelos y etapas mientras
  las entidades de #469/#470 todavía no existen.
- No definía cómo transportar `confirmado` para `nombreProducto`, que hasta
  ahora era una columna `String?` sin metadatos.
- No daba una fuente con API para el índice de construcción; se conservó la
  ausencia solicitada.

## Qué quedó afuera

- Las pantallas del flujo de alta.
- Entidades persistentes de modelos y etapas, que pertenecen a #469/#470.
- Un índice sectorial de construcción hasta contar con una API verificada.

## Verificación final

- Lint y typecheck: verdes.
- Unitarios: 2.004 verdes; 4 skips existentes.
- HTTP: 199 verdes.
- Integración: 88 verdes con rol de aplicación sin `BYPASSRLS`.
- DB/seguridad: 67 verdes con claves RSA efímeras y sonda RLS.
- OpenAPI, consumidor tipado y guarda de tests con base: verdes.
