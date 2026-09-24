# 0033 — El análisis marginal de costeo por procesos va por un camino propio y reusa las funciones puras del dominio

- **Fecha:** 2026-09-24
- **Estado:** Propuesta — la firman Alan y Lautaro (dominio) antes de encolar
- **Decide:** Alan + Lautaro
- **Contexto de origen:** ADR-3 del plan de remediación AUD-2026-09; auditorías AUD-2026-09-16-09 y AUD-2026-09-23-03; plan de análisis marginal v2 (`CosteAR-admin/docs/plans/2026-09-07-analisis-marginal-v2.md`)

## Contexto

El tablero del dueño lee `contribucionMarginal`, `puntoEquilibrio` y el resultado por costeo variable del resultado de la corrida (`owner-dashboard-service.ts`). Esos campos los agrega `enrichCalculationResult()` (`calculation-result-enrichment.ts`), y **solo se llama en el camino de órdenes**. `calculation-run-service.ts:201` corta procesos a propósito con `CostingSystemNotAvailableError`, y `ProcessCalculationService` nunca escribió un equivalente.

Resultado, verificado el 16-09 y otra vez el 23-09 sobre `dev`: una estructura de procesos calcula su costo por absorción **exacto**, y el tablero muestra "Falta el resultado de costos de la corrida" en cinco de sus seis números. El vertical avícola **es** procesos: silo → planta de alimento → granja → huevo.

No es un cable suelto:

- En órdenes, el objeto de costo es la orden y los insumos vienen por secciones (`rawMaterialConfig`, `directLaborConfig`, `indirectCostConfig`). `enrichCalculationResult` recibe ese `CalculationInput`.
- En procesos, el objeto de costo es el **departamento**, los costos llegan por elemento (`periodCostMp/Mo/Cif`) en cada eslabón, y el producto sale al final de la cadena, convertido de unidad.

Forzar los procesos en la forma de las órdenes obligaría a inventar una "orden" que no existe.

## Decisión

1. **Camino propio, funciones comunes.** Se crea `enrichProcessCalculationResult()`, que arma una **vista de gestión** de la cadena y llama a las **mismas funciones puras del dominio** que ya usa órdenes (contribución marginal, familia de equilibrio, zona, tramos, punto de cierre). Lo que se comparte es la teoría, no el adaptador.
2. **De dónde sale el costo variable unitario en una cadena:**
   - Cada importe de departamento se clasifica contra `ConceptoCosteo` (elemento + departamento). **MP es variable por defecto**, porque la puso el volumen. **MO y CIF no tienen default**: si no están clasificados, el resultado sale **incompleto con motivo** y el PE como **zona** (R13), nunca como punto.
   - `cv por unidad terminada = Σ (parte variable de cada departamento) ÷ unidades buenas terminadas del último departamento`, en la unidad del último departamento y convertida a la unidad de gestión con la fracción exacta del ADR 0031. La base son las **producidas**, no las vendidas (M0-02).
   - La **amortización del plantel es fija** (causa: tiempo, R6) y **queda fuera del cv** aunque esté cargada en el CIF de la granja.
   - La pérdida normal queda absorbida en el cv de las unidades buenas; la **extraordinaria es un hecho del período** y va al resultado, no al cv.
   - Los **fijos del período se suman, no se unitarizan** (R10). El tablero los muestra en pesos y como cajones que los cubren, nunca como "fijo por cajón".
3. **La excepción tipada se conserva.** `CostingSystemNotAvailableError` sigue protegiendo el endpoint de órdenes contra una estructura de procesos, porque ese endpoint no es su camino. El tablero **no** la dispara: pregunta por el sistema de la estructura y llama al enriquecedor que corresponde.
4. **La corrida de procesos persiste los mismos campos** (`contribucionMarginal`, `puntoEquilibrio`, `incompletitud`, `resultadoPeriodoCosteoVariable`) con **la misma forma** que la de órdenes, así el tablero no se entera de qué camino vino.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Generalizar `enrichCalculationResult` para que acepte procesos | Obliga a inventar un `CalculationInput` de órdenes a partir de una cadena de departamentos. La traducción mete supuestos en un lugar donde nadie los ve |
| Calcular el marginal de procesos en el frontend con la cm tipeada por tramos | Es lo que hay hoy de hecho: la cm se carga a mano en `tramos-costo`. El número más importante del producto queda fuera del dominio y sin traza |
| Dar default "fijo" a MO y CIF | Inventa una clasificación (Constitución §2). En avícola, parte del CIF (energía de los extractores) es variable con los días de operación, y otra parte (el galpón) es fija |

## Consecuencias

**A favor**

- El tablero funciona para el vertical que se vende, con las mismas reglas que en órdenes.
- La cm por tramos puede salir de la corrida en vez de tipearse (B4-08).
- Un número incompleto dice qué falta clasificar, por departamento.

**En contra / lo que aceptamos pagar**

- Hay que clasificar los importes por departamento: más trabajo de setup para el costista, o un default por elemento que el dueño confirma.
- Dos adaptadores que mantener (órdenes y procesos) sobre un mismo núcleo. Mitigación: un test de contrato que exige la misma forma de salida a los dos.
- Depende del ADR 0031 para convertir la unidad del último departamento a la de gestión sin redondeo.

**Qué se rompe si alguien la revierte sin leer esto**

- El tablero del avícola vuelve a quedar vacío, o peor: si se "arregla" unificando con el camino de órdenes, aparece un cv que incluye la amortización del plantel. Es el error que el corpus llama el más caro del proyecto: le cambió la cm un 24,9 %.

## Cómo se verifica que sigue vigente

- Test de integración: FX-AV M1 cargado **como procesos** (planta → granja → fraccionadora) muestra en el tablero `cm` $30.000/cajón, PE 600 cajones y conversor $1.000.000 = 33,3 cajones. Son los mismos números que FX-AV cargado como órdenes.
- Test: con el CIF de un departamento sin clasificar, el PE sale como zona, con un motivo que nombra el departamento.
- Test: la amortización del plantel cargada en el CIF de la granja no mueve el cv.
- Test de contrato: `tablero-dueno` de una corrida de órdenes y de una de procesos validan contra el mismo schema.
