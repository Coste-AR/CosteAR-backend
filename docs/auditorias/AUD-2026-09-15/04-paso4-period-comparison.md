# PASO 4 — `period-comparison` contra la serie

Módulo puro: `src/application/cost-structures/period-comparison.ts` (no toca Prisma), expuesto en
`GET /structures/:id/periods/compare` (`cost-period.routes.ts:62-67`). Entró en la tanda auditada
por `AUD-2026-09-14`. Verificado por lectura de código + llamadas en vivo contra la serie
`FX-AV-B` cargada en PASO 2. Script: `evidencia/paso4-period-comparison.mjs`.

## 1. ¿Compara contra el período correcto, o contra el abierto?

**Contra el correcto — el que se le pide.** Sin `from`/`to` compara los dos últimos por código
(`orderBy: code desc`, tomados de a dos); con `from`/`to` explícitos (formato `YYYY-MM`) compara
exactamente esos. Cada lado lleva su propio `status` (`OPEN`/`CLOSED`) y `source`
(`frozen`/`recomputed`), **no asume que "el segundo" es el abierto**.

**Confirmado en vivo:** con los 4 períodos cerrados, la comparación default trajo M3→M4, ambos
`source: "frozen"`. Se reabrió M4 y se repitió `M3 vs M4`: `to.status` pasó a `"OPEN"`,
`to.source` a `"recomputed"`, y apareció el warning *`""Abril 2026" todavía está abierto: sus
números se van a mover hasta que lo cierres."`* — la fuente se etiqueta según el estado REAL de
cada período, no según una posición fija en la serie.

## 2. ¿Reescala el presupuesto al volumen real antes de restar (R21), o compara totales?

**Pregunta mal dirigida a este módulo — y eso mismo es parte del hallazgo.** `period-comparison`
compara **real contra real** (dos períodos ya cerrados/calculados), no presupuesto contra real:
R21 (desvíos, estándar vs. real) vive en otro módulo (`deviation-service.ts`, ya señalado como
NO VERIFICADO en `AUD-2026-09-14`). Lo que este módulo SÍ hace, correctamente, dentro de su propio
dominio: compara el costo **total** y, si hay unidades cargadas en los dos períodos, también el
costo **por unidad**, con un warning explícito si la producción cambió más de 10% (*"La producción
cambió X% entre los dos meses: mirá el costo POR UNIDAD, no el total"*) — el análogo correcto de
"no comparar peras con manzanas por volumen" en SU dominio.

**Limitación real encontrada en vivo:** sobre la estructura `PROCESSES` de `FX-AV-B`, `unit` dio
**siempre `null`** (`comparable: false`) en las tres llamadas — el campo que alimenta la
comparación por unidad es `period.productionQuantity`, que en esta sesión nunca se cargó (no hace
falta para Procesos, es un campo pensado para Órdenes). El módulo no tiene ningún camino para
sacar "unidades producidas" del cuadro de movimiento de Procesos (`schedule.transferredOut` +
`finishedInStock`, que sí existen). **Con una estructura de Procesos, la comparación por unidad de
este módulo no funciona nunca**, aunque el dato exista en otro lado del mismo período.

## 3. ¿El PE de CADA período se verifica contra el techo de SU tramo?

**No — el módulo no tiene ningún campo de punto de equilibrio, techo de tramo, ni capacidad.**
`PeriodComparison` (la interfaz completa, `period-comparison.ts:102-125`) solo compara:
`total`/`unit` (rawMaterial, directLabor, indirectCosts, productionCost, costOfGoodsSold,
grossMargin), `components`, `materials`, `departments`, `centers`. Ningún campo se llama `pe`,
`puntoEquilibrio`, `tramo` ni `capacidad`. **Confirmado en pantalla** (`05-capturas.md`): la
comparación M3→M4 muestra costo total, variación por elemento y "materia prima: ¿precio o
consumo?" — nada de PE ni de tramo.

**Consecuencia directa:** el escenario central del fixture para M2→M3 (entra el galpón nuevo, el
PE cae **fuera** de su propio techo) **no dispararía ninguna alerta en esta pantalla**. Haría
falta ir al tablero del dueño de M3 específicamente — que si está incompleto (ver R13, hallazgos
de `AUD-2026-09-14`) tampoco lo mostraría.

## 4. El corrimiento de mix de M3: ¿lo informa como mix, o como precio?

**Ninguna de las dos — no lo informa en absoluto.** Por la misma razón que el punto 3: no hay
ningún campo de mix, de contribución marginal por tamaño, ni de precio promedio de venta en
`PeriodComparison`. La pregunta del pedido presupone que el módulo elige entre dos narrativas
("cambió el mix" vs. "bajó el precio"); en los hechos, **no cuenta ninguna de las dos historias**
— es un gap de cobertura, no una elección incorrecta entre alternativas.

## 5. R6 — la amortización del plantel no se mueve entre M1 y M2

**No verificado en vivo esta sesión con Granja** (la cadena `FX-AV-B` cargada es
Planta→Embolsado; Granja, dueña de la amortización del plantel, no se cargó — se prioriza
verificar el mecanismo, no repetir el bloqueo de `04a` que ya se resolvió por otro lado).

**Lo que SÍ se verificó, indirecto pero concreto:** en Costeo por Procesos, `periodCostCif` (y
`periodCostMp`) son **siempre inputs directos** que carga el costista — el motor nunca los deriva
de una fórmula ligada a la producción. Prueba en vivo: `Planta.periodCostCif` fue `$3.384.000` en
M1 y `$3.811.200` en M2 — cifras distintas porque el fixture (y yo, al cargarlo) elegimos números
distintos, no porque el motor recalculara nada en función del volumen. **Para Procesos, R6 no
tiene ningún camino de código para violarse en la carga de datos** — el riesgo real de R6 vive en
la CAPA DE CLASIFICACIÓN (¿un ítem marcado `FIJO` se trata como tal en todos lados?), no en el
motor de Procesos en sí.

**Lectura de código sobre esa capa** (`owner-dashboard-service.ts:205-213`): el "costo fijo por
cajón" que se muestra en pantalla es `Σ(importeAbsorcion de componentes FIJO) ÷ producción DE ESE
período` — dividir un total fijo por la producción de cada mes para expresarlo "por unidad" es
correcto y **no** es lo que R6 prohíbe (R6 prohíbe que el TOTAL absoluto se mueva con el volumen,
no que su expresión unitaria varíe). Si `importeAbsorcion` en sí se deriva en algún lugar de la
actividad real (vía capacidad normal/actividad real de CIF en Órdenes) **no se rastreó hasta la
fuente esta sesión** — declarado **NO VERIFICADO** en esa profundidad, no se afirma que esté bien
ni que esté mal.
