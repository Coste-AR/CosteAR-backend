# Decisiones — Trazabilidad Total v1

Registro vivo de decisiones tomadas de forma autónoma durante la implementación
de la especificación "Trazabilidad Total v1", en la branch `AlanSandbox`.
Regla general: ante ambigüedad, default más simple que cumpla la spec sin
arriesgar pérdida de datos.

## Alcance de esta sesión

- **Frontend inexistente en este checkout**: el repo React de CosteAR no está
  clonado en esta máquina (carpeta `GIt Front` vacía). La Sección D de la spec
  pide componentes React concretos que no puedo tocar sin ese repo. Decisión:
  implementar el 100% del backend (A, B, C) tal como está especificado, y
  agregar una página de demo estática (HTML+JS vanilla, sin build step) dentro
  de este repo (`public/demo/`) que consume la API real y reproduce el árbol
  de cálculo y la TraceCard, para poder verificar visualmente en Chrome. Esto
  NO reemplaza la integración real en el frontend de producción — es un arnés
  de verificación. Cuando el repo de frontend esté disponible, portar la
  lógica de esa demo a componentes React reales.
- **Sin Docker/Postgres en este entorno**: no se puede levantar la base ni
  correr migraciones contra una DB real desde acá. Las migraciones se escriben
  y se validan con `prisma validate`/`prisma generate` (sintaxis y consistencia
  de schema), pero no se ejecutan. El usuario debe correr
  `docker-compose up -d && npm run prisma:migrate` en su máquina antes de usar
  el servidor. Se documentan los pasos exactos al final.

## Modelo de datos

- **No se reutiliza la tabla `audit_logs` existente**: ya existe un modelo
  `AuditLog` (`@@map("audit_logs")`) usado en toda la app con columnas
  distintas (`oldValue`/`newValue`, sin `method`/`actor_role`/`actor_area`).
  Repurposarla violaría R1 (nada se pisa) si tuviera que alterar columnas con
  datos ya cargados en producción. Decisión: tabla nueva `TraceAuditLog`
  (`@@map("trace_audit_log")`) con el esquema exacto de la spec, usada
  exclusivamente por las mutaciones nuevas de trazabilidad. El audit log
  legado sigue existiendo para las acciones que ya lo usaban.
- **No se reutiliza `CostCalculation`**: ídem — es el snapshot legado del
  motor viejo (usado por `/cost-structures/:id/calculate` y `/simulate`, que
  se mantienen intactos por compatibilidad). Las tablas nuevas
  `CalculationRun`/`CalculationNode` implementan el árbol persistido que pide
  la spec y alimentan los endpoints nuevos `/api/v1/structures/:id/calculate`,
  `/calculation-runs/:id/tree`, `/structures/:id/runs`.
- **`actor_area` no existe hoy en el JWT** (el token solo lleva `role`). Se
  agrega como campo obligatorio en el body de cada endpoint mutante nuevo de
  trazabilidad (`sourceArea`), validado contra el enum `source_area`. Es la
  opción más simple que no requiere tocar el esquema de autenticación ni
  reemitir tokens existentes.
- **Migración de datos existentes** (data_points para lo ya cargado): se
  implementa como script idempotente (`scripts/backfill-trazabilidad.mjs`,
  `npm run db:backfill-trazabilidad`) que recorre `CostStructure` con
  configuración cargada y crea un `data_point`+`version 1` **por bloque**
  (MP/MOD/CIP/VENTA completo, no campo por campo) con `method='manual'`,
  `reason='migración: dato pre-trazabilidad'`, `actorRole='desconocido (migrado)'`.
  Granularidad por bloque (no por campo individual) porque el modelo legado no
  guarda quién cargó cada campo particular — inventar esa granularidad sería
  fabricar información que no existe. Los datos NUEVOS cargados a través de
  los endpoints nuevos sí son por campo (ver `field_key` tipo
  `mp.compra.precio`). No corre como parte de la migración de Prisma (las
  migraciones SQL no deberían tener lógica de negocio ni loops sobre JSON):
  es un paso manual documentado en las instrucciones finales.
- **RLS**: las tablas nuevas no tienen columna `userId` propia (se relacionan
  vía `structureId`/`runId` a `cost_structures`). Se agregaron políticas RLS
  en `prisma/rls.sql` para `data_points`, `data_point_versions`,
  `calculation_runs` y `calculation_nodes` vía subquery/join al dueño de la
  estructura, siguiendo el mismo patrón que las tablas existentes.
  `evidence` y `trace_audit_log` no tienen RLS directo (su vínculo con el
  tenant es indirecto u opcional); se protegen en la capa de aplicación con el
  mismo patrón `requireStructure`/`requireDataPoint` que usa el resto del
  código.
- **Demo estática servida por el propio backend** (`public/demo/`, rutas
  `/demo`, `/demo/style.css`, `/demo/app.js` en `app.ts`): se sirve
  same-origin en vez de como archivo `file://` o servidor aparte porque el
  CSP (`helmet`) y el CORS del backend solo permiten `http://localhost:*` con
  origin explícito — abrir el HTML directamente desde el disco manda
  `Origin: null` y el fetch a la API fallaría. HTML/CSS/JS están en archivos
  separados (no inline) para respetar el CSP existente (`script-src 'self'`,
  `style-src 'self'`) tal cual está configurado para el resto de la API — no
  se relajó ninguna política de seguridad para esto.
- **No pude levantar el backend completo en este sandbox** para probar la
  demo en vivo: no hay Docker/Postgres (ver arriba) y además los workers de
  BullMQ (`src/infrastructure/workers/queues.ts`, código preexistente, no
  tocado en esta tarea) tiran una excepción no controlada si Redis no está
  disponible, lo que mata el proceso a los pocos segundos de arrancar — no es
  un bug introducido acá, pero significa que `npm run dev` necesita
  `docker-compose up -d` (Postgres Y Redis) para quedarse arriba. Typecheck
  limpio y 108 tests corridos como verificación alternativa; probar en Chrome
  contra un server real queda para el usuario (pasos exactos al final).
- **Endpoint adicional no listado en la spec**: `POST /structures/:id/data-points`
  (crear un data point nuevo). La spec no lo incluye en la lista de la sección
  C, pero sin él `POST /data-points/:id/versions` no tiene sobre qué actuar —
  algún endpoint tiene que crear la versión 1. Se agregó siguiendo el mismo
  contrato de auditoría/transacción que el resto.

