---
title: "Plan de implementación — F7: alertas por anomalía"
fecha: 2026-08-04
origen: "F7 del plan 2026-07-31-cola-espera-y-trazabilidad-diaria.md, que quedó especificada pero fuera de alcance"
estado: propuesto
---

# F7 — Alertas por anomalía

Es la única fase del plan del 31/07 que quedó sin hacer. F1–F6 están
implementadas y desplegadas; el módulo de Procesos pasó además la auditoría del
02/08 y los hallazgos H1–H14 (PRs #34 a #38).

---

## 0. En una frase

Que el sistema **avise cuando un número se salió de lo que venía siendo**, con el
motivo escrito en castellano y el camino hasta el dato que lo movió — sin
inventar alarmas cuando todavía no hay historia contra la cual comparar.

---

## 1. Qué ya existe (no se rehace nada)

| Pieza | Dónde | Estado |
|---|---|---|
| `Alert` (userId, companyId, structureId, type, message, threshold, actualValue, isRead, emailSentAt) | `schema.prisma:612` | Completo |
| `AlertSetting` (umbral de margen, emailNotifications) | `schema.prisma:636` | Completo |
| `AlertType { MARGIN_BELOW_THRESHOLD, MACRO_CHANGE, COST_SPIKE }` | `schema.prisma:606` | `COST_SPIKE` declarado y **nunca emitido** |
| `AlertService` (list, markRead, get/updateSettings, `createMarginAlert` con dedup 24h) | `application/alerts/alert-service.ts` | Completo |
| Rutas HTTP de alertas | `http/routes/alert.routes.ts` | Completas |
| Pantalla de alertas + config de umbral + `MacroRiskPanel` | `features/alerts/AlertsPage.tsx` | Completa |
| Email de alerta de margen | `email-service.ts:195` (`sendMarginAlert`) | Completo |
| Emisor de alertas hoy | `workers/recalculate.worker.ts` | Solo margen bajo umbral, ante cambio macro |
| **Comparación entre períodos por concepto**, con contribución %, efecto precio/consumo y detección de compensación | `cost-structures/period-comparison.ts` | Completa — **es la mitad del trabajo de F7** |
| **Variaciones de CIF**: sub/sobreaplicación, variación presupuesto, variación volumen | `domain/calculations/indirect-costs.ts:434-497` | Completas, se calculan y nadie las mira |
| Corridas con período, disparador y booleano de validación | `CalculationRun` (F2) | Completo |
| Job diario con standby y aislamiento | `daily-run-service.ts` (F3) | Completo |

**Conclusión:** el detector no hay que inventarlo. `comparePeriods()` ya produce,
para dos períodos, la variación de cada concepto con su contribución al total.
Lo que falta es (a) generalizarlo de *dos períodos* a *un período contra su
media móvil*, (b) decidir cuándo se dispara, y (c) que la alerta llegue a
alguien.

---

## 2. Decisiones que este plan toma

### D1 — Tres familias de señal, no una

El plan del 31/07 especificaba una sola: participación de cada concepto contra su
media móvil. Al revisar el código aparecieron dos señales más que ya están
calculadas y no cuestan casi nada:

| # | Señal | Base de comparación | Necesita historial |
|---|---|---|---|
| S1 | **Desvío de mezcla**: la participación de un concepto sobre el costo total se movió más de X puntos contra su media móvil | Últimos N períodos cerrados | Sí (≥3) |
| S2 | **Salto de costo unitario**: el costo por unidad de un concepto se desvía más de X% de su media móvil | Últimos N períodos cerrados | Sí (≥3) |
| S3 | **Variación de CIF desfavorable**: sub/sobreaplicación, variación presupuesto o variación volumen por encima de un umbral | El presupuesto del propio período | **No** |

S3 es la que da valor desde el día uno y desde el primer período, porque no
compara contra el pasado sino contra el presupuesto que el costista ya cargó. Y
es exactamente el análisis que la cátedra enseña (clases 14, 16, 25, 35, 37): la
variación volumen desfavorable *es* capacidad ociosa. Hoy el motor la calcula y
el número muere en el reporte.

### D2 — Se compara por unidad y por participación, nunca por importe total

Un período que produjo el doble tiene el doble de costo total y no pasó nada
raro. `period-comparison.ts` ya advierte esto explícitamente cuando el volumen se
mueve más de 10%. Además, con `CUSTOM_DAYS` (F1) los períodos pueden durar
distinto: un ciclo de 10 días contra uno de 15 no es comparable en total.

La participación % es invariante a la escala y el costo unitario está normalizado
por producción: las dos bases sirven, el importe total no. Si el período no tiene
cantidad producida ni vendida, **S2 no se evalúa** y se dice por qué, en lugar de
dividir por lo que haya a mano.

### D3 — La base de comparación son períodos CERRADOS con corrida validada

No las corridas automáticas diarias. Un período en curso el día 3 de 30 tiene una
mezcla que no significa nada: llegó la factura de materia prima y todavía no la
mano de obra, así que la MP participa el 95% del costo. Alertar sobre eso sería
generar una alarma por período, siempre, el mismo día.

Consecuencia directa: **la evaluación se dispara al cerrar el período** y al
validar la corrida de cierre — no en el job diario. El aviso llega cuando el
número es firme.

Hay una excepción que vale la pena, pero **no en esta tanda**: una evaluación
temprana sobre el período abierto cuando ya transcurrió ≥70% de su duración *y*
entraron las tres familias de costo. Queda anotada en §6 y se decide después de
ver cuántas alertas produce el modo cerrado.

### D4 — Sin historia suficiente no se alerta, y se dice

Con menos de 3 períodos cerrados no hay media móvil: hay un número anterior, que
no es lo mismo. La media móvil de una sola observación convierte cualquier
segundo período en anomalía.

En ese caso S1 y S2 no emiten nada y la pantalla muestra "todavía no hay
suficiente historia para detectar desvíos (van 1 de 3 períodos cerrados)". S3
funciona igual desde el primero.

Esto es la contracara de la misma regla que gobierna todo el producto: si el dato
no está, se dice; no se estima.

### D5 — Umbral en puntos porcentuales, no desvíos estándar

Se evaluó z-score. Se descarta para v1: con N=3 a 6 observaciones el desvío
estándar es ruido, y sobre todo **nadie lo puede explicar**. "La materia prima
pasó de representar el 40% al 58% del costo" es una frase que el costista le
repite a su cliente. "Se desvió 2,3 sigmas" no.

El umbral es configurable por usuario y arranca en:
- S1: **10 puntos** de participación.
- S2: **20%** contra la media móvil.
- S3: **5%** del CIF aplicado.
- Ventana: **6** períodos, mínimo **3**.

Los defaults se calibran contra datos reales antes de encender los emails (§5).

### D6 — Una alerta por concepto y por período, no una por corrida

Dedup por `(structureId, periodId, type, conceptKey)`. El patrón de 24h que usa
`createMarginAlert` no sirve acá: si el período se reabre y se recalcula tres
veces, la misma anomalía no puede generar tres alertas. Si el desvío desaparece
al recalcular, la alerta se **resuelve** (`resolvedAt`), no se borra — el
historial de lo que el sistema avisó es parte de la trazabilidad.

### D7 — El email es un digest, no un mail por alerta

`sendMarginAlert` manda un mail por alerta porque hay una sola por estructura. Con
tres señales × N conceptos × M estructuras, el mismo patrón le llena la casilla al
costista y la próxima la manda a spam. Un solo mail diario con todo lo que se
detectó, y si no se detectó nada no se manda nada.

---

## 3. Fases

Cada fase = un commit atómico, tests verdes antes de seguir. **Regresión cero:**
el caso "Piezas mecánicas de precisión" y los tres casos de ITCS tienen que dar
los mismos números después de cada fase — F7 no toca el motor, solo lo lee.

### F7.1 — El detector, como módulo puro

`src/domain/alerts/anomaly-detection.ts`. Recibe la serie de resultados ya
calculados y devuelve los hallazgos. **No toca base de datos ni Prisma**, igual
que `period-comparison.ts`. Toda la aritmética por `Decimal`.

```ts
export interface AnomalyInput {
  current: { periodCode: string; label: string; result: FrozenCalculation; units: number | null };
  history: { periodCode: string; result: FrozenCalculation; units: number | null }[]; // cerrados, del más nuevo al más viejo
  thresholds: AnomalyThresholds;
}

export interface AnomalyFinding {
  signal: 'MIX_DEVIATION' | 'UNIT_COST_JUMP' | 'CIF_VARIANCE';
  conceptKey: string;          // 'rawMaterial' | 'directLabor' | 'indirectCosts' | id de centro | key de MP
  conceptLabel: string;
  severity: 'info' | 'warn' | 'critical';
  actual: number;
  baseline: number | null;     // null en S3: no hay media, hay presupuesto
  deviation: number;           // puntos (S1) o % (S2, S3)
  message: string;             // castellano, sin ids ni endpoints
  explanation: string[];       // el desglose: efecto precio vs consumo cuando aplica
  periodsUsed: number;
}

export function detectAnomalies(input: AnomalyInput): AnomalyFinding[];
```

Reusa de `period-comparison.ts`: `consumedQuantitiesOf()` para el efecto
precio/consumo, y el criterio de emparejado por clave estable (`materialKey`,
`centerId`) — si el costista reordena las materias primas entre períodos, comparar
por posición compararía la chapa contra el aluminio. Eso ya está resuelto ahí y no
se duplica.

**Tests** (los de esta fase son los que importan, el resto es plomería):
- serie plana → cero hallazgos;
- salto de 18 puntos en la participación de MP → un hallazgo S1 con el mensaje correcto;
- producción que se duplica sin cambios de precio → **cero hallazgos** (la trampa que motiva D2);
- 2 períodos de historia → cero hallazgos S1/S2 y el motivo "historia insuficiente";
- período sin cantidad producida → S1 sí, S2 no;
- variación volumen desfavorable con un solo período → un hallazgo S3.

### F7.2 — Persistencia y configuración

**Migración** (aditiva, dos archivos: el `ALTER TYPE` va solo — riesgo 1 del plan del 31/07):

1. `ALTER TYPE "AlertType" ADD VALUE 'MIX_DEVIATION'`, `'UNIT_COST_JUMP'`, `'CIF_VARIANCE'`.
   `COST_SPIKE` queda declarado y sin uso, como está hoy: borrarlo obliga a
   recrear el enum y no gana nada.
2. `alerts`: `+ period_id (FK nullable, SetNull)`, `+ run_id (FK nullable, SetNull)`,
   `+ concept_key`, `+ severity`, `+ baseline_value`, `+ details Json`,
   `+ resolved_at`. Índice `(cost_structure_id, period_id, type, concept_key)` para
   la deduplicación de D6, e índice `(user_id, resolved_at, created_at DESC)` para
   la pantalla.
3. `alert_settings`: `+ anomaly_enabled bool default true`,
   `+ mix_deviation_points`, `+ unit_cost_jump_pct`, `+ cif_variance_pct`,
   `+ lookback_periods default 6`, `+ min_periods default 3`,
   `+ email_digest bool default true`.

**Backend:** `AlertService` gana `createAnomalyAlerts(structureId, periodId, runId, findings)`
— una transacción que inserta las nuevas, marca `resolvedAt` en las que dejaron de
darse para ese período, y no toca las que siguen vigentes. `list()` gana filtro por
tipo y por `resolved`.

**Criterio de aceptación:** recalcular el mismo período tres veces deja exactamente
las mismas alertas, sin duplicados y sin resucitar las resueltas.

### F7.3 — El enganche: cuándo se evalúa

`src/application/alerts/anomaly-service.ts` — orquesta: junta el período actual y
los N cerrados anteriores, lee los umbrales del usuario, llama a `detectAnomalies()`,
persiste.

Se dispara en dos puntos, los dos del lado del cierre (D3):
- `CostPeriodService.close()`, después de congelar el resultado;
- `POST /calculation-runs/:id/validate` (F2), cuando la corrida validada es la del
  período que se está por cerrar.

**Aislamiento, como en F3:** si la detección falla, **el cierre del período no se
cae**. Se loguea y sigue. Un bug en las alertas no puede dejar a una estructura sin
poder cerrar — eso es exactamente el hallazgo A1 de la auditoría, y no lo vamos a
reintroducir por la puerta de al lado.

Endpoint nuevo: `GET /structures/:id/periods/:periodId/anomalies` para que la vista
del período muestre los hallazgos sin depender de la bandeja de alertas.

**Tests:** cerrar un período con desvío crea las alertas; el detector que tira
excepción no impide el cierre; reabrir y cerrar de nuevo no duplica.

### F7.4 — Frontend

`AlertsPage.tsx` ya tiene la lista, el contador y la configuración. Se le agrega:

- **Filtro por tipo y estado** (vigentes / resueltas / todas). Hoy lista todo mezclado.
- **Detalle del "por qué"**: valor actual, media móvil, cuántos períodos se usaron y
  el desglose precio/consumo cuando existe. Sin eso la alerta es una afirmación sin
  respaldo, que es justo lo que el producto no vende.
- **Link al período y a la corrida** — el drill-down de F6 ya existe, hay que
  enchufarlo.
- **Estado vacío honesto**: "van 1 de 3 períodos cerrados, todavía no puedo detectar
  desvíos" en lugar de "Todo tranquilo" (D4). Mentir la cobertura es peor que no
  tenerla.
- **Configuración**: los umbrales nuevos, con el texto de qué significa cada uno.
- Badge de anomalías en la vista del período, junto a la banda de "provisorio" de F6.

### F7.5 — Digest por email

`EmailService.sendAnomalyDigest(to, structures[])` — un mail por costista por día
con todo lo detectado, agrupado por estructura, con link directo. Se cuelga del job
diario existente en `repeatable-jobs.ts` (mismo patrón que `nightly-learning`,
cron propio, tz Buenos Aires, jobId fijo).

Respeta `emailNotifications` y `emailDigest`. Si no hay nada que contar, no se manda
el mail: un digest vacío diario entrena al costista a ignorar el remitente.

**Se enciende último y detrás de flag** (§5).

---

## 4. Orden y dependencias

F7.1 → F7.2 → F7.3 es la columna vertebral. F7.4 depende de F7.2 (necesita los
campos nuevos). F7.5 depende de todo y va detrás del flag.

F7.1 se puede hacer y testear entero sin tocar la base: es un módulo puro con
tests de tabla. Es donde está el riesgo real (calibrar qué es una anomalía) y donde
más barato sale equivocarse.

---

## 5. Calibración antes de encender

Esto no se despliega con los emails prendidos. Secuencia:

1. F7.1 a F7.4 en producción con `anomaly_enabled = true` y `email_digest = false`.
   Las alertas se generan y se ven en la pantalla; nadie recibe un mail.
2. Dos semanas mirando cuántas salen y cuántas eran reales.
3. Ajustar los defaults de los umbrales con esos datos.
4. Recién ahí F7.5.

**Por qué.** Un detector de anomalías mal calibrado no es neutro: enseña a ignorar
las alertas. Después de tres avisos que no eran nada, el cuarto —que sí lo era— ya
no se lee. Es más caro que no tener alertas, y no se arregla bajando el umbral
después.

---

## 6. Lo que este plan NO resuelve

- **Evaluación temprana sobre el período abierto** (D3). Es lo que más se parece a
  "avisame antes de que sea tarde", pero exige decidir a partir de qué punto del
  período la mezcla ya significa algo. Se decide con los datos del paso 2 de §5.
- **Alertas de la empresa cliente**, no del costista. Hoy `Alert.userId` apunta al
  costista. Que el operario de la PyME reciba el aviso es otro alcance (permisos,
  canal, redacción) y no está pedido.
- **Causa raíz automática.** El sistema dice "la MP pasó de 40% a 58% y $480.000 de
  esa suba fue precio". No dice *por qué* subió el precio. El contraste macro
  (`MacroContrast` en `period-comparison.ts`) es lo más cerca que estamos y ya
  existe; engancharlo a las alertas es un candidato para después.
- **Detección multivariada** (que dos conceptos se muevan juntos). Requiere volumen
  de historia que ningún cliente tiene todavía.

---

## 7. Fuentes de la bóveda

- Clases 14, 16, 25 — prorrateo primario/secundario y **variaciones**: la
  descomposición presupuesto/volumen que usa S3.
- Clases 35, 37, 38 — variaciones en costeo por órdenes; la variación volumen
  desfavorable como capacidad ociosa.
- El chequeo de método único (promedio ponderado) de `DECISIONES.md` B10 sigue
  valiendo: F7 lee resultados del motor, no recalcula nada, así que no puede
  introducir una variante de método por la ventana.
