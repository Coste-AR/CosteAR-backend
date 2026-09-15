# Barrido preventivo de la familia A — campos `Decimal` que guardan una razón

> **Alcance de este documento: solo listar.** No se propone remediación para ningún campo — eso
> es trabajo de otro ciclo, con su propio issue. Esto existe para cerrar la familia de un saque en
> vez de descubrirla campo por campo, como pasó con `AUD-2026-09-14-04a` y
> `AUD-2026-09-15-01`.

**Fuente:** `git show origin/staging:prisma/schema.prisma` @ `a0234dc` (14-09-2026 01:00 ART).
**Método:** `grep` de todo `Decimal(p,s)` del archivo (72 columnas), filtrado a las que declaran
una razón/factor/porcentaje/proporción/tasa — "algo sobre algo" — y **excluidas** las que son
montos en pesos, cantidades físicas absolutas (`capacidad`, `umbralBajo` de depósito, `cantidad`,
`roturas`, `unidadesProducidas`) o valores de residuo/adquisición. Cada fila se verificó contra el
código real (`git grep` sobre `origin/staging`), no se infirió del nombre del campo.

## Las dos familias de consecuencia

No todos pesan igual. Hay dos mecanismos de falla distintos, y el riesgo real depende de cuál le
toca a cada campo:

- **🔴 Bloquea con error duro.** Algo, aguas abajo, compara el valor contra otro por igualdad
  exacta o con una tolerancia insuficiente. Un dato físicamente correcto puede rebotar con un
  422/500. Es el patrón de `04a` y `AUD-2026-09-15-01`.
- **🟡 Contamina en silencio.** Nada compara el valor contra nada — se usa directo como
  multiplicador o divisor. No hay ningún error: el número que sale es sutilmente incorrecto y
  nadie se entera sin comparar a mano contra el dato físico real.

## Ranking — de mayor a menor riesgo de que un cliente real lo dispare

| # | Campo | Modelo | Escala | Consecuencia | Validación / tolerancia |
|---|---|---|---|---|---|
| 1 | `conversionFromPrevious` | `ProcessDepartment` | `Decimal(18,6)` | 🔴 bloquea | cruzada, `validate-inputs.ts:296`, tolerancia **absoluta** `1e-4` |
| 2 | `normalLossPct` | `UnitMovementSchedule` | `Decimal(9,4)` | 🔴 bloquea | interna, `process-costing.ts:226`, tolerancia **cero** (exacta) |
| 3 | `initialWipMpAvance` / `initialWipConvAvance` / `finalWipMpAvance` / `finalWipConvAvance` | `UnitMovementSchedule` | `Decimal(9,4)` | 🟡 silenciosa | ninguna — multiplicador directo de la producción equivalente |
| 4 | `sellingCostVarPct` | `ByProductLine` | `Decimal(9,4)` | 🟡 silenciosa | ninguna — multiplica el valor de venta en el método VNR |
| 5 | `yieldPct` | `ByProductLine` | `Decimal(9,4)` | 🟡 silenciosa | ninguna — base de reparto directa en el método TECHNICAL_YIELD |
| 6 | `factor` | `UnidadMedida` | `Decimal(18,6)` | 🟡 silenciosa | ninguna — multiplicador puro en conversiones |
| 7 | `marginThresholdPct` | `AlertSetting` | `Decimal(9,4)` | — sin riesgo práctico | comparación `<`, no igualdad; config manual del usuario |
| 8 | `threshold` / `actualValue` | `Alert` | `Decimal(18,4)` | — sin riesgo práctico | comparación de umbral, no igualdad; unidad genérica |
| 9 | `umbral` | `ReglaAlerta` | `Decimal(18,6)` | — sin riesgo práctico | comparación de umbral, no igualdad; config del productor |
| 10 | `grossMarginPct` | `CostCalculation` | `Decimal(18,4)` | — sin riesgo práctico | ninguna — resultado calculado, no input validado |
| 11 | `costoUnitarioPpp` | `ConsumoCorrida` | `Decimal(18,6)` | — sin riesgo práctico | ninguna — snapshot calculado (total ÷ cantidad) |
| 12 | `value` (indicadores macro) | `MacroSnapshot` | `Decimal(18,6)` | — sin riesgo práctico | ninguna — importado de fuente externa, ya redondeado en origen |
| — | `valorNum` | `ParametroCosteo` | `Decimal(18,6)` | **indeterminado** | depende de `clave` — comodín, ver nota aparte |

---

## Detalle por campo