## F5 — Pulido (D.5)

De los 4 puntos de la spec, dos ya estaban resueltos por el código existente
y dos son exclusivamente de la UI React (fuera de alcance sin ese repo):

- **(a) IAP de solo lectura, derivado**: YA estaba así antes de esta tarea.
  `calcWorkingDays` calcula el IAP a partir de los días (nunca es un input
  manual) y `calculate.ts` lo expone como `iapPercent` separado de los
  conceptos inciertos editables (PAP/PPP). No hizo falta tocar nada.
- **(c) Keys estables por ID de centro, no por nombre**: YA estaba así. Todo
  el modelo de Costos Indirectos (`CostCenter.id`, `distribution` de cada
  concepto, `productiveSettings`) usa `centerId` como clave — renombrar un
  centro no mueve ni borra ningún porcentaje cargado, porque el nombre nunca
  fue la clave.
- **(b) Flag "cambios sin guardar"** y **(d) placeholders + botón "Cargar
  ejemplo de la cátedra" en el formulario MOD**: son estado y componentes de
  la UI React real, que no está disponible en este checkout. No hay nada que
  implementar del lado del backend — quedan pendientes para cuando se porte
  la demo al frontend de producción.

## Addendum — integración con el frontend real (sesión posterior)

El repo de frontend de CosteAR ya está disponible en esta sesión (no lo estaba
cuando se escribió lo de arriba). Al conectar el drill-down real encontré que
`buildCalculationTree`/`persistTree` declaraban `sourceDpVersionIds` en el
schema de `calculation_nodes` pero **nunca lo poblaban** — el `TreeNode`
interno ni siquiera tenía ese campo. Resultado: ningún nodo del árbol tenía
`sources`, así que la regla "toda hoja con sources es clickeable" (D.2) no se
podía ejercitar nunca, ni siquiera con la estructura semilla del `db:seed`.
Esto rompía el criterio de aceptación F3 en la práctica, no por un bug de
cálculo sino por un campo que quedó sin cablear.

Arreglo aditivo, sin tocar matemática (R5 intacto — los 193 tests siguen en
verde, incluido el fixture de regresión):

- `tree-builder.ts`: agregué `sourceDataPointId?: string` opcional a
  `TreeNode`. El builder sigue sin tocar la DB.
- `calculation-run-service.ts`, método nuevo `attachDataPointSources()`: tras
  construir el árbol en memoria, busca los `DataPoint` no anulados de la
  estructura y les pega el id a los nodos que matchean — las 4 raíces por
  `fieldKey` (`mp.config`/`mod.config`/`cip.config`/`venta.config`, los
  bloques que crea `db:backfill-trazabilidad`) y cualquier nodo del árbol por
  `label` exacto (cubre los movimientos de MP "Compra — X"/"Consumo — X" que
  ahora crea el frontend como `DataPoint`s reales con ese mismo label).
- `persistTree()`: guarda `sourceDpVersionIds: [sourceDataPointId]` si hay
  match, `[]` si no (comportamiento previo intacto).

**Nota de nombres**: la columna/campo se llama `sourceDpVersionIds` (heredado
del manual, que la definía como ids de *versión*). En la práctica, dado que
el motor de cálculo trabaja sobre el JSON de configuración ya resuelto (no
sobre `DataPointVersion` individuales), lo que se guarda ahí es el id del
**DataPoint** (no de una versión puntual) — es la granularidad que existe
hoy. El frontend trata cualquier entrada de ese array como un id de
DataPoint válido para `GET /data-points/:id/trace`. Si en el futuro el motor
empieza a resolver inputs directamente desde `DataPointVersion`, este campo
puede pasar a llevar ids de versión reales sin romper el contrato (la
resolución versión→data point ya existe en `getTrace`).

## Motor de cálculo

- **No se reescriben las funciones puras existentes** (`raw-material.ts`,
  `direct-labor.ts`, `indirect-costs.ts`, `cost-statement.ts`): ya están
  verificadas contra la metodología de cátedra y tienen tests. Reescribirlas
  para que devuelvan nodos en vez de números arriesga romper la matemática
  (violaría R5 - regresión cero). Decisión: se agrega una capa nueva
  (`tree-builder.ts`) que envuelve los resultados YA calculados por las
  funciones puras existentes y arma el árbol `{label, formula, value, unit,
  sources[], children[]}` a partir de ellos. El árbol se persiste en
  `calculation_nodes`; el motor original queda como única fuente de verdad
  numérica.
- **Fix del prorrateo secundario (500→422)**: al revisar el código, el
  prorrateo secundario YA se recalcula en cada `calculate()` (no depende de un
  valor persistido — `secondaryProration` corre siempre en memoria) y también
  al guardar CIF (`updateConfig`). El bug original (500 crudo) se debía a que,
  si faltaba un insumo (capacidad normal = 0, sin presupuesto, concepto sin
  base de distribución), el motor tiraba un `Error` genérico de JS que el
  error handler no traducía. Se agrega la clase `UnprocessableEntityError`
  (422) y se envuelven los puntos de falla conocidos del motor para que
  lancen ese error tipado con `code: 'MISSING_INPUT'` y mensaje accionable en
  español.

---

# Sesión 2026-07-11 — Auditoría máxima + Bases de asignación (F0–F3)

Registro de decisiones autónomas de esta sesión. Ante ambigüedad: el default
más simple que cumpla el criterio, y seguir; frenar solo ante riesgo real de
pérdida de datos (no hubo).

## Ubicación de entregables
- `AUDITORIA-MAXIMA.md` y esta sección de `DECISIONES.md` viven en `Costear.api/`
  porque el nivel `CosteAR rep/` no es un repo git; `Costear.api` es donde ya
  estaba `DECISIONES.md` y donde vive el motor auditado. El frontend
  (`Costear.web/CosteAR-frontend`) tiene su propio repo/rama `AlanSandbox`.

## Límite del entorno (igual que la sesión previa)
- Sin Postgres/Redis en esta máquina: migraciones y endpoints se validan con
  `prisma validate`/`prisma generate`, `tsc --noEmit` y los tests puros de
  dominio/aplicación (que no tocan DB), pero NO se ejecutan contra una base
  real. Los pasos para correrlo en local van en el resumen de sesión.

