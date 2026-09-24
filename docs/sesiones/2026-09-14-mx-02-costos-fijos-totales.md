# Bitácora — MX-02: el tablero deja de mostrar un costo fijo unitario destacado

Cuarta y última tarea de la **Ola A** del plan de análisis marginal v2 (backend). Las otras tres:
MX-03 (PR #359), MX-04 (PR #361, ADR 0016), MX-01 (frontend, PR #180 de `CosteAR-frontend`).

## El problema

`owner-dashboard-service.ts` compone `costoPorCajon.fijo` como
`Σ componentes FIJO ÷ period.productionQuantity`. Es un **costo fijo unitario**, la entidad que
`AM4` (bóveda) demuestra inexistente y que la regla dura **R10** prohíbe: los fijos se controlan
en totales, no por unidad. Y está en producción, en el tablero del dueño.

## Qué se hizo

`src/application/cost-structures/owner-dashboard-service.ts`:

- `costoPorCajon.fijo` **se conserva**, mismo cálculo de siempre, pero marcado
  `esUnitarioDeFijo: true` con una advertencia en `motivos` explicando por qué no es una magnitud
  económica.
- **`costosFijosDelPeriodo`** (indicador nuevo) — el total de componentes `FIJO`, sin dividir. A
  diferencia de `costoPorCajon.fijo`, es un importe en pesos: no depende de la unidad de gestión,
  así que no pasa por `conversor.importeUnitarioDesdeBase` (eso convierte precios *por unidad*,
  no totales).
- **`cajonesQueTapanLosFijos`** (indicador nuevo) — `costosFijosDelPeriodo ÷
  contribucionMarginalPorCajon`. Mismo principio que MX-01: con contribución marginal ≤ 0 ningún
  volumen alcanza, y sale incompleto con motivo — nunca un infinito.
- `src/shared/schemas/owner-dashboard.schema.ts` — los tres campos nuevos entran al contrato Zod.
  Sin esto, `fastify-type-provider-zod` los descarta al serializar la respuesta (Zod no pasa
  campos que el schema no declara): el endpoint devolvía 200 con los indicadores ausentes en vez
  de un error, y el test lo detectó como `undefined`, no como un fallo de validación.
- `docs/adr/0017` — por qué el fijo unitario se conserva marcado en vez de eliminarse.

## Decisiones

- **`costosFijosDelPeriodo` y `cajonesQueTapanLosFijos` comparten el criterio de completitud con
  el resto de `costoPorCajon`** (falta corrida, falta unidad de gestión, sin producción, sin
  `unitFinishedGoodsCost`), salvo `cajonesQueTapanLosFijos` que además exige contribución marginal
  positiva — es un criterio propio, no heredado.
- **El "puente" por inventarios de proceso que el plan pedía para `costoPorCajon.total` queda
  fuera de esta tarea.** Requiere el renglón 7f del Estado de Costos (`netProductionCost`) y la
  existencia inicial/final de producción en proceso, que hoy `CalculationOutput` no expone. Es
  trabajo de `M0-01` (control de suma contra el motor), no de la Ola A — el propio plan lo separa
  en tareas distintas (`§8.1 C8` vs `MX-02`).
- **Sin cambios en el frontend en este PR.** MX-02 dice "back + front", pero el ajuste visual
  (bajar jerarquía del fijo unitario, mostrar los dos indicadores nuevos) es trabajo de
  `CosteAR-frontend` y queda para un PR aparte de ese repo, siguiendo el mismo patrón que MX-01
  (feature aislada, un repo por PR).

## Verificación

```
npm run typecheck                                                verde
npx eslint <los 3 archivos tocados>                               verde
npx vitest run tests/http/owner-dashboard.test.ts --no-file-parallelism   8/8 verdes
npx vitest run --exclude 'tests/http/**'                          1556 verdes, 4 skip
npx vitest run tests/http --no-file-parallelism                   20 archivos, 110 verdes
```
