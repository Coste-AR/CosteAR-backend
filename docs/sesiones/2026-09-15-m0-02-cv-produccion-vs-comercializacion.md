# Bitácora — M0-02: el costo variable de producción divide por producidas, no por vendidas

Completa M0-02 (Ola B, plan de análisis marginal v2). Desbloqueada por M2-01 (necesitaba que
existiera el concepto de componente "de venta" para poder separar los dos divisores).

## El problema

`calcularContribucionMarginal` dividía **todo** el costo variable por `unidadesVendidas` —
issue **#88 reaparecido en la capa nueva**. Ese bug ya se había corregido en `detail.unitCost`
(ADR 0006): producción divide por unidades **producidas**, no por vendidas. La capa de costeo
variable no había heredado la corrección.

## Qué se hizo

- **`contribucion-marginal.ts`** — `ComponenteAbsorcion.elemento?: 'produccion' | 'venta'`
  (default `'produccion'`, retrocompatible con todo componente existente). `ContribucionMarginalInput.unidadesProducidas?`
  (opcional, mismo criterio de fallback que `detail.unitCost.basadoEn`: sin cantidad producida
  cargada, cae a vendidas — **no falla, avisa**). El resultado expone
  `costoVariableUnitarioProduccion`, `costoVariableUnitarioComercializacion`, `unidadesProducidas`
  y `basadoEn`, además del `costoVariableUnitario` de siempre (ahora la suma de los dos).
- **`calculation-result-enrichment.ts`** — marca `elemento: 'venta'` en los 2 componentes de
  M2-01 (gastos de comercialización/administración) y pasa
  `unidadesProducidas: args.input.sales.productionQuantity`.

## El hallazgo: mi propio test de M2-01 tenía los números del bug

Al correr la regresión completa, `tests/application/gastos-no-fabricacion.test.ts` (escrito ayer,
antes de M0-02) falló — sus números esperados (`cv = 300`, `cv = 330`, `PE = 682,35`) estaban
calculados con el divisor **viejo** (÷ vendidas para todo). Con el arreglo, MP+CIP (240.000)
÷ 1.000 producidas da **240**, no 300 — el fixture no cambió, lo que cambió es que ahora está bien
calculado. Recalculé a mano y actualicé las aserciones: `cv_producción = 240`,
`cv_comercialización = 30`, `PE de producción = 230,77`, `PE de la empresa = 504,35`.

Es exactamente el tipo de cosa que confirma por qué "regresión cero" en los TESTS no es lo mismo
que "regresión cero" en el COMPORTAMIENTO — un test que declaraba `.toBe(300)` no protegía nada,
solo congelaba el bug. Ninguno de los dos merges anteriores (M0-01, M0-03) tocaba el divisor, así
que no lo habían agarrado.

## Decisiones

- **`elemento` por default `'produccion'`, no obligatorio.** Todo componente de antes de M0-02
  (MP/MOD/CIP y los 4 de M0-01) es de producción — no hacía falta tocar ningún llamador viejo ni
  ningún test existente para que siguieran dando lo mismo.
- **Sin ADR propio.** El plan lo pide así explícitamente: la decisión de fondo (dos costos
  unitarios con divisores distintos, sin default inventado, avisando en vez de fallar) ya está en
  el ADR 0006 — esto la extiende a una capa nueva, no abre una decisión nueva.
- **No se tocó `owner-dashboard-service.ts`.** `costoPorCajon.variable` sigue leyendo
  `contribucion.costoVariableUnitario` (la suma) sin cambios — el split
  (`costoVariableUnitarioProduccion`/`Comercializacion`) queda expuesto en el dominio para quien
  lo necesite (una futura pantalla que desglose el costo variable), pero mostrarlo en el tablero
  no es parte del criterio de aceptación de esta tarea.

## Verificación

```
npm run typecheck                                                verde
npx eslint <2 archivos tocados>                                  verde
tests/domain/contribucion-marginal.test.ts                       15/15 verdes (incluye el fixture
                                                                    AM-01 exacto del plan)
tests/application/gastos-no-fabricacion.test.ts                  4/4 verdes (números recalculados)
npx vitest run --exclude 'tests/http/**'                         1586 verdes, 4 skip, 0 rojos
npx vitest run tests/http --no-file-parallelism                  21 archivos, 115 verdes
tests/integration/contribucion-marginal.test.ts                  2/2 verdes (Postgres real — ese
                                                                    tenant no carga productionQuantity,
                                                                    así que cae al mismo fallback de
                                                                    siempre y da los mismos números)
```