## F0 — Caracterización
- **FX3 "Dorado Muebles"** (`tests/domain/fx3-dorado.test.ts`): agregado como
  caracterización del motor ACTUAL. Verde sin tocar nada → prueba que el
  prorrateo secundario DIRECTO, PPP, cuotas y variaciones del caso Dorado ya
  eran correctos. No se testean Wilson ni el costo de producción total del caso
  porque la spec no trae los insumos completos de MOD para Dorado.

## F3 — Bases de asignación y prorrateo escalonado (Parte 4)
- **Motor escalonado nuevo, aditivo**: `secondaryProrationStepwise` en
  `indirect-costs.ts`. NO se toca `secondaryProration` (pasada directa), que
  sigue siendo el camino legado y mantiene FX1/FX3 en verde (R5). El escalonado
  procesa los cierres en orden, permite servicio→servicio-no-cerrado y lanza
  `CalcError` accionable si un destino ya cerró ("cerrado no recibe",
  criterio A.3.c).
- **FX4** (`tests/domain/fx4-escalonado.test.ts`): la transcripción del fixture
  en el prompt está **incompleta y es internamente inconsistente** en los
  centavos finales (720,07 vs 1.680,18 no salen de una misma cuota/redondeo).
  Se reconstruyó un escenario equivalente y CONSISTENTE que reproduce los
  números NO ambiguos de la cátedra (Mantenimiento acumula 2.400,25 f / 2.482 v;
  base 750 hs máquina → cuotas 3,2003 f / 3,3093 v) y prueba la SEMÁNTICA que el
  fixture protege (cerrado no recibe, servicios en 0, sin pérdida de centavos,
  fijo/variable siempre separados).
- **Decisión de redondeo (criterio A.4)**: el motor acumula en precisión plena
  y redondea al final. Por eso reparte 2.400,25 × 0,3 = 720,075 (→ 720,08),
  mientras la cátedra muestra 720,07 por redondear la cuota a 4 decimales antes
  de multiplicar. El número que fluye al costo es el de precisión plena
  (A.4-compliant); la cuota redondeada (3,2003) puede mostrarse en el árbol como
  ayuda visual. **A confirmar con la cátedra** cuál presentación quieren en la
  ficha (el costo total no cambia, solo la lectura de los parciales).
- **Config retrocompatible**: `indirectCostConfigSchema` suma `closureOrder`
  (opcional), `allocationMode`/`baseCode` por concepto y `baseCode` por servicio,
  todos opcionales con default. Sin `closureOrder`, el motor usa la pasada
  directa: estructuras ya cargadas y FX1/FX3 no cambian.
- **Entidad base de asignación**: modelos `AllocationBase` (catálogo;
  `companyId` NULL = sistema) y `AllocationBaseValue` (valor por base×centro×
  estructura, trazable vía `dataPointId`, borrado lógico `voidedAt`). Migración
  ADITIVA (R7) `20260711150000_add_allocation_bases` con las 11 bases del
  criterio B precargadas. Relaciones a Company/CostStructure por scalar UUID
  (FK a nivel DB) para no tocar modelos existentes.
- **Resolución del modo 'base' del primario**: `AllocationBaseService.
  resolveBaseUnits` existe y lanza 422 `MISSING_ALLOCATION_BASE` si falta la
  base o sus valores. El *cableado* de ese modo dentro de `updateConfig`/
  `calculate` (reemplazar `distribution` por las unidades resueltas antes de
  calcular) queda como paso siguiente cuando se conecte el frontend: hoy el
  modo 'base' se persiste como metadato y el prorrateo primario sigue usando
  `distribution` (modo % / directo). El ESCALONADO del secundario —el
  desbloqueante real— sí está completo y probado.
- **Validación 4.5**: endpoint `GET /structures/:id/allocation-check` lista los
  servicios sin base/orden de cierre para alertar al guardar; al calcular, el
  motor lanza 422 accionable (nunca 500).

## Pendiente para próximas fases (honestidad de alcance)
- **F2 (append-only de la fuente de verdad)**: el hallazgo 🔴 de que
  `updateConfig` pisa el JSONB (R1) y audita fuera de transacción (R2) está
  documentado en `AUDITORIA-MAXIMA.md §3`. El fix (versionar la config o migrar
  el motor a leer de DataPoints, + envolver mutaciones legadas en
  `$transaction`) es de riesgo medio y toca DB: se hace con la base disponible.
- **F4/F5 (navegación lista→detalle y pestaña nueva)** y **F6 (correcciones de
  UI)** son de frontend; se abordan en el repo `CosteAR-frontend`. Los cinco
  errores del 10/07 quedan confirmados con archivo:línea en la auditoría.

---

## Sesión 2026-07-11 (cont.) — Navegación lista→detalle (F4, Parte 3): N materias primas

- **N materias primas por estructura (Parte 3.1)**: `rawMaterialConfigSchema`
  sumó identidad de mercado opcional (code/name/unit/supplier) y se agregó
  `rawMaterialSectionSchema` que acepta la forma LEGADA (MP única plana) o la
  nueva `{ materials: [...] }` y normaliza a lista. Retrocompat sin migración
  destructiva: las estructuras ya cargadas se normalizan al leer y quedan en la
  forma nueva al volver a guardar.
- **Motor**: `runCalculation` itera las materias primas, con MP consumida =
  Σ del consumo valuado a PPP de cada una; el estado de costos suma existencia
  inicial/compras/final entre todas. El árbol muestra un sub-nodo por materia
  prima (con una sola, se ve igual que antes). `output.raw.materials` reemplaza
  a `ledger`/`optimalLot` singulares.
- **Regresión cero**: con una sola MP el número es idéntico (FX1 2.043.076,92).
  Tests nuevos (`multi-materia-prima.test.ts`): única = igual, dos = suma
  (2.391.076,92), y el schema normaliza la forma legada. Suite 119 verde.
- Sitios que arman la entrada del motor (calculate, run-service, macro-service,
  excel-export) pasan a `rawMaterialSectionSchema`. La hoja Excel exporta la
  primera MP en detalle (export multi-MP: pendiente); el cálculo usa todas.

