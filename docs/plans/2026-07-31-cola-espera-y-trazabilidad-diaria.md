---
title: "Plan de implementación — Cola de espera, corrida diaria y trazabilidad total"
fecha: 2026-07-31
origen: "Reunión 30/07/2026 + respuestas del socio (Granola 180dcece)"
estado: propuesta — pendiente de aprobación del equipo
---

# Plan — Cola de espera, corrida diaria y trazabilidad

## 0. De qué se trata, en una frase

Que el sistema **calcule solo, todos los días, el período abierto**, guarde
**cada corrida** con todo su árbol de derivación, y que lo que se le muestra al
costista dependa de un **booleano de validación** — pero que en modo
trazabilidad se vea **absolutamente todo**, validado o no.

---

## 1. Qué YA existe (no se rehace nada de esto)

Antes de proponer, mapeo lo que el repo ya tiene, porque cambia mucho el tamaño
del trabajo:

| Pieza | Dónde | Estado |
|---|---|---|
| Entidad `CostPeriod` (OPEN/CLOSED, snapshot de resultado, reapertura con motivo) | `prisma/schema.prisma:266` | Completa |
| Calendario de períodos (bounds, next, código estable) | `src/domain/periods/period-calendar.ts` | MONTHLY / BIWEEKLY / QUARTERLY |
| Arrastre EF→EI entre períodos, con costo por elemento y del depto. anterior | `cost-period-propagation-service.ts:269` | Completo (B18) |
| Corridas del motor con árbol persistido | `CalculationRun` / `CalculationNode` + `calculation-run-service.ts` | Completo |
| Marca de incompletitud de una corrida | `buildIncompletitud()` en `calculation-run-service.ts:44` | Completa |
| Cola de espera de documentos | `DataEntry` (PENDING/APPROVED/REJECTED/CORRECTED) + `ValidationHistory` | Completa |
| Departamentos de proceso, cuadro de movimiento, costos conjuntos | `ProcessDepartment`, `UnitMovementSchedule`, `JointCostAllocation` | Completos |
| Infra de crons (BullMQ, tz Buenos Aires, registro único) | `workers/repeatable-jobs.ts` | Lista para colgar un job nuevo |
| Bitácora append-only y versionado de config | `AuditLog`, `TraceAuditLog`, `CostConfigVersion` | Completos |

**Conclusión:** el 70% de la arquitectura de la reunión ya está construida. Lo
que falta es el **lazo diario**, el **booleano de validación**, la **frecuencia
configurable** y el **setup previo obligatorio**.

---

## 2. Decisiones que este plan toma (a partir de las respuestas del socio)

### D1 — La frecuencia se configura por estructura, en el seteo inicial

Hoy `periodicity` vive en `Company` (una sola para toda la empresa). El socio
pidió que se configure al crear la estructura de costos, y que admita "cada 10 o
15 días". Se agrega:

- `CostStructure.periodicity Periodicity?` — null hereda de `Company`.
- Valor nuevo del enum: `CUSTOM_DAYS`.
- `CostStructure.periodLengthDays Int?` y `CostStructure.periodAnchorDate Date?`
  — solo para `CUSTOM_DAYS`.

**Por qué esto y no "calcular el costo de cada día":** el costeo por procesos
necesita las unidades que quedaron sin terminar y su % de avance, y ese dato sale
de un recuento físico. Ninguna planta cuenta todos los días. Lo que se calcula
todos los días es **el período abierto con los datos que llegaron hasta hoy** —
una foto diaria del mes en curso, no "el costo del martes". El escenario de la
reunión sale igual: el día 2 se calcula solo y queda sin validar, el día 3 el
costista ve todo incluido, y en trazabilidad quedan las corridas día por día.

### D2 — El booleano de validación va en la corrida, no en el período

`CalculationRun` gana `validated`. El período sigue siendo OPEN/CLOSED. Así:

