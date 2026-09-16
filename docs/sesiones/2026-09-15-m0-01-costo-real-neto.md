# Bitácora — M0-01: la contribución marginal pasa a usar el costo REAL neto

Completa M0-01 del plan de análisis marginal v2 (Ola B). La primera parte —exponer
`netProductionCost`— ya estaba mergeada (#363, docs/sesiones/2026-09-14-m0-01a-net-production-cost.md).
Esta sesión resuelve el resto: los 4 componentes nuevos, el control de suma, y la decisión de
diseño que había quedado pendiente sobre la amortización (ver ADR 0018).

## El problema

`enrichCalculationResult` pasaba exactamente 3 importes al costeo variable —MP, MOD, CIP
aplicado—, el costo **normal** (renglón 7 del Estado de Costos). Quedaban afuera la variación
presupuesto, los trabajos de terceros, la amortización de activos y el desperdicio: los
renglones 7a-7e del costo **real**. Y nada controlaba que la suma de lo que sí llegaba
reconciliara contra ningún total del motor auditado.

## Qué se hizo

- **`contribucion-marginal.ts`** — `CLAVES_COMPORTAMIENTO_CONTRIBUCION` suma 4 claves nuevas.
  `ContribucionMarginalInput.totalEsperado?: number` (opcional, retrocompatible): si viene y la
  suma de `componentes` no coincide, el resultado sale incompleto con el faltante nombrado en
  pesos ("faltan $X respecto del costo neto de producción"), tolerancia de 1 centavo. Un
  componente en `importeAbsorcion === 0` no exige clasificación (ver más abajo).
- **`parametros-costeo.ts`** — `CLASIFICACIONES_AVICOLA` suma las 4 claves nuevas, todas con
  `propuesta: null` (nacen sin clasificar, igual que MOD y CIP).
- **`parametros-costeo-service.ts`** — `set()` rechaza con 422 cualquier intento de clasificar
  `comportamiento_amortizacion_activos` como VARIABLE (R6/R8, ver ADR 0018).
- **`calculation-result-enrichment.ts`** — pasa los 4 componentes nuevos cuando
  `CalculationOutput` los trae (siempre, en una corrida fresca — el `?` del tipo es por
  retrocompatibilidad con JSON persistido viejo, no un caso vivo hoy). El desperdicio se pasa
  neteado (`-(recupero + extraordinaria)`), normalizando el `-0` que da IEEE 754 cuando ambos son
  cero (si no, Postgres lo devuelve como `0` al leer el JSON persistido y el snapshot deja de
  coincidir bit a bit con lo recién calculado — lo encontró la integración). `totalEsperado` se
  conecta a `netProductionCost`, pero solo si **todos** los componentes llegaron (con alguno
  ausente no hay contra qué reconciliar).
- **ADR 0018** — la decisión de diseño de la sesión anterior, resuelta: amortización nace sin
  clasificar + rechazo duro, en vez de auto-proponerse.

## El hallazgo que casi se cuela: rubros en $0 no deberían exigir clasificación

Al conectar los 4 componentes a una corrida real (`tests/integration/contribucion-marginal.test.ts`,
tenant sin terceros/amortización/variación/desperdicio configurados — el caso normal), la
contribución marginal completa pasó a **incompleta**: los 4 llegaban en $0 y sin clasificar, y la
regla existente marca "sin clasificar" como motivo sin mirar el valor. Sin este ajuste, **M0-01
hubiera roto la contribución marginal de cualquier cliente que hoy no usa esos 4 campos** — que es
la mayoría, siempre que un período no tenga ese gasto.

Se agregó la exención: un componente en `importeAbsorcion === 0` no genera motivo, sea cual sea su
clasificación (o la ausencia de ella) — clasificarlo no cambiaría ningún número. General, no
específica de las 4 claves nuevas.

## Decisiones

- **Amortización: ver ADR 0018.**
- **El control de suma vive en `calcularContribucionMarginal` (dominio puro), no en
  `enrichCalculationResult`.** Mantiene una sola función como responsable de "qué hace que esta
  contribución esté completa" — MX-03 ya había puesto esa responsabilidad ahí.
- **El `-0` se corrige normalizando en el punto de cálculo (`|| 0`), no ignorando el test.** Es un
  bug real, aunque invisible en memoria: solo lo delata la persistencia a JSON. Se documenta en el
  código para que no vuelva.
- **No se tocó `owner-dashboard-service.ts`.** Los componentes nuevos entran al cálculo de
  `costoVariableUnitario`/`costoPorCajon.fijo` automáticamente (ya filtran por
  `comportamientoVolumen`), sin cambios en esa capa.

## Fuera de alcance

- El "puente" por producción en proceso para `costoPorCajon.total` (§8.1 C8 del plan) — sigue
  necesitando el renglón 7f expuesto en el tablero del dueño, no solo en el motor. Es tarea de
  M3-04, no de M0-01.
- M0-02 (dividir costo variable de producción por unidades producidas vs. vendidas) — depende de
  que exista el concepto de "elemento" (producción vs. venta) que hoy no está en
  `ComponenteAbsorcion`, y ese concepto lo trae M2-01 (gastos de no fabricación), no M0-01.

## Verificación

```
npm run typecheck                                                       verde
npx eslint <7 archivos tocados>                                         verde
npx vitest run tests/domain/contribucion-marginal.test.ts
  tests/domain/comportamiento-semilla.test.ts
  tests/application/parametros-costeo-service.test.ts
  tests/application/costo-real-neto.test.ts                             27/27 verdes
npx vitest run --exclude 'tests/http/**'                                1574 verdes, 4 skip, 0 rojos
npx vitest run tests/http --no-file-parallelism                         20 archivos, 111 verdes
npx vitest run --config vitest.integration.config.ts
  tests/integration/contribucion-marginal.test.ts
  tests/integration/parametros-costeo.test.ts                           4/4 verdes
```

**Nota sobre el resto de la suite de integración:** al correr la suite de integración completa
aparecieron 9 archivos en rojo, todos por aislamiento RLS entre empresas — incluido el propio test
que verifica que el rol de conexión NO sea superusuario (`aislamiento-entre-empresas.test.ts`).
Verificado con `git stash` que **el fallo es preexistente**: con mis cambios afuera, contra `dev`
limpio, el mismo test falla igual. El rol de Postgres local quedó con privilegios de superusuario
—drift del Docker local, no algo que este PR causó ni algo que corresponda arreglar acá—, y no
tiene relación con ningún archivo que esta tarea tocó.