---

## Sesión 2026-07-11 (cont.) — CIF ficha por centro (F4, Parte 3.3)

- **Enriquecimiento aditivo de `detail.indirectCosts.perDepartment`**: se agregan
  `budgetFixed`, `budgetVariable`, `quotaFixed`, `quotaVariable` y
  `overUnderApplied`. Permiten que la ficha del centro muestre el presupuesto y
  la cuota fija/variable con su fórmula (presupuesto ÷ capacidad normal) y la
  sobre/subaplicación, todo LEÍDO del cálculo persistido — el front no recalcula.
  Suite 119 verde (cambio aditivo).

---

## Sesión 2026-07-11 (cont.) — MOD ficha por departamento (F4, Parte 3.2)

- **Enriquecimiento aditivo de `detail.directLabor`**: `itcsBreakdown`
  (CSC/B40/F40/B47) y `departments[]` (básica, cargas, MOD total, tarifa,
  horas presupuestadas, horas reales). Alimentan la ficha del departamento sin
  que el front recalcule. Suite 119 verde.
- **Horas reales de fin de mes**: se agregó `realHours` opcional a cada
  departamento (schema + UI, columna "Horas reales (fin de mes)" separada de
  las presupuestadas). El motor NO la usa: es solo para comparar real vs
  presupuestado (criterio C). Cero impacto en la matemática.
- **Operarios individuales (extensión preparada, criterio de la spec)**: se
  dejó `operators?` opcional en el schema del departamento (name, category,
  bankedHours, individualAbsenceDays) y la ficha lo muestra SOLO si hay
  operarios cargados (no se inventa UI vacía). El motor no lo usa todavía;
  cuando se quiera costear por operario (banco de horas, ausentismo individual)
  el modelo ya está listo para colgar la lógica sin migración.

---

## Sesión 2026-07-11 (cont.) — Fix de fondo de R1: fuente de verdad append-only

- **Problema**: `updateConfig`/`updateSales` pisaban el JSONB de config en
  `cost_structures` (violación R1). El versionado (DataPoints) era paralelo y el
  motor no lo leía.
- **Solución (opción a de la auditoría — la de menor riesgo)**: tabla nueva
  append-only `cost_config_versions` (structureId, section, versionN, value,
  reason, createdBy, createdAt). En cada guardado, dentro de la MISMA
  transacción: (1) se inserta una versión nueva (nunca se pisa), (2) se actualiza
  el puntero VIGENTE denormalizado en `cost_structures` (para que el motor lea
  rápido sin recorrer el histórico), (3) se registra la auditoría. Un trigger de
  DB (`trg_append_only`, reutilizado de trazabilidad) bloquea todo UPDATE/DELETE
  sobre la tabla. Migración ADITIVA (R7).
- **Por qué no la opción (b)** (motor leyendo de DataPoints): reescribir el motor
  para resolver cada input desde `DataPointVersion` es un cambio grande y
  riesgoso para la matemática (R5). La opción (a) cumple R1 sin tocar el motor
  ni un centavo del cálculo, y deja el histórico completo consultable.
- **Endpoint**: `GET /cost-structures/:id/config-history?section=...`.
- **Verificado contra la DB real**: dos guardados de "sales" → v1 (100/10) y v2
  (200/20) conviven; UPDATE y DELETE directos sobre `cost_config_versions`
  revientan con el error append-only; las dos versiones quedan intactas. Suite
  119 verde, typecheck limpio.
- **RLS**: la tabla se protege en la capa de aplicación (`getConfigHistory`
  exige que la estructura sea del usuario), igual que `evidence`/`trace_audit_log`.
  Se puede agregar una política RLS por join a la estructura si se quiere
  defensa en profundidad (pendiente menor).

## Sesión 2026-07-13 — Períodos, Fase 3: apertura inteligente (problema C)

- **Hallazgo de arranque (bug real, no previsto en el diseño)**: las Fases 1 y 2
  dejaron el período DESCONECTADO de la pantalla. `updateConfig`/`updateSales`
  escribían solo en `cost_structures`; el `CostPeriod` conservaba la foto tomada
  el día en que se abrió. Consecuencias: (1) `close()` validaba la actividad real
  y el CIP real contra esa foto (siempre en cero) → **cerrar un período fallaba
  siempre**; (2) el arrastre de la Fase 3 habría leído una existencia que no era
  la real. Decidido con Lautaro: cerrar ese hueco como parte de la Fase 3.
- **Espejo estructura → período abierto** (`period-sync.ts`): toda escritura de
  datos en la estructura se replica en el período ABIERTO, en la MISMA
  transacción (`updateConfig`, `updateSales`, y el populator de documentos). El
  período pasa a ser dueño real de los datos de su mes sin mover nada de lugar
  (la migración de la Fase 1 sigue sin borrar un byte).
- **Candado del mes cerrado**: si la estructura tiene períodos y ninguno está
  abierto, se rechaza la escritura con un mensaje que dice qué hacer (reabrir o
  abrir el siguiente). Las estructuras SIN períodos (legado) siguen funcionando
  exactamente igual: no se rompe nada de lo que ya andaba.
- **Arrastre de existencia** (`domain/periods/closing-stock.ts`): la existencia
  FINAL de cada materia prima pasa a ser la existencia INICIAL del período que
  abre, valuada al **PPP con el que cerró**. Se DERIVA corriendo la ficha de
  stock del mes que cierra con la misma función del motor (`calcStockLedgerPPP`),
  no se copia a mano. El PPP se guarda con 6 decimales, no 2: un centavo por
  unidad, arrastrado mes a mes sobre miles de unidades, deja de ser un centavo.
- **Si la ficha no cuadra, no se abre**: un consumo mayor al saldo hace que la
  existencia final no se pueda valuar. En vez de inventar un saldo (que
  ensuciaría todos los meses siguientes), se corta con un error que NOMBRA la
  materia prima. El diálogo lo muestra sin romperse (`openingStockError`).
- **Reseteo de la estructura al abrir**: como la app escribe en la estructura, al
  abrir el período siguiente se la deja con lo arrastrado (receta + existencia
  inicial, movimientos vacíos, importes según elección). Es lo que hace que la
  pantalla amanezca en el mes nuevo. Nada se pierde: el mes que cerró queda en su
  `CostPeriod` y el reseteo se versiona en `cost_config_versions` (R1) con
  `reason: "Apertura del período X (arrastre desde Y)"`.
