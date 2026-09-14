# Bitácora — M0-01, primera parte: exponer `netProductionCost` (7f)

Primera pieza de la **Ola B** del plan de análisis marginal v2. No es M0-01 completo — es la
porción segura y sin ambigüedad; el resto quedó frenado a propósito (ver "Por qué no seguí").

## Qué se hizo

`netProductionCost` (renglón **7f** del Estado de Costos: costo real neto de recupero de merma y
merma extraordinaria) ya lo calculaba `calcCostStatement` — está probado a mano en
`tests/application/trabajos-de-terceros.test.ts` ("clave a mano con todos los renglones a la
vez") — pero `runCalculation()` no lo exponía en `CalculationOutput`. `calculation-result-enrichment.ts`
(quien arma la contribución marginal) no tenía forma de anclar un control de suma al costo real
neto, solo al costo normal (`productionCost`, renglón 7).

- `src/domain/calculations/calculate.ts` — `CalculationOutput.netProductionCost?: number`, y el
  `return` de `runCalculation` lo expone (`statement.netProductionCost.toNumber()`).
- 2 tests nuevos en `tests/application/trabajos-de-terceros.test.ts`: sin trabajos de terceros
  coincide con el costo normal; con terceros sube exactamente lo mismo que `realProductionCost`
  (en este caso no hay desperdicio, así que los dos coinciden — la fórmula completa con
  desperdicio ya estaba probada a nivel `calcCostStatement`).

## Por qué no seguí con M0-01 completo

El resto de M0-01 pide pasar 4 componentes nuevos a `calcularContribucionMarginal`: variación
presupuesto, trabajos de terceros, amortización de activos, y un neto de desperdicio. De esos
cuatro, tres (variación, terceros, desperdicio) entran limpio por el mecanismo que ya existe: se
clasifican por la misma cascada `período → estructura → empresa` que hoy usan MP/MOD/CIP, y si
nadie los clasificó, salen "sin clasificar" — el comportamiento ya existente, sin inventar nada.

**Amortización de activos es distinta**, y ahí frené. El plan dice: *"la propuesta de rubro por
default para `comportamiento_amortizacion_activos` es FIJO, con `confirmado=false`"* — citando R6
(la amortización del plantel es fija por causa temporal) y R8 (ningún fijo entra al costeo
variable por cuota de aplicación).

Verifiqué qué mecanismo existe hoy para que una clasificación nazca "propuesta, sin confirmar" en
vez de "sin clasificar":

- `git grep` de los 3 `comportamiento_*` existentes en `src/application/`: **ninguno se siembra
  nunca**. Los tres nacen sin fila y el costista los clasifica a mano vía
  `parametros-costeo-service.ts`.
- El único precedente de "propuesta sin confirmar" en el repo es `paquete-avicola.ts`
  (`seedParameters`, `variants`) — pero es para parámetros de **valor** (`huevos_por_cajon: 360`),
  no para parámetros de **clasificación** (`comportamientoVolumen`). No hay ningún camino hoy que
  auto-cree una fila `ParametroCosteo` de clasificación sin que un humano la escriba.

Implementar la propuesta de amortización exige, entonces, **inventar un mecanismo nuevo**: o bien
`enrichCalculationResult` auto-siembra una fila `confirmado: false` la primera vez que ve el
componente (candidato, pero cambia el contrato de "esta función solo lee" a "esta función también
escribe" — algo que hoy ningún consumidor de esa función hace), o bien un fallback puramente en
memoria que finja una clasificación FIJO sin fila real (pero entonces `parametrosSinConfirmar` —
que hoy se arma consultando filas reales por `parametroId` — no lo vería, y la advertencia se
perdería en el camino).

Ninguna de las dos es una decisión de bugfix. Es exactamente el tipo de cosa que **GR-06** pide
marcar como pregunta abierta en vez de resolver en silencio, y que la filosofía del repo
(diagnosticar → planificar → implementar) pide frenar antes de escribir código, no después.

## Qué falta decidir (para el equipo, antes de seguir con M0-01)

**¿Cómo nace una clasificación "propuesta pero no confirmada" cuando nadie la escribió?** Dos
caminos posibles, cada uno con su costo:

1. `enrichCalculationResult` (u otro punto de lectura) auto-siembra la fila `ParametroCosteo` la
   primera vez que la necesita. Reusa el mecanismo de `parametrosSinConfirmar` tal cual está, pero
   convierte una función de lectura en una que también escribe.
2. Un catálogo de "propuestas por default" a nivel de clave (no de paquete de rubro, porque
   amortización no es específica de avicultura), consumido explícitamente por
   `owner-dashboard-service.ts` para que la advertencia aparezca sin pasar por una fila real.

Con esa decisión tomada, el resto de M0-01 (pasar los 4 componentes, el control de suma anclado a
`netProductionCost`, el ADR sobre la clasificación fija de la amortización) es directo.

## Verificación

```
npm run typecheck                                                      verde
npx eslint <los 2 archivos tocados>                                    verde
npx vitest run tests/application/trabajos-de-terceros.test.ts          13/13 verdes
npx vitest run tests/application/calculate.test.ts                     14/14 verdes (fixture dorado, DOM-05, sin tocar)
npx vitest run --exclude 'tests/http/**'                                1558 verdes, 4 skip
npx vitest run tests/http --no-file-parallelism                        20 archivos, 108 verdes
```