### 1 · `conversionFromPrevious` — `ProcessDepartment.conversionFromPrevious`
**Escala:** `Decimal(18,6)`.
**Validación:** cruzada entre departamentos, `src/application/cost-structures/
validate-inputs.ts:293-296` — compara `transferidas × factor` contra `recibidas`, tolerancia
**absoluta fija** `1e-4` (`Math.abs(diferencia) > 1e-4`).
**No representable:** `1/360 = 0,002777...` (huevo → cajón). **Ya confirmado en producción de
esta auditoría** (`AUD-2026-09-14-04a`, `AUD-2026-09-15-01`).

### 2 · `normalLossPct` — `UnitMovementSchedule.normalLossPct`
**Escala:** `Decimal(9,4)`.
**Validación:** interna al departamento, `src/domain/calculations/process-costing.ts:226`
(`extraordinaryLoss.isNegative()`) — tolerancia **cero**, ni siquiera un epsilon.
**No representable:** cualquier pérdida normal real (conteo físico ÷ unidades del período) que no
sea "redonda" a 4 decimales — ej. `13/1556 = 0,0083547...`, o más simple, `1/120 = 0,008333...`.
**Ya confirmado esta sesión** (`AUD-2026-09-15-01`).

### 3 · Los cuatro campos de "avance" — `UnitMovementSchedule`
`initialWipMpAvance`, `initialWipConvAvance`, `finalWipMpAvance`, `finalWipConvAvance`.
**Escala:** `Decimal(9,4)`, los cuatro.
**Validación:** **ninguna de igualdad.** Se usan directo como multiplicador de la producción
equivalente (`unitsAtFullCompletion + finalWip × avance`, `process-costing.ts` ~490-500) — nada
los compara contra un valor esperado externo.
**No representable:** cualquier grado de avance que un responsable técnico mida como fracción no
terminante — ej. un lote **"dos tercios" terminado** = `2/3 = 0,666666...`.
**Por qué pesa tanto en el ranking pese a ser silencioso:** son los ÚNICOS cuatro campos de esta
lista que se cargan en **cada período de Procesos, sin excepción** (toda EI y toda EF tiene su
avance de MP y de Conversión) — la exposición es total, aunque la consecuencia (número levemente
mal, sin error) sea menos ruidosa que un 422.

### 4 · `sellingCostVarPct` — `ByProductLine.sellingCostVarPct`
**Escala:** `Decimal(9,4)`.
**Validación:** ninguna de igualdad — multiplica el valor de venta en el método VNR (Valor Neto
de Realización), `src/domain/calculations/joint-costs.ts:327`. El único chequeo del método es que
el VNR resultante no sea negativo (`joint-costs.ts:330-335`), no que el porcentaje sea
representable.
**No representable:** una comisión/flete pactado como fracción — ej. `1/7 = 0,142857...%`
(14,2857...%).
**Por qué pesa:** el propio comentario del schema (`schema.prisma:2016`) dice que VNR es *"el más
usado"* de los cuatro métodos de conjuntos — es el que más probablemente un cliente real active.

### 5 · `yieldPct` — `ByProductLine.yieldPct`
**Escala:** `Decimal(9,4)`.
**Validación:** ninguna de igualdad — es la base de reparto directa del método TECHNICAL_YIELD
(`joint-costs.ts:272-279`); nada exige que los rendimientos de las líneas sumen 100%.
**No representable:** un rendimiento técnico industrial no redondo — ej. `1/6 = 16,6666...%`. (El
propio comentario del schema usa como ejemplo 6%, 0,50% y 5% — todos redondos a propósito; un
rendimiento real medido raramente lo es.)
**Nota:** P-06 (conjuntos) sigue **NO EJERCITADO** en toda la serie de auditorías hasta ahora — este
campo nunca se cargó con un valor real en ninguna sesión.