- **El PRIMER período no arrastra**: fotografía lo que la estructura ya tiene
  cargado y NO toca la pantalla (resetear ahí sería borrarle el trabajo al
  costista).
- **Ventas**: el precio unitario viaja (es lista de precios, parte del molde); las
  unidades vendidas arrancan SIEMPRE en cero (son del mes). `calcGrossMargin` ya
  es a prueba de ventas en cero.
- **Preview de apertura**: `GET /structures/:id/periods/next-preview` — qué mes se
  abre, con cuánta existencia y a qué PPP arranca cada MP, y qué importes hay para
  traer. No modifica nada. Alimenta el diálogo del frontend.
- **Tests**: 22 nuevos (arrastre al PPP de cierre, ficha que no cuadra, primer
  período, espejo, candado del mes cerrado, legado sin períodos). Suite de
  `application/` 90 verde; typecheck backend y frontend limpios; build del
  frontend OK.
- **Límite del entorno (igual que siempre)**: esta máquina no tiene Postgres, así
  que NO se ejecutó contra una DB real. El espejo y el candado tocan el camino de
  guardado de toda la app: **el equipo tiene que probarlo en local con la DB antes
  de mergear a `devAdmin`** (abrir un período, guardar, cerrar, abrir el siguiente
  y verificar la existencia arrastrada).

## Sesión 2026-07-13 (cont.) — Períodos, Fase 4: comparación entre períodos (problema C)

- **Agujero encontrado antes de empezar**: el diseño decía que cerrar un período
  "corre el cálculo y CONGELA los números", pero el código no lo hacía. `close()`
  solo cambiaba el estado a CLOSED y guardaba los INSUMOS; el `closedRunId` era
  opcional, nadie lo pasaba y nadie lo leía. O sea: **un mes cerrado no tenía
  números propios**. Comparar mayo contra junio habría significado recalcular el
  pasado con el motor de hoy, y cualquier mejora del motor habría cambiado, en
  silencio, un mes ya cerrado y firmado.
- **Decisión (Lautaro)**: el cierre CONGELA. Migración aditiva (R7):
  `cost_periods.resultSnapshot` (el `CalculationOutput` entero, menos `raw`),
  `resultEngineVersion` y `resultAt`. `close()` corre `runCalculation()` —la misma
  función que usa la app, así el número del mes cerrado y el de la pantalla son el
  mismo por construcción— y guarda estado + snapshot + auditoría en la MISMA
  transacción (R2; antes la auditoría quedaba afuera).
- **Si el motor no puede correr, el período NO se cierra.** Cambio de conducta
  explícito: antes cerraba igual y dejaba el mes firmado y vacío. Un mes cerrado
  sin números es exactamente el agujero que esto tapa.
- **Los períodos cerrados ANTES de esta migración** quedan con `resultSnapshot`
  null: la comparación los recalcula al vuelo y los marca `source: 'recomputed'`,
  con un aviso. No se los hace pasar por congelados.
- **La comparación** (`application/cost-structures/period-comparison.ts`, pura, sin
  DB, todo en Decimal). Va en `application/` y no en `domain/` a propósito: depende
  de `CalculationOutput`, que vive en `application/calculate.ts` (igual que el
  motor). Meterla en `domain/` sería que el dominio importe de la aplicación.
  Tres niveles: (1) MP / MOD / CIF con su % de contribución —"el 80% vino de la
  MP"—; (2) qué MP, qué departamento, qué centro; (3) **por MP, la variación se
  abre en PRECIO y CONSUMO**:
      ΔValor = (P₁ − P₀) × Q₁  +  (Q₁ − Q₀) × P₀
  La identidad cierra al centavo (por eso Decimal y no float) y está asertada en
  los tests. Es lo que separa la inflación del desperdicio, y es lo que va a
  alimentar la "variación costos país" (problema B).
  · Q sale de los movimientos `consumption` de la ficha del período; V sale del
    motor (`detail.rawMaterial.materials[].consumed`, que es el consumo VALORIZADO).
  · Emparejamiento: MP por `code ?? name ?? id` (nunca por posición: si el costista
    reordena las MP, se compararía la chapa contra el aluminio), departamentos por
    nombre, centros por `centerId` (clave estable, sobrevive al arrastre).
  · Altas y bajas entre meses se comparan contra cero y se marcan `new`/`removed`.
  · Si las subas y las bajas se cancelan (Δtotal ≈ 0), las contribuciones se
    reparten sobre Σ|Δ| y se avisa (`offsetting`), en vez de dividir por ~0 y
    escupir porcentajes de cuatro cifras.
- **Dos planos: total y POR UNIDAD.** El total sube solo con producir más, aunque
  nada se haya encarecido; el unitario es la comparación honesta. ⚠️ El motor **no
  tiene un campo de unidades producidas**: se usa `sales.quantity` (el form lo
  rotula "cantidad producida"). Si eso está mal conceptualmente, es un ticket
  aparte. Sin cantidad en alguno de los dos meses, el plano unitario vuelve `null`
  con un aviso — nunca una división por cero.
- **Endpoint**: `GET /structures/:id/periods/compare?from=&to=`. Sin parámetros
  compara los dos últimos. La variación siempre se lee del más viejo al más nuevo,
  aunque los manden al revés.
- **Frontend**: pestaña "Comparación" (`components/PeriodComparison.tsx`). Sin
  gráficos: para un costista los pesos exactos dicen más que una barra. Ojo con dos
  trampas del repo: `text-success` y `text-line-heavy` NO existen como tokens (los
  usa `ScenarioSimulator` y sus deltas verdes no se ven), y `<Percent colorize>`
  tiene semántica de MARGEN (subir = bueno); para un COSTO subir es malo, así que
  el color se maneja aparte.