- El front muestra, por defecto, **la última corrida validada**.
- Si no hay ninguna validada, muestra la última automática **marcada como
  provisoria**, nunca como si fuera un número aprobado.
- Trazabilidad lista **todas** las corridas, con quién y qué las disparó.

### D3 — Standby: el cron no calcula al pedo

El socio pidió que el sistema quede en standby hasta que lleguen datos que
disparen la reformulación. El job diario corre solo si, desde la última corrida,
cambió algo: un `DataEntry` aprobado, una `CostConfigVersion` nueva, un
`UnitMovementSchedule` tocado, o un `DataPoint` nuevo. Si no cambió nada, no
genera corrida (y no ensucia el historial con 30 corridas idénticas).

### D4 — Dato atrasado de un período cerrado: nunca automático

Tres opciones posibles; el default es **preguntar**:

1. `ASK` (default) — se notifica al costista en el momento, con las opciones.
2. `CURRENT_PERIOD` — se imputa al período abierto de hoy.
3. `REOPEN` — reabre el cerrado, recalcula y **propaga en cascada** a los
   posteriores, con confirmación explícita y motivo obligatorio.

La política se elige en el setup previo ("¿qué pasa si hago esto?") y se puede
cambiar después. Si el costista no eligió ninguna, se cae a `ASK`.

**Un período cerrado nunca se recalcula solo.** No por dogma contable — el socio
fue claro en que esto es información interna de gestión, no un libro contable —
sino porque un número que cambia sin que nadie lo haya pedido rompe lo único que
estamos vendiendo, que es la trazabilidad. Reabrir se puede, y el modelo ya
guarda `reopenCount` / `reopenedAt` / `reopenReason` para dejar rastro.

### D5 — Las corridas automáticas no se le atribuyen a una persona

`CalculationRun.executedBy` es FK obligatoria a `User`. Las automáticas se
guardan con el dueño de la estructura, **pero** con `trigger = AUTO_DAILY`, y la
UI nunca dice "lo calculaste vos": dice "cálculo automático del sistema".

---

## 3. Fases

Cada fase = un commit atómico (o dos), con tests verdes antes de pasar a la
siguiente. **Regresión cero en la matemática:** el caso "Piezas mecánicas de
precisión" y los tres casos de ITCS de la cátedra tienen que seguir dando los
mismos números después de cada fase.

---

### F1 — Frecuencia configurable por estructura

**Migración** (aditiva):
- `ALTER TYPE "Periodicity" ADD VALUE 'CUSTOM_DAYS'`
- `cost_structures`: `+ periodicity`, `+ period_length_days`, `+ period_anchor_date`

**Backend:**
- `period-calendar.ts`: soportar `CUSTOM_DAYS`. Código del período = fecha ISO de
  inicio (`2026-08-05`), que es estable y ordenable igual que `2026-08`.
  `label` = "5 al 14 de agosto de 2026".
- Helper `effectivePeriodicity(structure)` → override de la estructura o el de la
  empresa. **Todo** el código que hoy lee `structure.company.periodicity` pasa por
  acá: `cost-period-propagation-service.ts:85` y `:145`,
  `cost-structure-service.ts:119`.

**Tests:** bounds/next/codeFromDate para ciclos de 10 y 15 días, incluyendo
cruce de fin de mes y de año.

**Criterio de aceptación:** una estructura con ciclo de 15 días abre períodos
correlativos sin huecos ni superposición, y una estructura sin override sigue
comportándose exactamente como hoy.

---

### F2 — La corrida sabe a qué período pertenece, y si está validada

**Migración** (aditiva):
- `calculation_runs`: `+ period_id (FK, nullable)`, `+ trigger`, `+ validated bool default false`, `+ validated_at`, `+ validated_by`
- Enum nuevo `RunTrigger { MANUAL, AUTO_DAILY, CLOSE }`
- Backfill: las corridas existentes quedan `trigger = MANUAL`, `validated = true`
  (fueron disparadas a mano por alguien, negarlo sería mentir el historial), y
  `period_id` se resuelve por fecha contra `cost_periods` donde se pueda.
