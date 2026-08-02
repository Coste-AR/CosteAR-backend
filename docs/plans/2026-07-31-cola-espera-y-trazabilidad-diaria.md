---
title: "Plan de implementación — Cola de espera, corrida diaria y trazabilidad total"
fecha: 2026-07-31
origen: "Reunión 30/07/2026 + respuestas del socio (Granola 180dcece)"
estado: F1-F6 implementadas (backend) — falta el wizard en el frontend
---

> **Estado al 02/08/2026.** Implementadas y verificadas **F1 a F6**. **F7**
> (alertas por anomalía) sigue fuera de alcance por decisión del equipo.
>
> El backend de **F4** está completo: reglas del setup, servicio, endpoints,
> compuerta de cálculo, el permiso `canReportWipCount` y la procedencia del
> recuento (D7). **Falta el wizard en el frontend** — hoy el setup se puede
> completar por API pero no hay pantalla, así que una estructura de Procesos
> nueva queda bloqueada para calcular hasta que exista.
>
> Ese bloqueo alcanza también a las estructuras de Procesos que ya existían:
> tienen `setupCompletedAt` en NULL y caen en la compuerta. Es intencional —
> nunca declararon su estructura productiva— pero hay que tenerlo presente al
> desplegar.

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

**Por qué esto y no "calcular el costo de cada día".** Ojo con la formulación:
la cátedra **sí admite períodos cortos**. Textual de la clase 40 y de P3:

> Período: el corte temporal (día, semana, quincena, mes) **según la dinámica de
> la empresa**. En un ingenio los cortes son cada 2-3 días porque el jugo de caña
> fermenta.

O sea que "el costo del martes" no es un disparate teórico: es lo correcto para
una empresa cuya dinámica lo pida. Lo que **no** se puede es fijar el corte por
software, desde afuera, sin mirar el proceso productivo.

El límite real no es el calendario, es otro: para cerrar un período hace falta el
grado de avance de lo que quedó sin terminar, y ese dato **no lo produce el
sistema ni el costista** (ver D6). Si la oficina técnica puede informarlo cada
dos días, el período puede ser de dos días. Si informa una vez por mes, el
período es mensual — calcular más seguido no agregaría información, solo la
inventaría.

Por eso el sistema no impone una frecuencia: la pregunta la contesta el cliente
en el setup, y `CUSTOM_DAYS` cubre desde 1 día hasta un año. Lo que se calcula
todos los días es **el período abierto con los datos que llegaron hasta hoy** —
una foto diaria del período en curso. El escenario de la reunión sale igual: el
día 2 se calcula solo y queda sin validar, el día 3 el costista ve todo incluido,
y en trazabilidad quedan las corridas día por día.

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

### D6 — El recuento lo informa la oficina técnica, no el costista

Esto sale de la bóveda y **no estaba en el acta ni en las respuestas del socio**.
Las clases lo dicen tres veces, con las mismas palabras:

> El grado de avance lo determina la oficina técnica (ingenieros/planta) **al
> cierre de cada período, por departamento y por elemento** — el área de costos
> lo recibe y aplica, **no lo estima**. (clase 36)

> El grado de avance lo determina el ingeniero/responsable técnico del proceso,
> no el área de costos. (clase 34)

Tiene tres consecuencias de producto que el plan original no contemplaba:

1. **Hay una segunda cola de espera**, distinta de la de documentos: la del
   recuento de la oficina técnica. Es un insumo de otro rol, que entra por otro
   canal y en otro momento (al cierre del período, no continuamente).
2. **El recuento es por departamento Y por elemento**, no un número por período.
   Una unidad puede estar al 100% en MP y al 50% en conversión. El modelo ya lo
   soporta (`finalWipMpAvance` / `finalWipConvAvance`), pero el flujo de captura
   no existe.
3. **El costista no puede completarlo él.** Si el sistema le pide a él el dato
   que la cátedra dice explícitamente que no le corresponde estimar, lo empuja a
   inventar un número — y ese número después se ve como si fuera un hecho.

Cómo entra en el plan: F4 captura *quién* informa el avance, y F3 le pide el
recuento a ese rol cuando corresponde, en vez de marcar la corrida como
incompleta y dejarla ahí.

### D7 — La oficina técnica NO es un rol nuevo: es un permiso + la procedencia del dato

Decidido el 31/07 tras D6. Se evaluó agregar un `UserRole` nuevo y se descartó.