### 6 · `factor` — `UnidadMedida.factor`
**Escala:** `Decimal(18,6)`.
**Validación:** ninguna de igualdad — multiplicador puro en conversiones
(`venta-producto-service.ts:77`, `unidad-gestion.ts:37`).
**No representable:** el campo está documentado por convención como *"cuántas unidades BASE
entran en UNA de ésta"* (`schema.prisma:2210`) — típicamente un entero (360 para cajón/huevo).
**Nada en el código fuerza esa dirección**: declarar una unidad "al revés" (ej. *"1 tonelada = 1/3
de camión"* → `factor = 0,333333...`) es igual de válido para el schema y produce el mismo tipo de
truncamiento que `conversionFromPrevious` — con la diferencia de que acá nadie lo valida, así que
no bloquea, solo desvía la conversión en silencio.
**Nota:** es el campo que la propia ficha `AUD-2026-09-14-04a` señala como "el patrón correcto" a
imitar para arreglar `conversionFromPrevious`. Sigue siendo cierto que el patrón (razón entera) es
mejor — pero el patrón en sí no está blindado contra usarse mal.

### 7 · `marginThresholdPct` — `AlertSetting.marginThresholdPct`
**Escala:** `Decimal(9,4)`.
**Validación:** comparación `<` contra el margen real (`recalculate.worker.ts`), no igualdad —
un umbral levemente truncado dispara la alerta uno o dos centésimos de % antes o después de lo
pedido, no rompe nada.
**No representable:** un umbral no redondo — ej. *"avisame si el margen cae de un tercio"* =
`1/3 = 33,333...%`. Configurado a mano por el usuario; en la práctica casi siempre es un número
redondo (15%, 20%).

### 8 · `threshold` / `actualValue` — `Alert.threshold`, `Alert.actualValue`
**Escala:** `Decimal(18,4)`, los dos.
**Validación:** comparación de umbral, no igualdad. Campo genérico — la unidad depende del
`AlertType` (puede ser un % para `MARGIN_BELOW_THRESHOLD`, o una magnitud física para
`INDICADOR_FISICO`, ej. humedad).
**No representable:** depende del tipo de alerta; para las de margen, mismo caso que el punto 7.

### 9 · `umbral` — `ReglaAlerta.umbral`
**Escala:** `Decimal(18,6)`.
**Validación:** comparación de umbral, no igualdad (`schema.prisma:2668-2672`: *"Dispara cuando la
lectura SUPERA el umbral. Ej: humedad > 16%"*). Configurable por el productor, no fijo en código.
**No representable:** un umbral físico no redondo — ej. *"humedad > 1/6"* (16,666...%), si el
productor lo pactara así en vez de con un número redondo.

### 10 · `grossMarginPct` — `CostCalculation.grossMarginPct`
**Escala:** `Decimal(18,4)`. El propio comentario del schema (`schema.prisma:715-717`) explica que
se amplió de `(9,4)` a `(18,4)` por un **desborde** (22003) cuando el costo supera ampliamente al
ingreso — la escala (4 decimales) no cambió, solo la precisión total.
**Validación:** ninguna — es un resultado calculado y guardado para trazabilidad, no un input que
algo valide.
**No representable:** trivialmente, cualquier margen % no redondo (`1 − costo/precio`).
**Por qué pesa poco:** nadie compara este número contra otro por igualdad; el error de
redondeo a 4 decimales en un % informativo es cosmético.

### 11 · `costoUnitarioPpp` — `ConsumoCorrida.costoUnitarioPpp`
**Escala:** `Decimal(18,6)`. Comentario del propio modelo: *"is the inventory valuation
snapshot; total is derived"*.
**Validación:** ninguna — snapshot calculado (costo total ÷ cantidad), no un input.
**No representable:** cualquier promedio ponderado cuya división no cierre exacta — ej.
`$1.000 ÷ 3 unidades = $333,333...`.

### 12 · `value` — `MacroSnapshot.value` (indicadores macro: dólar, IPC, paritarias)
**Escala:** `Decimal(18,6)`.
**Validación:** ninguna de igualdad.
**No representable:** en teoría cualquier tasa/índice no redondo, pero **viene de una fuente
externa** (BCRA/INDEC/paritarias vía `DOLARAPI`/`CAPIA`) que ya lo entrega redondeado — no es un
cálculo propio del sistema, así que el riesgo de representabilidad se hereda de la fuente, no se
genera acá.

### Mención aparte · `valorNum` — `ParametroCosteo.valorNum`
**Escala:** `Decimal(18,6)`.
**Por qué no tiene un puesto fijo en el ranking:** es un campo **clave-valor genérico**
(`schema.prisma:2226-2233`: *"Es clave-valor a propósito... cada rubro nuevo pediría una
migración"*) — puede guardar CUALQUIER número con nombre libre en `clave`
(`"huevos_por_cajon"`, `"vida_util_lote_meses"`, o cualquier `clave` que un paquete de rubro
nuevo invente mañana). Hoy los ejemplos documentados son enteros (`huevos_por_cajon = 360`), pero
**nada en el schema distingue una `clave` que vaya a guardar una razón de una que guarde un monto
en pesos o una cantidad de meses** — el tipo de columna es siempre el mismo,
`Decimal(18,6)`, sin que ninguna revisión de código lo note. Es el campo con más superficie
futura de esta familia: cualquier paquete de rubro que se agregue (el propio diseño del sistema
invita a sumarlos sin migración) puede introducir una razón nueva acá sin que este barrido, ni
ningún otro, la vuelva a encontrar a menos que se repita.