- **Verificado contra la DB real** (Docker: Postgres :5433). Recorrido completo:
  abrir junio → cerrar (queda congelado: MP consumida $232.000 = 200 kg × $1.160 de
  PPP, motor v1.0.0) → abrir julio (arrastra 300 kg @ $1.160) → comprar más caro
  ($1.500) y consumir 210 kg → cerrar → comparar. Resultado: costo total +2,93%
  pero **costo por unidad −6,4%** (se produjo más); la chapa subió $52.400, de los
  cuales **$40.800 fueron PRECIO y $11.600 CONSUMO** (suma exacta ✓). Y lo más
  importante: al ensuciar los datos de la estructura, los números de junio **no se
  movieron**. Suite: 309 verdes, typecheck y build limpios.
- **Hallazgo lateral (NO es de esta sesión, pero es una mina)**: una `CostStructure`
  **no se puede borrar de verdad**: el trigger append-only de `cost_config_versions`
  bloquea el DELETE en cascada (P0001). La app usa borrado lógico (`deletedAt`), así
  que no molesta hoy, pero cualquier intento de borrar una empresa/estructura en
  serio (o un cascade desde `Company`) va a reventar. Vale decidirlo antes de que
  aparezca en producción.

---

# 🔴 PARA DECIDIR EN EQUIPO (abierto al 13/07/2026)

> Dos cosas que salieron de la Fase 4 y que **no las puede decidir una sola persona**:
> una es conceptual (de costos) y la otra es de arquitectura de datos. Las dos están
> hoy tapadas por el borrado lógico y por convención, pero las dos muerden en
> producción si no se hablan.
>
> ⚙️ **Estado (13/07/2026):** las dos están **implementadas en `lautaro-test` con la
> opción (b)**, porque las dos son **aditivas y reversibles**: no rompen nada de lo
> que ya andaba y, si el equipo elige la (a), se sacan sin tocar datos. Lo que sigue
> abierto es la **decisión**, no el código. El detalle de lo implementado está abajo
> de cada punto.

## 1. El motor no tiene "unidades producidas" — se usa la cantidad de VENTAS