- Índice `(period_id, executed_at DESC)` y `(structure_id, validated, executed_at DESC)`.

**Backend:**
- `calculation-run-service.calculate()` acepta `periodId` y `trigger`; el botón
  del costista sigue creando `MANUAL` pero ahora nace con `validated = true`.
- Endpoint nuevo `POST /calculation-runs/:id/validate` para validar a mano una
  corrida automática (con entrada de bitácora en la misma transacción).
- `GET /structures/:id/runs` gana `?soloValidadas=true|false` (default `false`:
  trazabilidad muestra todo).
- `GET /structures/:id/resultado-vigente` → última validada, o la última
  automática marcada `provisoria: true`.

**Criterio de aceptación:** una corrida automática existe en la base pero no
aparece como resultado vigente hasta que alguien la valida.

---

### F3 — El job diario

**Migración:** `cost_periods` `+ last_auto_run_at`.

**Backend:**
- `src/application/cost-structures/daily-run-service.ts`:
  1. Buscar períodos `OPEN` no borrados.
  2. Chequear el gate de standby (D3): ¿hubo cambios desde `last_auto_run_at`?
  3. Correr el motor que corresponda (Órdenes o Procesos) dentro de una
     transacción; persistir run + árbol + bitácora; `validated = false`.
  4. Si el motor tira `MissingInputError` (422): **no se cae el job** — se guarda
     la corrida marcada incompleta reusando `buildIncompletitud()`, con los
     motivos en español que ya produce.
  5. Aislamiento: un error en una estructura no puede voltear el resto del lote.
- Worker + cola BullMQ nuevos, registrados en `repeatable-jobs.ts` con el mismo
  patrón que `nightly-learning` (cron `0 3 * * *`, tz Buenos Aires, jobId fijo
  para que no se dupliquen entre web y worker).

**Procesos, caso borde importante:** si el período no tiene un recuento fresco de
existencia final, la corrida diaria se hace igual **pero queda marcada como
provisoria por falta de recuento**. No inventamos unidades ni % de avance.

**Tests:** el gate de standby no genera corrida sin cambios; una estructura rota
no frena el lote; la corrida incompleta se guarda con sus motivos.

**Criterio de aceptación:** el escenario de la reunión, punta a punta — día 1
valida y ve; día 2 no entra y queda una corrida `validated = false`; día 3
calcula y el resultado incluye lo del día 2, con las tres corridas visibles en
trazabilidad.

---

### F4 — Setup previo obligatorio (el "CTO inicial")

**Migración:** `cost_structures` `+ setup_completed_at`, `+ has_joint_products bool`,
`+ late_data_policy` (enum `LateDataPolicy { ASK, CURRENT_PERIOD, REOPEN }`, default `ASK`);
`unit_movement_schedules` `+ counted_at`, `+ count_source` (enum `CountSource { COUNTED, ESTIMATED, CARRIED }`).

**Backend:** endpoint `POST /cost-structures/:id/setup` que en una transacción
crea los departamentos en orden, marca coproductos/subproductos, guarda
frecuencia y política de datos atrasados, y sella `setup_completed_at`. Mientras
esté sin sellar, una estructura `PROCESSES` no puede calcular: 422 con mensaje
accionable, nunca 500.

**Frontend:** wizard de 4 pasos al elegir "Costeo por Procesos", con la
advertencia previa que pidió el socio ("¿qué pasa si hago esto?") en cada
decisión que después es cara de cambiar. Los componentes de proceso ya existen
(`DepartmentsTab`, `JointCostsTab`, `UnitMovementTab`): el wizard los reusa, no
los duplica.

**Beneficio directo:** con el mapa de departamentos cargado de entrada, el
clasificador de ingesta deja de adivinar a qué departamento va cada documento —
que es exactamente el problema que se identificó en la reunión.

