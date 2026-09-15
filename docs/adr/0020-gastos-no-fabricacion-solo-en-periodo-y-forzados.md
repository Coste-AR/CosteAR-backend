# 0020 — Los gastos de no fabricación viven solo en `CostPeriod`, con clasificación forzada

- **Fecha:** 2026-09-15
- **Estado:** Aceptada
- **Decide:** Giuliana (sesión de Claude)
- **Contexto de origen:** M2-01 del plan de análisis marginal v2 (`CosteAR-admin`)

## Contexto

`CostElement.VENTA` existe en `prisma/schema.prisma` desde hace tiempo, pero **nunca llegaba a
`calcularContribucionMarginal`**: el punto de equilibrio que mostraba el tablero del dueño era un
equilibrio de **producción**, no de la **empresa** — le faltaban enteros los gastos de
administración y de comercialización. `AM4` (bóveda) mide el costo de esta omisión con el fixture
canónico del plan: el PE sube de 475,52 a 750 unidades (un 57,7 %) al incorporarlos.

Al implementar esto aparecieron tres decisiones de diseño que el plan no especificaba en detalle.

## Decisión 1 — Dos campos nuevos, solo en `CostPeriod`

Se agregan `gastoVariableComercializacionPorUnidad` y `gastoFijoAdministracion` **solo** en
`CostPeriod` (migración aditiva). A diferencia de `thirdPartyWork` (#90), que vive tanto en
`CostStructure` como en `CostPeriod` (config default + espejo por período), estos dos **no**
tienen mirror en `CostStructure`: son gastos SG&A que naturalmente se re-cargan cada período
(alquiler, sueldos administrativos, comisiones varían mes a mes), no una configuración que tenga
sentido heredar de un período al siguiente.

## Decisión 2 — Clasificación forzada, no cascada de `ParametroCosteo`

A diferencia de MP/MOD/CIP (y de las 4 claves de M0-01), estos dos componentes **no** pasan por
la cascada de clasificación humana: un "gasto variable de comercialización por unidad vendida" es
variable por cómo se define, y un "gasto fijo de administración del período" es fijo por
definición — no hay una decisión de negocio que tomar, a diferencia de si la mano de obra directa
es fija o variable en una empresa particular.

Se agregó `ComponenteAbsorcion.comportamientoVolumenForzado?: ComportamientoVolumen` al dominio:
cuando viene, el componente usa esa clasificación directo y **salta la cascada por completo** —
ni siquiera necesita que exista una fila de `ParametroCosteo`, y si existiera una (por error o por
intento de anularla) no gana: lo forzado es una propiedad del componente, no algo clasificable.

### Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Pasar por la cascada como todo lo demás, con `propuesta` (mecanismo de `parametros-costeo.ts`) | Ya se decidió (ADR 0018) no usar `propuesta` para M0-01 porque es un mecanismo sin uso real en el repo. Usarlo acá sería inconsistente sin agregar valor: a diferencia de la amortización (que SÍ necesita juicio humano, R6), estos dos no tienen ambigüedad que una propuesta-editable resuelva mejor que un hardcodeo. |
| Sumarlos directo a `costosFijosDelPeriodo`/`costoVariableUnitario` sin pasar por `componentes` | Pierde trazabilidad: el plan pide que aparezcan como componentes propios en la descomposición, para que el costista los vea desglosados en el tablero, no mezclados sin nombre dentro de un total. |

## Decisión 3 — No tocan `CalculationInput`/`calculate.ts`

Se leen directamente en `enrichCalculationResult` (por `periodId`, ya resuelto) y se pasan como
componentes forzados a `calcularContribucionMarginal`. **No** viajan por `CalculationInput` ni por
el motor de cálculo (`calculate.ts`/`cost-statement.ts`): no son costo de producción, nunca tocan
el Estado de Costos ni el CPV — son gasto del período, por debajo de esa línea. Meterlos en el
motor auditado violaría la regla dura 1 del plan ("no se toca el motor auditado") por un concepto
que estructuralmente no le corresponde modelar.

## Hallazgo colateral: `thirdPartyWork` nunca llega al cálculo real

Al diseñar cómo `enrichCalculationResult` iba a leer estos dos campos, se encontró que
**`CalculationRunService.calculate()`** — el método que arma el `CalculationInput` en el flujo
real de "calcular" que alimenta el tablero del dueño — **nunca lee `thirdPartyWork` de la base**,
a pesar de que existe la columna y un endpoint (`PUT /cost-structures/:id/third-party-work`, #90)
para cargarlo. Solo `CostStructureService.calculate()` (un método separado que persiste en
`CostCalculation`, no en `CalculationRun`, y que no llega a `enrichCalculationResult`) lo lee.

**Consecuencia práctica:** hoy, en el producto real, cargar trabajos de terceros desde el panel no
cambia ningún número del tablero del dueño. Es un bug preexistente, anterior a esta sesión, y
**fuera de alcance de M2-01** — no se corrigió acá para no ampliar el scope de esta tarea (GR-02).
Para no repetir el mismo agujero con `gastoVariableComercializacionPorUnidad`/
`gastoFijoAdministracion`, se los diseñó para que **se lean automáticamente** dentro de
`enrichCalculationResult` (por `periodId`, igual que `unidadGestion` se lee de la empresa) en vez
de depender de que cada llamador se acuerde de pasarlos — así ningún caller nuevo puede
olvidarse de cablearlos, que es exactamente lo que le pasó a `thirdPartyWork`.

## Consecuencias

**A favor**

- `comportamientoVolumenForzado` es reusable: cualquier concepto futuro que sea fijo/variable por
  definición (no por juicio del costista) puede usarlo sin inventar nada nuevo.
- Los gastos de no fabricación quedan automáticamente conectados a cualquier llamador presente o
  futuro de `enrichCalculationResult` — no dependen de que alguien recuerde pasarlos.

**En contra / lo que aceptamos pagar**

- Un query adicional a `costPeriod` en el camino con `periodId` explícito (antes no se consultaba
  nada ahí). Es una consulta liviana por `id`, no un cambio de complejidad relevante.
- El hallazgo de `thirdPartyWork` queda documentado pero sin corregir — requiere su propio issue.

**Qué se rompe si alguien la revierte sin leer esto**

- Volver a pasar estos valores como argumento explícito (en vez de leerlos del período) reintroduce
  el riesgo de que un caller nuevo se olvide de cablearlos — el mismo bug que tiene hoy `thirdPartyWork`.

## Cómo se verifica que sigue vigente

`tests/domain/contribucion-marginal.test.ts` (comportamientoVolumenForzado no pasa por la cascada,
ni una fila real lo pisa), `tests/application/gastos-no-fabricacion.test.ts` (fixture AM-01, PE de
producción vs. PE de la empresa), `tests/application/gastos-no-fabricacion-service.test.ts`
(persistencia + bitácora), `tests/http/gastos-no-fabricacion.test.ts` (endpoint).