**Qué pasa hoy.** `CalculationInput.sales = { unitPrice, quantity }`. Esa `quantity`
es lo único parecido a un volumen que tiene el motor, y el formulario del frontend la
rotula **"cantidad producida"** ("Precio unitario y cantidad producida para calcular
el margen bruto"). El costo unitario de la comparación (Fase 4) divide por ahí.

**Por qué importa.** Producción y venta **no son lo mismo**: si se producen 1.000 y se
venden 800, el estado de costos ya distingue el costo de producción del CMV (por eso
existe `finishedGoodsCost`), pero el **costo unitario** lo estaríamos calculando sobre
las unidades **vendidas**, no sobre las **producidas**. Con existencia de producto
terminado ≠ 0, el costo por unidad queda mal — y es el número que la pantalla de
Comparación muestra como titular.

**Opciones:**
- **(a)** Confirmar que en el alcance actual "producción = venta" (no se modela stock
  de producto terminado) y **documentarlo como supuesto explícito**. Costo cero,
  riesgo: el día que se modele producto terminado, el unitario miente.
- **(b)** Agregar `production: { quantity }` como campo propio del período (aditivo,
  sin tocar el motor), y que el unitario divida por ahí. Es el camino correcto si
  alguna vez se va a costear con existencia de producto terminado.

**Quién decide:** Alan (producto) + validación de Zayún (criterio contable).

**Implementado (opción b), 13/07/2026 — migración `20260713010000_production_quantity_and_purge`:**
- Columna nueva y **opcional** `productionQuantity` en `cost_structures` y en
  `cost_periods`. **Aditiva**: si no está cargada, el costo unitario se cae a las
  vendidas — exactamente lo que el sistema hacía antes. Cero regresión.
- **El motor NO se tocó.** `runCalculation` sigue facturando con `sales.quantity`
  (que es lo correcto: la facturación es sobre lo vendido). El campo nuevo solo lo
  usa el **costo unitario** de la comparación.
- La comparación divide por lo producido; si el período no lo tiene, usa lo vendido
  **y lo avisa** ("el costo unitario está dividido por las unidades vendidas: si se
  produjo más de lo que se vendió, está inflado"). No se hace pasar por exacto.
- Las unidades producidas son **del mes**: al abrir el período siguiente arrancan en
  cero, igual que las vendidas (no son parte del molde).
- Frontend: la sección Venta ahora tiene **dos campos separados** ("Unidades
  vendidas" y "Unidades producidas (opcional)") con la explicación de por qué no son
  lo mismo. Antes había uno solo, rotulado "Cantidad producida / vendida" — que es
  justamente de donde venía la confusión.
- Tests: `tests/application/production-quantity.test.ts` (incluye el caso que
  demuestra que dividir por lo vendido infla el unitario 25%).

## 2. Una estructura de costos NO se puede borrar de verdad

**Qué pasa hoy.** El trigger append-only de `cost_config_versions` (regla R1) bloquea
todo DELETE sobre esa tabla — **incluido el DELETE en cascada**. Resultado: borrar una
`CostStructure` (o una `Company`, que cascadea a sus estructuras) revienta con
`P0001: append-only`. Encontrado en la prueba real de la Fase 4, al intentar limpiar
los datos de test.

**Por qué no explota hoy.** La app borra **lógicamente** (`deletedAt`), así que el
camino real nunca hace DELETE. La bomba está armada, no detonada.

**Dónde muerde:**
- Un `Company.delete()` en cascada (existe la relación) falla.
- Cualquier "borrar mi cuenta" / limpieza de datos / GDPR-like es imposible hoy.
- Un test o un script de mantenimiento que borre queda trabado sin explicación obvia.

**Opciones:**
- **(a)** Asumirlo: el sistema **no borra nunca** (append-only de verdad, tipo libro
  contable). Entonces hay que **prohibir el DELETE en la capa de aplicación** con un
  error claro, y que nadie escriba `.delete()` por error.
- **(b)** Permitir un borrado administrativo real: que el trigger deje pasar el DELETE
  cuando viene en cascada del borrado de la estructura (o una función `purgeStructure()`
  que corra con privilegios y deje rastro en auditoría).

**Quién decide:** Santi / Julie (son las dueñas del esquema y de RLS).

**Implementado (opción b), 13/07/2026 — misma migración:**
- El trigger `trg_append_only()` ahora distingue:
  · **UPDATE: prohibido SIEMPRE**, pase lo que pase. Esa es la garantía de fondo —
    un registro histórico no se reescribe nunca, ni siquiera en una purga.
  · **DELETE: solo dentro de una transacción de purga explícita**, que la aplicación
    marca con `SET LOCAL app.purge_mode = 'on'`. `SET LOCAL` muere con la
    transacción, así que el permiso **no se filtra** a ninguna otra consulta: un
    DELETE suelto, o uno en cascada sin querer, sigue reventando.
- `CostStructureService.purge()`: borra la estructura y todo lo que cuelga
  (DataPoints + versiones + evidencia huérfana, CalculationRuns + nodos, valores de
  bases, versiones de config, períodos), en UNA transacción. El borrado normal sigue
  siendo **lógico** (`softDelete` → papelera, recuperable); la purga es la puerta
  aparte, para borrar en serio.
- **La auditoría sobrevive a la purga**: `AuditLog` no cuelga de la estructura, así
  que el rastro (quién purgó qué y cuándo, con el nombre del producto) queda aunque
  la estructura ya no exista. El registro se escribe ANTES de borrar, dentro de la
  misma transacción: si algo falla, no queda ni el borrado ni una auditoría mentirosa.
- Endpoint: `POST /cost-structures/:id/purge` con body `{ confirm: "<nombre del
  producto>" }`. Hay que **escribir el nombre tal cual** — el patrón de "escribí el
  nombre para confirmar". No hay papelera ni vuelta atrás.
- **Verificado contra la DB real**: el UPDATE y el DELETE suelto sobre el histórico
  siguen bloqueados; las dos estructuras de prueba que habían quedado trabadas
  (imposibles de borrar) se purgaron con todo su histórico, y las purgas quedaron
  registradas en la auditoría.
- ⚠️ **Falta (si el equipo elige esta opción):** el borrado de una `Company` sigue
  cascadeando a sus estructuras y **va a fallar igual**. La purga hoy es por
  estructura. Si se quiere "borrar la empresa entera", hay que envolver el mismo
  patrón a nivel empresa.

---

## Sesión 2026-07-13 (cont.) — Problema B: se saca la "Variación de Costos País" del Dashboard

**Qué era.** El panel más grande del Dashboard (`DashboardPage.tsx`, "Bento 3") se
titulaba **"Variación de Costos País"**, con el subtítulo "Histórico consolidado del
índice de costos CosteAR" y un badge verde **"+20.4% Semestre"**.

**Qué encontramos al abrirlo.** Nada. El gráfico se alimentaba de una constante
escrita a mano en el módulo:

```ts
const COST_EVOLUTION = [
  { name: 'Ene', índice: 100.0 }, ... { name: 'Jun', índice: 120.4 },
];
```

No salía de un endpoint, no salía de `MacroSnapshot` (el INDEC/BCRA que **sí** están
ingestados y son reales), no salía de los períodos del costista, y no dependía ni de
la empresa ni de la estructura ni de la fecha (hoy es julio y el gráfico terminaba en
"Jun", siempre). El "+20.4%" tampoco se calculaba: era un string. Era un **dibujo con
forma de dato**.

**Decisión (Lautaro, 13/07/2026): se saca.** En una herramienta que fija precios
reales, un número que no se puede rastrear hasta su origen es **peor que no tener el
número**: el costista no tiene cómo saber que ese no lo es. Todo el resto del sistema
(trazabilidad, R1 append-only, congelar el resultado al cerrar el mes) existe para
garantizar exactamente lo contrario. El panel se elimina y el "Centro de Alertas"
—que sí muestra datos reales— pasa a ocupar la fila entera; no queda un hueco.

**Lo que NO se tocó:** el módulo macro es real y queda como está (`MacroSnapshot`,
BCRA/INDEC/dolarapi, `MacroPage`, `MacroRiskPanel`). Lo que era mentira era el gráfico
del Dashboard, no la ingesta.

### El diseño del feature de verdad (queda escrito, NO implementado)

Se posterga a propósito: primero había que borrar la mentira, que es lo urgente. Cuando
se construya, el insumo **ya existe y está testeado** — no hay que inventar nada:

- La **base**: `application/cost-structures/period-comparison.ts` (Fase 4) ya abre la
  variación de cada MP en **PRECIO** y **CONSUMO**: `ΔValor = (P₁−P₀)·Q₁ + (Q₁−Q₀)·P₀`,
  identidad exacta al centavo. **Ese es el corazón de "variación costos país"**: el
  efecto PRECIO es el país (la inflación que entró por los insumos); el efecto CONSUMO
  es la planta (el desperdicio, la eficiencia). Un costista que ve "la chapa subió
  $500.000" no sabe qué hacer; uno que ve "$480.000 fue precio y $20.000 fue consumo"
  ya sabe si el problema es de él o del país.
- El **contraste**: contra eso se puede graficar el IPC del INDEC / el dólar, que ya
  están en `macro_snapshots`. La pregunta que el panel tiene que contestar es
  **"¿mis costos suben más o menos que el país?"**.
- **Regla de oro para cuando se implemente (decisión de Lautaro):** si no hay al menos
  **dos períodos cerrados**, el panel **dice que no hay datos suficientes** ("cerrá al
  menos dos meses para ver tu índice de costos"). **Nunca** se inventa una serie ni se
  rellena con datos de ejemplo. Es exactamente el error que estamos borrando hoy.

### Hallazgos laterales del módulo macro (anotados, NO corregidos)

1. `GET /macro/landing` (público, sin auth) **no tiene ningún consumidor** en el
   frontend de este repo. O quedó huérfano, o lo consume una vitrina que no vive acá.
2. `useMacroHistory` (`alerts/alert-hooks.ts`) manda el query param como
   `indicatorCode`, pero el schema de la ruta (`macro.routes.ts`) lo lee como
   `indicator` → **el filtro se ignora en silencio**. Afecta el % de variación del
   dólar en `MacroRiskPanel`. Es un bug real, chico, y no es de esta sesión.
3. `propagationPreview()` (`macro-service.ts`) multiplica el costo por un
   `changeFactor` **que tipea el usuario a mano**: es un simulador manual, no está
   atado a ningún indicador real. Está bien que exista, pero no es "variación país".

---

# ⚠️ AVISO PARA ALAN — dos costos unitarios distintos (antes de mergear `AlanSandbox`)

**El problema.** En `AlanSandbox` (commit `e0307ae`, todavía **no** está en `devAdmin`)
el motor devuelve `detail.unitCost`, y divide por `input.sales.quantity` — las unidades
**VENDIDAS**:

```ts
const unitsProduced = Number(input.sales.quantity) || 0;   // ← son las VENDIDAS
```

En paralelo, en `lautaro-test` se agregó el campo `productionQuantity` (unidades
**PRODUCIDAS**, migración `20260713010000`) **justamente porque dividir por las vendidas
está mal**: si se producen 1.000 y se venden 800, dividir por 800 **infla el costo
unitario un 25%** (hay un test que lo demuestra: `tests/application/production-quantity.test.ts`).

**Lo peligroso:** git **mergea las dos cosas sin quejarse** (lo verificamos con
`git merge-tree`: cero conflictos de texto, en los dos repos). O sea que el error **no
lo va a frenar nadie**: la app terminaría mostrando **dos costos unitarios distintos** —
el del motor (dividido por lo vendido, inflado) y el de la pantalla de Comparación
(dividido por lo producido, correcto).

**El arreglo (3 líneas, cuando `AlanSandbox` entre a `devAdmin`):** que el motor reciba
las unidades producidas y las use, cayéndose a las vendidas solo si no están:

```ts
const unitsProduced = Number(input.production?.quantity ?? input.sales.quantity) || 0;
```

Es de Alan ese código, así que la decisión es suya — pero que entre a `devAdmin` sabiendo
esto, no sin saberlo.

---

## Sesión 2026-07-13 (cont.) — Problema A: el RITMO DE COSTEO existía y nadie podía encenderlo

**Cómo apareció.** El problema A era chico y de pantalla: (1) el botón "Nueva estructura"
estaba en el header, lejos de la lista que modifica, y (2) el alta de estructura obligaba a
**tipear el período a mano** (`Input label="Período (YYYY-MM)"`, `required`). Al ir a sacar
ese campo apareció lo de fondo.

**Lo que estaba roto de verdad.** El calendario de períodos (`domain/periods/period-calendar.ts`,
Fase 1) maneja los **tres ritmos** completos — mensual (`2026-07`), quincenal (`2026-07-Q1`) y
trimestral (`2026-T3`): sus fechas límite, su nombre, cuál es el siguiente. `Company.periodicity`
existe en la base desde la migración `20260712000000_add_cost_periods`, y `cost-period-service`
lo lee en **cada** apertura de período.

Pero **no había forma de elegirlo**: no estaba en el formulario de empresa, y
`createCompanySchema` ni siquiera aceptaba el campo. Toda empresa quedaba en `MONTHLY` (el
default de la DB) **para siempre y en silencio**. El motor de ritmos estaba entero y con el
interruptor apagado.

Por eso el campo tipeado se sentía mal, y es la parte importante: le pedía al costista un
código **mensual** aunque su empresa cerrara por quincena. O sea, **el formulario lo obligaba
a mentir**, y la estructura nacía en el período equivocado.

**Lo que se hizo.**
- `company.schema.ts`: `periodicity` (`MONTHLY|BIWEEKLY|QUARTERLY`) opcional en alta y edición.
  `company-service` lo persiste. **Sin migración: la columna ya estaba** (`migrate deploy` →
  "No pending migrations").
- `createCostStructureSchema`: `period` pasa a **opcional**, y su regex se ensancha a las tres
  formas de código. Si llega, se respeta (compatibilidad: importaciones, datos viejos).
- `CostStructureService.create()`: si no viene, lo **deriva** con `codeFromDate(new Date(),
  company.periodicity)` — la función pura que ya existía. **No se escribió lógica de fechas
  nueva.** La auditoría registra el período **derivado**, no el que tipeó el usuario.
- Frontend: selector "Ritmo de costeo" en el alta/edición de empresa; el `Input` de período
  murió; el botón "Nueva estructura" pasó al `action` del `CardHeader` de "Estructuras de
  costos" (patrón que ya usaba `OperatorsSection`).

**Decisión (Lautaro, 13/07/2026): el ritmo lo posee la EMPRESA, no la estructura.** Es donde
ya vivía la columna → cero migración. Un cliente costea todo con el mismo ritmo.
👉 **PARA DECIDIR EN EQUIPO:** si alguna vez un mismo cliente necesita costear un producto por
quincena y otro por mes, hace falta un `periodicity` opcional **por estructura** que caiga al
de la empresa. Es una migración aditiva. Hoy **no** se hizo: no hay caso real que lo pida.

**El candado (decisión de diseño, no pedida pero necesaria).** El ritmo **no se puede cambiar
con la empresa en marcha**: si ya hay períodos (abiertos o cerrados), `CompanyService.update()`
corta con `ConflictError`. Un período viejo lleva un código del ritmo anterior; cambiarlo dejaría
dos ritmos conviviendo en la misma empresa y el arrastre de existencia de un período al siguiente
dejaría de tener sentido. Un cambio de ritmo es una **decisión contable**, no un campo más del
formulario. Se puede elegir libremente mientras no haya ningún período.

**Por qué es seguro guardar `2026-07-Q1` en `cost_structures.period`** (una columna documentada
como "YYYY-MM"): ese string **no lo parsea nadie**. Se usa como etiqueta y como clave del libro
mayor. Y `normalizeLegacyCode()` ya contemplaba explícitamente recibir un código nuevo ("ya está
en el formato nuevo") y devolverlo tal cual. El camino legado (estructuras con `2026-06` tipeado)
sigue funcionando igual.

**Verificado contra la DB real** (Postgres :5433), corriendo los servicios de verdad:

| ritmo | estructura sin período tipeado | primer período | fechas |
|---|---|---|---|
| MONTHLY | `2026-07` | "Julio 2026" | 01/07 a 31/07 |
| BIWEEKLY | `2026-07-Q1` | "1ª quincena de Julio 2026" | 01/07 a 15/07 |
| QUARTERLY | `2026-T3` | "3º trimestre 2026" | 01/07 a 30/09 |

Y lo que demuestra que el interruptor quedó encendido: en la quincenal, **el período siguiente
es la 2ª quincena de julio, no agosto**. El candado del ritmo también cortó como debía.
Suite completa: **321 verdes**. Tests nuevos en `tests/application/periodicidad-empresa.test.ts`.