---

### F5 — Datos atrasados y notificaciones

**Migración:** modelo nuevo `LateDataDecision` (dato, período destino propuesto,
período cerrado afectado, opciones ofrecidas, decisión, quién y cuándo).

**Backend:**
- Al imputar un dato cuya fecha cae en un período `CLOSED`, se aplica la política
  de la estructura. Con `ASK`, se crea la decisión pendiente y se notifica; el
  dato **no entra a ningún cálculo** hasta que se decida (mismo criterio que ya
  usa la imputación pendiente hoy).
- `POST /late-data-decisions/:id/resolve`. Si la decisión es `REOPEN`, corre la
  cascada: reabrir → recalcular → **repropagar el arrastre EF→EI a todos los
  períodos posteriores**, en una transacción, con motivo obligatorio. La lógica de
  arrastre ya existe en `processWipCarryOver()`; hay que envolverla en un
  recorrido hacia adelante.

**Criterio de aceptación:** ningún camino del código recalcula un período cerrado
sin una decisión humana registrada.

---

### F6 — Trazabilidad: ver absolutamente todo

**Frontend:**
- Pestaña Historial: todas las corridas del período, con fecha/hora, disparador
  (automática / manual / cierre), validada sí/no, y el delta contra la anterior.
- Drill-down desde cualquier número del reporte hasta el dato de origen — el
  árbol (`CalculationNode.sourceDpVersionIds`) y la ficha del dato ya existen;
  falta el camino de ida y vuelta desde la vista de período.
- Banda de aviso cuando lo que se está mirando es provisorio, con el motivo en
  castellano.

---

### F7 — Alertas por anomalía (diseñada, NO se implementa ahora)

Queda especificada para no tener que rediseñar después, pero fuera del alcance
de esta tanda por decisión explícita: comparar cada concepto contra su media
móvil de los últimos N períodos y avisar cuando la participación sobre el costo
total se desvía más de X puntos. Se apoya en `Alert` / `AlertSetting`, que ya
existen.

---

## 4. Orden sugerido y por qué

F1 → F2 → F3 es la columna vertebral y hay que hacerla en ese orden: sin
frecuencia configurable el job diario no sabe qué período abrir, y sin el
booleano en la corrida el job generaría ruido visible.

F4 puede ir en paralelo (es sobre todo frontend y no toca el motor).

F5 depende de F1 y F2. F6 depende de F2 y F3. F7 después de todo.

---

## 5. Riesgos

1. **`ALTER TYPE ... ADD VALUE` en Postgres** no corre dentro de una transacción
   en versiones viejas: va en su propia migración, sola.
2. **Volumen.** Una corrida diaria por estructura, con árbol, es del orden de
   30 runs × N nodos por mes por estructura. No es problema hoy, pero los índices
   de F2 no son opcionales y hay que definir política de retención del árbol
   (el resultado se conserva siempre; los nodos de corridas automáticas no
   validadas se podrían podar después de M meses — decisión para más adelante,
   no ahora).
3. **Backfill de `period_id`** en corridas viejas: puede quedar null si la fecha
   no cae en ningún período. Es aceptable y hay que mostrarlo como "corrida
   anterior al modelo de períodos", no esconderlo.
4. **El módulo de Procesos venía desconectado** (punto 4.2 del acta). F3 y F4 lo
   integran de verdad; si al implementarlo aparece que la desconexión es más
   profunda, se corta y se reporta antes de seguir apilando fases encima.

---

## 6. Lo que este plan NO resuelve

- El recuento físico sigue siendo manual: nadie puede inferir cuántas unidades a
  medio hacer quedaron en la planta.
- No hay validación automática por confianza del sistema (la idea de que "a
  medida que se entrene, valide solo"). Requiere historial de correcciones que
  todavía no tenemos volumen para usar.
- Nada de esto define el modelo de negocio ni toca branding.