**Por qué no un rol.** `EMPRESA_OPERATOR` ya es "personal de la empresa cliente"
— la oficina técnica *es* eso. Un valor nuevo en `UserRole` obliga a tocar auth,
RLS, guards, invitaciones y el panel admin, y deja dos roles que en el 95% de las
pantallas hacen exactamente lo mismo. Es mucha superficie nueva para expresar
"este operario, además, informa el recuento".

**Por qué esto sí.** Lo que la cátedra exige no es *quién se loguea*: es que el
grado de avance quede registrado como **informado por la oficina técnica y no
estimado por el área de costos**. Eso es un atributo del DATO, no de la cuenta de
usuario. Y coincide con lo que pidió el socio: configuración previa (el permiso
se otorga en el setup) + notificación reactiva (se le pide a quien lo tiene), con
la responsabilidad del sistema acotada porque quedó por escrito quién informó qué.

Dos piezas:

1. **Permiso**: `OperatorMembership.canReportWipCount` — el costista se lo
   habilita a los operarios que correspondan, en el setup.
2. **Procedencia**: en `UnitMovementSchedule`, `countedAt` / `countedBy` /
   `countSource` (`TECHNICAL_OFFICE` | `COSTIST_ESTIMATE` | `CARRIED_OVER` |
   `NOT_COUNTED`).

El beneficio grande está en `COSTIST_ESTIMATE`: el sistema **no prohíbe** que el
costista cargue el avance si la planta no responde — sería inusable —, pero lo
marca como estimado. Un informe apoyado en avances estimados por costos se puede
señalar como tal, que es exactamente la distinción que hace la cátedra, y el
drill-down de trazabilidad la muestra en vez de esconderla.

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
provisoria por falta de recuento**, y se le pide el dato a la oficina técnica
(D6) — no al costista, que según la cátedra no debe estimarlo. No inventamos
unidades ni % de avance.

**Excepción del primer período** (clase 40 y P3 §3): en el primer período de una
campaña **ningún departamento tiene inventario inicial**, y los departamentos
`sequence > 1` tampoco tienen nada recibido todavía. Una corrida ahí no se puede
marcar como incompleta por falta de existencia inicial: no es que falte el dato,
es que no existe. Va con test propio.

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

**Paso nuevo del wizard (D6):** quién informa el grado de avance de la
producción en proceso, y cada cuánto puede hacerlo. De esa respuesta sale la
frecuencia máxima que le podemos ofrecer al cliente sin inventar números: si la
oficina técnica releva cada 15 días, ofrecer un ciclo de 3 no tiene sentido. El
wizard lo dice explícitamente en vez de dejar que el costista elija una
frecuencia que su propia planta no puede alimentar.

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

## 6. Fuentes de la bóveda usadas

Todo lo de arriba está contrastado contra `costear-vault/costear-knowledge-base`:

- `costeo-procesos/corpus-catedra/P3` §3 y §4 — período como corte temporal según
  la dinámica de la empresa; identidad "inventario final del período 1 =
  inventario inicial del período 2".
- Clase 40 — el corte de 2-3 días del ingenio; el primer período de una zafra sin
  inventario inicial; el grado de avance por elemento lo informa el ingeniero.
- Clase 36 — el grado de avance lo determina la oficina técnica al cierre de cada
  período, por departamento y por elemento; el área de costos lo recibe y aplica.
- Clase 34 — misma regla, dicha de nuevo: lo determina el responsable técnico del
  proceso, no el área de costos.

**Chequeo de consistencia que dio bien:** la clase 36 enuncia la producción
equivalente **restando** el inventario inicial × grado de avance (variante PEPS),
mientras P3 y la clase 40 la enuncian sin restarlo (promedio ponderado). El motor
usa promedio ponderado y está documentado como método único por decisión de
cátedra (`process-costing.ts:950`, DECISIONES.md B10). No hay contradicción con lo
implementado; queda anotado acá para que nadie lo "corrija" leyendo solo la 36.

Y una frase de la clase 36 que es, literalmente, la tesis de esta arquitectura:

> "El número es una consecuencia. Lo que importa es cómo captás la información y
> cómo la acomodás en el cuadro."

---

## 7. Lo que este plan NO resuelve

- El recuento físico sigue siendo un input humano de la oficina técnica: nadie
  puede inferir cuántas unidades a medio hacer quedaron en la planta ni con qué
  grado de avance. Lo que el plan sí hace es pedírselo al rol correcto (D6).
- No hay validación automática por confianza del sistema (la idea de que "a
  medida que se entrene, valide solo"). Requiere historial de correcciones que
  todavía no tenemos volumen para usar.
- Nada de esto define el modelo de negocio ni toca branding.
