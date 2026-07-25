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

---

## Sesión 2026-07-13 (cont.) — Problema 3: el dictado por voz

**Por qué "no funcionaba bien".** No era una cosa: eran cuatro. El dictado estaba
**copiado y pegado a mano en 4 lugares** (`ChatComposer`, `NewCompanyForm` de
`CompaniesPage`, el `AiSuggesterSection` local de `CompanyDetailPage`, y un
`components/AiSuggesterSection.tsx` **que no renderizaba nadie**), cada copia con sus
propios bugs y ninguna compartiendo una línea con las otras.

Los tres que lo rompían de verdad:

1. **`continuous = false`** en tres de las cuatro copias: el navegador **corta el
   micrófono al primer silencio**. El costista frenaba a pensar —describiendo un proceso
   productivo, o sea justo cuando más se piensa— y el micrófono se apagaba solo, sin
   avisar. Para "contame cómo produce tu empresa" era inusable.
2. **Frases perdidas** en `ChatComposer` (la única con `continuous = true`): hacía
   `setText(text + nuevo)` con un `text` **congelado en el momento de arrancar**
   (stale closure). Con `continuous`, el handler corre una vez por frase, y todas leían
   el mismo `text` viejo: **la 2ª frase pisaba a la 1ª, la 3ª a la 2ª.** Dictabas tres
   oraciones y quedaba una. El tipo del prop lo habilitaba: `setText: (t: string) => void`
   ni siquiera permitía la forma funcional.
3. **Silencio ante el error.** Dos copias no tenían `onerror` **en absoluto**; las otras
   dos hacían `console.error`. Micrófono bloqueado por el navegador, sin micrófono
   conectado, o el servicio de voz caído → el botón dejaba de titilar y **nada más**.
   El usuario no tenía cómo saber qué pasó.

Además: sólo se leía `results[0]` (se tiraba todo lo que venía después), no había limpieza
al salir de la pantalla (el micrófono podía quedar prendido), `start()` sin `try/catch`
(doble clic → `InvalidStateError`), y `CompaniesPage` mostraba **"Deteniendo…"
MIENTRAS grababa** — la pantalla mentía sobre lo que estaba pasando.

**Lo que se hizo.** Un solo hook, `src/lib/use-dictation.ts`, y las tres pantallas vivas
pasan por ahí. `continuous = true`; **se reengancha solo** si el navegador corta igual
(Chrome lo hace tras un silencio largo, aunque esté en `continuous`) — eso es lo que
permite frenar a pensar. El texto reconocido se **entrega** (`onText`) y el que llama lo
agrega con la forma funcional, así que no puede pisar nada. Cada código de error del
navegador tiene un mensaje que dice **qué pasó y qué hacer** (`not-allowed` → "habilitá
el micrófono desde el candado de la barra de direcciones"). Se lee desde `resultIndex`,
se aborta al desmontar, y `start()` va en `try/catch`.

**Archivos muertos borrados** (con OK de Lautaro; nadie los importaba, verificado con
typecheck y build después de borrarlos): `components/AiSuggesterSection.tsx` (la 4ª copia
del dictado, la que no renderizaba nadie) y `components/NewStructureForm.tsx` (copia
huérfana con el campo período tipeado que acabábamos de matar). Eran la trampa clásica de
"arreglé la copia equivocada".

**El techo de este enfoque (queda anotado, NO se hizo).** El reconocimiento lo hace el
**navegador** (Chrome manda el audio a Google), no un servidor nuestro. Por eso no
necesita clave de API y anda hoy mismo — pero **no entiende el vocabulario de costos**:
"prorrateo", "PPP", "CIF", "$1.250,50" salen mal. Arreglar eso pide **Whisper del lado del
servidor** (Groq ya está en el proyecto y ofrece `whisper-large-v3`), donde se le puede
pasar una lista de términos del oficio para que los transcriba bien.
👉 **Decisión de Lautaro (13/07/2026): primero el arreglo del navegador** —anda ya, sin
clave— y **Whisper queda como el paso siguiente.** No se hizo ahora porque la clave de
Groq en local es un placeholder: se podría escribir, pero no probar de punta a punta, y
este proyecto no entrega cosas sin probar.

⚠️ **Hallazgo lateral (real, no de esta sesión):** el guard `isConfigured` de Groq es
`this.apiKey.length > 10`, y el placeholder `'groq_placeholder'` tiene 16 caracteres →
**pasa el guard**. O sea que en local no degrada elegante: dispara el HTTP igual, se come
un 401 y lo esconde en un `console.error`. Cuando se toque Whisper, arreglar esto también.

---

## Sesión 2026-07-20 — T00: sincronización de `AlanSandbox` con `staging` (paso previo, bloqueante)

**Objetivo.** Poner `AlanSandbox` al día con `staging` ANTES de arrancar una tanda de
features nueva, para que cualquier conflicto se resuelva sobre una base limpia y no se
apile encima de trabajo nuevo.

**Qué se encontró.** `AlanSandbox` no tenía **nada** por delante de `staging` (solo estaba
atrasado): `staging` había avanzado 2 commits desde el PR #16 (el merge de `AlanSandbox` a
`staging` + `031e9cf fix(validaciones): validar período real al cargar/editar el Libro de
Costos`). Como no había nada propio por delante, el `git merge origin/staging` fue un
**fast-forward** puro: **cero conflictos**, sin commit de merge. Solo se movieron 3 archivos
(no de esquema): `validaciones-service.ts`, `validaciones.routes.ts`, `cost.schema.ts`.

**Verificación (todo en verde):**
- `npm run typecheck`: limpio.
- `npm test`: **57 archivos, 474 tests verdes, 1 skip.** (Los errores de "Can't reach
  database server" en el log son de un test que degrada elegante cuando la DB está apagada
  — igual pasa.)
- Migraciones desde cero contra una **DB de scratch limpia** (`costear_scratch` en el
  Postgres de Docker, para no ensuciar los datos de desarrollo): `npm run prisma:deploy`
  aplicó las 40+ migraciones sin error, terminando en
  `20260713010000_production_quantity_and_purge` (la esperada). `npm run db:rls` aplicó
  las 37 políticas RLS sin advertencias.

**Decisión — `prisma migrate diff` (contrato de merge-readiness, regla #6).** El diff
entre la DB migrada y `schema.prisma` NO da vacío, pero **todas** las diferencias son
patrones intencionales YA presentes en `staging` (no las introdujo este sync, que solo tocó
3 archivos ajenos al esquema):
1. `id` de varias tablas: la DB tiene default `gen_random_uuid()` y el schema usa
   `@default(uuid())` (lado cliente). Es el artefacto clásico de dirección de comparación
   DB→schema en Prisma; no es drift.
2. `cost_periods.updatedAt`: default `Now` en DB vs `@updatedAt` (lado cliente). Ídem.
3. `cost_config_versions`: FK sobre `structureId` presente en la DB pero no en el modelo
   Prisma. Es **deliberado y está documentado** en el propio `schema.prisma:899`
   ("Relaciones por scalar UUID (FK a nivel DB en la migración) para no tocar los modelos
   existentes"). No es drift.
   → Conclusión: no hay drift real introducido por T00. No se toca nada del esquema ni de
   las migraciones (reglas #5 y #6: no reinterpretar ni "mejorar").

**Sobre el commit.** El merge fue fast-forward, así que Git no creó commit de merge y el
árbol quedó limpio (el `npm install` solo reconció `node_modules`; el lockfile ya venía
actualizado por el fast-forward). Este único commit local de la tarea agrega esta entrada
de `DECISIONES.md` (regla #8). `AlanSandbox` queda 1 commit por delante de `staging` (solo
esta documentación). No se hace push ni PR (reglas #1–#3): Alan pushea a mano.

## Sesión 2026-07-20 — F01-A: prorrateo secundario por PARES EXPLÍCITOS (fin del mapeo posicional)

**Problema (testeo caja negra del 20/07, DEVS-Testeo-Ronda-2).** Cualquier estructura con
centros de servicio no se podía calcular: devolvía *"El centro «serv3» no puede repartirse a
sí mismo"* o —peor— repartía los porcentajes al centro equivocado sin avisar. Causa raíz: la
UI omitía la columna del propio centro de cada fila y el backend leía esos valores por
POSICIÓN contra la lista completa de centros, corriendo un lugar el mapeo. El tercer valor
(que la UI mandó para Adm. Planta) aterrizaba en el propio centro de la fila. El bug no rompía
siempre: cuando no tiraba error, mentía (60/40 podía aplicarse como 40/60).

**Decisión de contrato — PARES EXPLÍCITOS.** El reparto secundario ya no viaja como un array
cuyo significado depende del índice. Cada valor viaja con su centro destino:
`serviceDistributions[].distributions: { centroDestinoId: string, fijo: number, variable: number }[]`.
El id del destino está SIEMPRE presente → es imposible que un valor aterrice en el centro
equivocado por un desfasaje de columnas. Se actualizó el schema Zod (`cost.schema.ts`), el
motor (`indirect-costs.ts`) y el wiring (`calculate.ts`). Las fórmulas de la cátedra NO se
tocaron: el prorrateo directo y el escalonado siguen dando los mismos números (FX3/FX4 verdes).

**Retrocompatibilidad — ADAPTADOR DE LECTURA (no migración de datos).** Se eligió un adaptador
de lectura, NO reescribir los datos guardados. Razones:
- Las versiones históricas append-only (`CostConfigVersion`) NO se pueden tocar (regla #5 y #4):
  deben quedar legibles tal como se escribieron. Una migración que reescribiera configs las
  pondría en riesgo; un adaptador de lectura las respeta por completo.
- `normalizeServiceDistribution` convierte en memoria la forma vieja por Records
  (`toProductive` / `toProductiveFixed` / `toProductiveVariable`, keyed by id) a los pares
  nuevos, tomando la unión de claves (`fijo`/`variable` del Record discriminado, con fallback
  al combinado). Se aplica al parsear (schema) y también, defensivamente, en el motor.
- La config vigente se "migra" sola y sin script: cuando el usuario re-guarda Costos Indirectos,
  se persiste en la forma nueva por pares (bump de versión append-only, no reescritura de
  historial). No hace falta migración de base de datos → esta tarea NO agrega ninguna migración
  ni toca `schema.prisma`, `rls.sql` ni `migration_lock.toml` (regla #6 satisfecha por vacío).
- **Ambigüedad = fallar fuerte, no adivinar (regla #4).** Si una config legada trae como destino
  el PROPIO centro (la huella del bug) o un centro que ya no existe (claves posicionales "0"/"1",
  centro borrado), el adaptador la convierte igual y el motor la RECHAZA al calcular con un 422
  accionable en español y por NOMBRE humano, en vez de reasignar porcentajes en silencio.

**Lectura para el frontend (contrato que consume F01-B).** `GET /cost-structures/:id`
(`getById`) normaliza el bloque de Costos Indirectos con `normalizeIndirectConfigForRead`:
el frontend recibe SIEMPRE `distributions`, aunque la estructura se haya guardado antes del
cambio. F01-B solo tiene que renderizar y mandar la forma por pares; no necesita su propio
adaptador de la forma vieja.

**Validaciones agregadas (mensajes 422 en español, por NOMBRE humano, sin exponer ids — reglas
#5 y #7).** En ambas pasadas (directa y escalonada): (a) el destino tiene que existir;
(b) no puede ser el propio centro (se mantuvo la validación de auto-reparto, ahora corrida
contra el `centroDestinoId` real); (c) en la pasada directa un servicio solo reparte a centros
productivos — si tiene que repartir a otro servicio, hay que definir un orden de cierre (método
escalonado). El escalonado ya validaba "cerrado no recibe"; se le pusieron nombres humanos.

**Defaults elegidos donde el criterio no estaba escrito (regla #9).**
- Un par en cero (`fijo = 0` y `variable = 0`) es un no-op: no reparte nada y se ignora, para
  que una columna vacía no dispare la validación de destino. El fijo y el variable se filtran
  por separado (un destino puede recibir solo fijo o solo variable).
- En modo 'base' el fijo y el variable comparten la MISMA base (mismas unidades por centro),
  igual que en la implementación previa.
- El auto-reparto se rechaza cuando el propio centro recibe algo (fijo o variable > 0), que es
  el caso peligroso (la huella del bug). Un par cero-cero sobre el propio centro es ruido
  inofensivo —no reparte nada— y se descarta sin error.

**Verificación.** `npm run typecheck` limpio. `npm test`: **58 archivos, 483 verdes, 1 skip**
(el "Can't reach database server" es el test del clasificador que degrada elegante con la DB
apagada). Test de regresión nuevo (`f01a-prorrateo-secundario-pares.test.ts`, 9 casos):
reordenar las filas de servicio da números IDÉNTICOS (pasada directa y escalonada), el caso
de aceptación (2 productivos + 2 de servicio) cierra ambos servicios en 0, una sola fila
funciona, un destino inexistente da 422 sin exponer el id, y una config legada corrupta falla
fuerte con el nombre humano.

**Sobre el commit / push.** *Esta tarea NO se pushea* (indicación explícita): altera un
contrato compartido con el frontend y F01-B tiene que aterrizar junto. Un único commit local
en `AlanSandbox` (regla #3). Alan pushea a mano cuando ambas mitades estén listas.

## Sesión 2026-07-21 — F04: nunca un resultado "sano" con datos sin imputar (backend)

**El bug (caja negra, 20/07, reproducido).** Una estructura con datos sin decisión de imputación
de período avisaba *"Hay 2 dato(s) sin decisión de imputación… antes de calcular"* y, aun así, la
pantalla mostraba un **margen bruto del 53% con badge verde "MARGEN SANO"** sobre un costo con
$0 de materia prima y $0 de CIP. El costista leía un número sano que no era ni completo ni
confiable.

**La causa.** El motor de trazabilidad (`CalculationRunService.calculate`,
`POST /structures/:id/calculate`) detectaba los datos sin imputar y **tiraba 422**. El frontend
manejaba mal ese 422 (mostraba un resultado previo/cacheado con badge sano). El bloqueo duro sin
una pantalla para imputar (que es una tarea posterior) dejaba además al costista sin ninguna
acción posible.

**Decisión (tomada de antemano, implementada tal cual — no se reabre).**
- **El cálculo NO se bloquea.** Corre igual, pero el resultado persistido y la respuesta se
  marcan EXPLÍCITAMENTE como incompletos/no confiables, con el motivo y los datos afectados por
  su **nombre humano**. El frontend usa esa marca para pintar una advertencia en vez del badge
  sano. Bloquear sin UI de imputación no era una opción.
- **El CIERRE del período SÍ se bloquea** (422 accionable) mientras haya un dato sin imputar. El
  cierre es la acción irreversible que consolida el mes: nunca puede pasar sobre datos sucios.
  Se agregó como una precondición más de `CostPeriodService.close`, en el mismo estilo que la
  regla E3 (actividad real y CIP real por centro productivo).

**Forma exacta de la marca de incompletitud (contrato que consume el frontend).** Interfaz
`Incompletitud` exportada desde `calculation-run-service.ts`:

```ts
interface Incompletitud {
  incompleto: boolean;                                 // true si corrió con datos sin imputar
  motivos: string[];                                   // razones legibles (ES), sin endpoints ni ids
  datosPendientes: { id: string; nombre: string }[];   // id = navegar a la ficha; nombre = mostrar
}
```

Viaja por DOS lados, ambos ADITIVOS (no rompe a ningún consumidor existente):
- **Persistida** dentro de `CalculationRun.results.incompletitud` (columna JSON; `results` sigue
  teniendo `grossMargin`, `grossMarginPct`, etc. intactos — `listRuns` y `compare` no se enteran).
- **En la respuesta** de `POST /structures/:id/calculate`: además de `results.incompletitud`,
  se expone `data.incompleto` en el nivel superior como atajo para el front.

Sin datos pendientes: `{ incompleto: false, motivos: [], datosPendientes: [] }`.

**Regla #7 (nada de endpoints ni ids en los mensajes).** Se REESCRIBIÓ el mensaje viejo, que
decía *"resolvé con POST /data-points/:id/imputacion antes de calcular"*. Ahora nombra los datos
(*"Compra — Proveedor Sur, 27/06"*) y apunta a la acción de UI: *"Resolvé la imputación desde la
ficha de cada dato antes de dar el costo por bueno"*. Queda correcto también cuando exista la
pantalla de imputación (tarea posterior). El `id` sí va en `datosPendientes` porque es dato de
máquina para que el front abra la ficha, no un mensaje.

**Defaults elegidos donde el criterio no estaba escrito (regla #9).**
- El cierre bloqueado usa `MissingInputError` (**422**, `MISSING_INPUT`) y no `ValidationError`
  (400) como la precondición E3, porque el criterio de aceptación pide 422 explícito y "falta una
  decisión de imputación" ES semánticamente un insumo faltante. "Mismo estilo que E3" se
  interpretó como el mismo patrón (chequear precondición y cortar con mensaje accionable antes de
  mutar), no la misma clase de error.
- Los datos cuelgan de la ESTRUCTURA, no del período (`DataPoint.structureId`, sin `periodId`). Un
  dato sin imputar podría pertenecer al mes que se cierra, así que el cierre se bloquea si hay
  CUALQUIER dato de la estructura sin imputar (no anulado, no voided).
- `take: 20` acota nombres y payload; con más de 20 pendientes el conteo del motivo queda en 20
  (mismo tope que la detección original). Un caso extremo que no se da en la práctica.

**Fuera de alcance (documentado).** El endpoint LEGADO `POST /cost-structures/:id/calculate`
(`CostStructureService.calculate`, tabla `CostCalculation`) NO participa del modelo de
doble-período/imputación: corre el motor sobre el JSON de config y no mira data points. No se le
agregó la marca porque no tiene de dónde sacarla; la pantalla de trazabilidad (la del bug) usa
`POST /structures/:id/calculate`.

**Verificación.** `npm run typecheck` limpio. `npm test`: **58 archivos, 485 verdes, 1 skip** (el
"Can't reach database server" es el clasificador degradando elegante con la DB apagada). Tests
nuevos/actualizados: `imputacion-and-latency.test.ts` (calcular con un dato sin imputar devuelve
resultado marcado incompleto, con el dato nombrado, y sin endpoints/ids en el motivo; sin
pendientes queda `incompleto: false`) y `cost-period-service.test.ts` (cerrar con un dato sin
imputar tira 422 nombrando el dato y no cierra; imputado el dato, el cierre procede).

**Sin cambios de esquema/migración.** No se tocó `schema.prisma`, `prisma/rls.sql`,
`migration_lock.toml` ni se agregó migración: la marca vive en la columna JSON `results` que ya
existía (regla #6 satisfecha por vacío).

---

## F04-FIX (2026-07-22) — La causa raíz estaba en el frontend; acá solo un ajuste de contrato

**Diagnóstico.** El bug "no se puede crear un dato sin imputar de punta a punta" NO estaba en el
backend. `DataPointService.create` deja `periodoImputado = NULL` (default del schema; `imputar()`
es el único que lo setea), y tanto `calculation-run-service` como `cost-period-service` detectan los
pendientes con `WHERE periodoImputado IS NULL` — la misma fuente de verdad. El eslabón roto era el
alta desde la UI (race en `RawMaterialForm.tsx`, ver DECISIONES del front): nunca se llamaba a
`POST /structures/:id/data-points`, así que no había NULL que marcar ni bloquear.

**Ajuste de contrato (el único cambio de runtime del back).** El 422 de cierre por datos sin
imputar (`MissingInputError` en `cost-period-service.close`) ahora adjunta
`details.datosPendientes: {id, nombre}[]`. El front ya lo leía (`unimputedDatosFromError`); sin
esto, la resolución in-situ del bloqueo caía a la lista del último cálculo, que puede estar vieja
(mostraba datos ya imputados o no incluía los recién agregados). Se extendió el constructor de
`MissingInputError(field, message, datosPendientes?)` para incluirlo en `details`. Sigue sin
filtrar ids ni endpoints al usuario (regla #6): el `id` solo sirve para abrir la ficha, se muestra
el nombre. El mensaje en español no cambió.

**Tests (el hueco que dejó pasar el bug).** Los tests viejos MOCKEABAN un data point pendiente en
`dataPoint.findMany`, así que probaban "NULL → marca/bloqueo" dando por hecho el NULL — nunca el
eslabón "create → NULL". Agregados: `data-point-service.test.ts` fija que `create()` NO setea
`periodoImputado` (nace pendiente) ni siquiera con `fechaHecho` fuera de período; y
`cost-period-service.test.ts` verifica que el 422 de cierre adjunta `datosPendientes` con
`{id, nombre}` correctos.

**Verificación.** `npm run typecheck` limpio; `npm test`: **58 archivos, 486 verdes, 1 skip**.
Sin cambios de esquema/migración. El flujo completo se validó extremo a extremo en el navegador
(ver DECISIONES del front).

---

## Sesión 2026-07-23 — M-VAULT: migración `add_vault_chunks` fallida en la DB local (CASO B, entorno)

**Diagnóstico.** La migración `20260722004906_add_vault_chunks` (módulo RAG/vault del equipo, no
nuestra) quedó FALLIDA en la DB local, y Prisma no aplica NINGUNA migración nueva mientras haya una
fallida — bloqueaba nuestro próximo trabajo de backend.

- **¿Le falta el `CREATE EXTENSION`?** No. El SQL trae `CREATE EXTENSION IF NOT EXISTS vector;` en
  la línea 1, antes de usar el tipo `vector(1024)` y el índice `hnsw ... vector_cosine_ops`. El SQL
  está bien escrito.
- **Estado en `_prisma_migrations`:** `finished_at = NULL`, `rolled_back_at = NULL`,
  `applied_steps_count = 0` → fallida antes de aplicar el primer paso (no dejó nada a medias).
- **Error exacto (columna `logs`):** `Database error code: 0A000 — ERROR: extension "vector" is not
  available. DETAIL: Could not open extension control file
  "/usr/local/share/postgresql/extension/vector.control": No such file or directory. HINT: The
  extension must first be installed on the system where PostgreSQL is running.`

**CASO B — SÓLO ENTORNO LOCAL (no es bug del equipo).** `docker-compose.yml` ya declara la imagen
correcta `pgvector/pgvector:pg16`, pero el contenedor `costear-postgres` que estaba corriendo era
`postgres:16-alpine` (imagen común, SIN el binario de pgvector) — un contenedor viejo creado antes
de que el compose apuntara a pgvector (llevaba 35 h levantado). Por eso `CREATE EXTENSION` no
encuentra `vector.control` y falla. NO es CASO A: si fuera un bug del SQL, fallaría en TODOS los
entornos con `type "vector" does not exist`; acá el error es "extension is not available" (binario
ausente en esta imagen), un problema de entorno.

**Qué hice (fix local, sin tocar la migración del equipo).**
1. `docker pull pgvector/pgvector:pg16` + `docker compose up -d postgres`: recreó el contenedor con
   la imagen correcta **manteniendo el volumen `postgres_data`** → **sin pérdida de datos** (verifiqué:
   `companies=4` y 27 migraciones previas intactas; contenedor `healthy`; `vector.control` presente;
   extensión `vector 0.8.5` instalada).
2. `npx prisma migrate resolve --rolled-back 20260722004906_add_vault_chunks` (como no aplicó ningún
   paso, marcarla "rolled back" deja que Prisma la re-aplique limpia).
3. `npm run prisma:deploy` → aplicó las 5 pendientes (incluida `add_vault_chunks`) sin error.
4. `npm run db:rls` (37 statements) y `npm run db:seed` OK.

**No se editó ninguna migración commiteada** (rompería el checksum en `_prisma_migrations` en todos
lados). El único cambio de repo es un **comentario en `docker-compose.yml`** avisando que la imagen
con pgvector es obligatoria y cómo recrear un contenedor viejo — para que el equipo no vuelva a
pisar esto. `scripts/migrate-deploy.mjs` NO se tocó: su `FAILED_MIGRATIONS` es para fallos de
PRODUCCIÓN; este fallo era sólo local y no debe resolverse a ciegas en otros entornos.

**Verificación (aceptación).** `npx prisma migrate status` → "Database schema is up to date!";
`_prisma_migrations` con 0 fallidas. Además probé de CERO en una DB vacía temporal
(`costear_scratch`) con un `prisma migrate deploy` plano: **32 migraciones aplicadas, 0 fallidas**
(luego se dropeó la DB temporal). Confirma que en un entorno fresco con la imagen pgvector aplica
todo limpio.

**A vigilar (fuera de alcance, lo dejo flagueado):** el working tree local tiene una carpeta de
migración **sin trackear** `prisma/migrations/20260721144831_init/` y `package-lock.json` modificado
de antes; no los toqué ni commiteé (no son de esta tarea). Conviene revisar con el equipo si ese
`_init` local debería existir.

---

## Sesión 2026-07-23 — M-STRAY: limpieza de la migración `_init` colgada (cierre del flag anterior)

Cierre del pendiente que dejó M-VAULT: la carpeta sin trackear
`prisma/migrations/20260721144831_init/`.

**Diagnóstico.** NO era un `_init` de esquema completo. Su `migration.sql` era un diff que Prisma
generó en un `prisma migrate dev` local y que DROPea drift benigno:
`DROP CONSTRAINT cost_config_versions_structureId_fkey` + `ALTER COLUMN ... DROP DEFAULT` sobre los
`id` (gen_random_uuid) de `allocation_base_values`, `allocation_bases`, `cost_config_versions`,
`cost_periods` y el `updatedAt` de `cost_periods`. Es exactamente el "ruido benigno" que ya estaba
documentado (la FK `structureId` es DB-only a propósito y los defaults los pone Prisma Client).

**Hallazgo inesperado (importante).** No era sólo una carpeta suelta: estaba **APLICADA** en la DB
local (`_prisma_migrations` la tenía con `finished_at` no nulo). Verifiqué el efecto real: la FK
`cost_config_versions_structureId_fkey` y el default de `cost_config_versions.id` estaban
efectivamente **borrados en la DB local de dev**. En origin/dev NO existe la carpeta (puramente
local). No es bug del equipo: es un `migrate dev` que alguien corrió el 21/07 (trampa conocida de
este repo: schema.prisma no modela esa FID/defaults, así que `migrate dev` quiere "corregir" el
drift intencional).

**Qué hice.**
1. `git checkout -- package-lock.json`: el cambio era ruido de lockfile (quitaba flags `"peer": true`
   de devDeps por reserialización de otra versión de npm), no un cambio real de dependencias.
2. Borré la carpeta sin trackear `20260721144831_init/` (untracked → no se pierde nada de git).
3. Borré la fila huérfana de `_prisma_migrations` (`migration_name='20260721144831_init'`, exacta) —
   la mitad de la migración colgada que vivía en la DB. Sin esto, tras borrar la carpeta el
   `migrate status` de la DB de dev reportaría divergencia. NO es un `reset` ni se perdió dato de
   negocio; es des-registrar una migración local nunca commiteada.

**Decisión: NO restauré la FK/defaults en la DB de dev local.** Motivos: (a) la tarea era limpiar el
artefacto, no reparar la DB; (b) son ítems benignos (Prisma Client igual genera uuid/updatedAt; la FK
es DB-only); (c) restaurarlos RE-INTRODUCE el mismo drift que originó este stray, con lo que el
próximo `migrate dev` lo volvería a generar. El estado actual de la DB local queda SIN drift respecto
de schema.prisma (más limpio para generar futuras migraciones). Consecuencia documentada: la DB local
carece de la FK DB-only `cost_config_versions_structureId_fkey` que sí tienen dev/prod; es una
diferencia local benigna (y encima `cost_config_versions` tiene trigger append-only que bloquea
DELETE, así que el CASCADE de esa FK casi no aplica). Si alguna vez se quiere paridad exacta:
`ALTER TABLE "cost_config_versions" ADD CONSTRAINT "cost_config_versions_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "cost_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;`

**Lección de raíz.** En este repo NUNCA correr `prisma migrate dev` (regenera este stray por el drift
intencional). Para aplicar migraciones usar SIEMPRE `npm run prisma:deploy`.

**Verificación (aceptación).** Working tree limpio (sin artefactos sin trackear). `migrate status` en
la DB de dev = "Database schema is up to date!", 0 fallidas, 0 filas de `_init`. Además probé de CERO
en una DB vacía temporal (`costear_scratch`) con `npm run prisma:deploy` end-to-end: **31 migraciones
aplicadas, 0 fallidas**, y esa DB fresca SÍ tiene la FK `cost_config_versions_structureId_fkey` — lo
que prueba que la historia commiteada es la canónica y que la "pérdida" de la FK es sólo local. Luego
se dropeó la DB temporal. Sin cambios de código; el único cambio commiteado es esta entrada de
DECISIONES.

---

## F06 — La ficha PPP tiene que mostrar TODOS los movimientos (incluidos los sin imputar)

**Diagnóstico (STEP 1 — en qué capa se ocultaba).** La ficha PPP se dibuja SÓLO con el JSON de la
sección (`rawMaterialConfig.materials[].movements`), que NO sabe nada de imputación y no tiene ningún
vínculo con el store de trazabilidad (`data_points`). El estado "pendiente" (`periodoImputado = null`)
vive EXCLUSIVAMENTE en `data_points` — el mismo store que cuenta el motor para la marca F04. La ficha
nunca leía ese store, así que un movimiento sin imputar aparecía sin marca (o directamente invisible si
el JSON y los data points se desincronizaban). **No era un filtro `periodoImputado != null` en el
backend ni un filtro en el componente: no había NINGÚN endpoint que listara los movimientos por su
estado de imputación. El dato no se filtraba, simplemente nunca se cruzaba.** La capa culpable es el
flujo de datos del frontend (lee la sección, ignora los data points).

**Fix (STEP 2).**
1. **Backend (append-only, read-only):** nuevo `GET /structures/:id/mp-movements` +
   `DataPointService.listMpMovements`. Agrupa los data points de MP por `valueJson.movementId`
   (compra = cantidad + precio hermanos), INCLUYE los `periodoImputado = null` (mostrar todos es el
   fix) y marca `pending` si algún hermano sigue sin imputar. No filtra por período. Sólo lee.
2. **Frontend:** la tabla de movimientos de la sección se enriquece con ese estado. Cada fila cuyo
   movimiento guardado casa con un movimiento pendiente muestra el pill **"Pendiente de imputar"**;
   el pill ES el botón que abre el modal de imputación (se reusa `ImputacionModal` + `useImputar` +
   `proposeImputation` ya montados en el componente — NO se creó un segundo modal). Al resolver, la
   lista se refresca (invalidación de `['structures', id]`, que `useImputar` ya dispara) y el pill
   desaparece; el movimiento queda como una fila normal ya imputada. Los movimientos imputados no
   cambian su presentación.

**Decisión — casar sección ↔ data points por clave natural.** La fila de la sección NO guarda
`movementId` (sólo fecha/tipo/detalle/cantidad/precio), así que se casa por `(tipo · detalle · fecha)`,
que es justo lo que la registración copia al `label` (`"Compra — {detalle}"`) y a `fechaHecho`. Detalle
vacío → `'(sin detalle)'` en ambos lados. Es una clave natural robusta; una colisión exacta
(mismo tipo, mismo detalle, misma fecha) sería, a efectos prácticos, el mismo movimiento. Se descartó
escribir `movementId` de vuelta en el JSON de la sección por ser un cambio más invasivo y fuera de
alcance.

**Decisión — pendientes "huérfanos".** Si un pendiente que el motor cuenta NO tiene fila propia en la
sección (desincronización histórica: p. ej. datos creados antes del fix F04, o una fila borrada de la
sección con su data point vivo por append-only), se renderiza igual como fila extra marcada
"Pendiente de imputar", en sólo lectura y accionable. Así **ningún** dato sin imputar queda invisible
y el total de pendientes de la ficha iguala el conteo del motor. Nota multi-materia: como los data
points de MP cuelgan de la estructura (no de la materia), un huérfano podría verse en la ficha de otra
materia de la misma estructura; se prioriza "nunca ocultar un pendiente" sobre esa rareza (los
huérfanos son raros post-fix F04, porque un movimiento nuevo hoy queda en AMBOS stores).

**Fix incidental (bloqueaba el build, NO es F06).** Al re-sincronizar `AlanSandbox` con `origin/staging`
(rule #1) el `typecheck` del backend estaba en ROJO por un break PREEXISTENTE en
`cost-period-service.ts` (commit `20f4300`, de AlanSandbox, no del merge): dos `alert.create` usaban
`title` y `severity`, campos que NO existen en el modelo `Alert` (tiene `type` + `message`). Se
reemplazaron por `type: 'COST_SPIKE'` (enum válido, encaja con "anomalía de costo") plegando el título
al `message`. Sin esto no se podía compilar ni verificar F06. Sin riesgo de pérdida de datos → se
arregló y se documenta (rule #9).

**Verificación (aceptación, navegador contra dev + DB real).** Estructura "Pieza V-F1 Prorrateo"
(período 2026-07): agregué una compra fechada 2026-01-15 ("TEST F06 — enero fuera de periodo") y elegí
"Decidir más tarde". (1) Aparece en la ficha PPP con el pill "Pendiente de imputar"; los 5 movimientos
imputados siguen sin marca. (2) En DB: 2 data points (cantidad + precio) con `periodoImputado = null`;
el conteo de "sin imputar" de la estructura = 2 = ese único movimiento pendiente (iguala lo que muestra
la ficha). (3) Click en el pill → abre el modal con "TEST F06…" y las dos opciones. (4) Elegí "Imputar
a 2026-07" → el pill desaparece, el movimiento queda como fila normal, y en DB los 2 data points pasan
a `periodoImputado = 2026-07`; "sin imputar" de la estructura = 0. Suites: backend `typecheck` ✅ +
`vitest` 503✅/1 skip; frontend `typecheck` ✅, `build` ✅, `vitest` 22✅.

## F07 — Doble fecha (fecha_hecho / fecha_captación) en la ficha PPP — parte backend

**Contexto (STEP 0, hallazgo).** El write path YA persistía ambas fechas: `DataPointService.create`
guarda `fechaHecho` desde el cliente (la fecha del movimiento) y `fechaCaptacion` es un `TIMESTAMPTZ
NOT NULL DEFAULT now()` que pone Postgres (regla dura #3 / manual §3). O sea: NINGÚN movimiento viejo
perdió su fecha de hecho real; el hueco de F07 era puramente de **presentación** (la captación no se
mostraba en ninguna parte y la columna se llamaba sólo "Fecha"). No hizo falta migración de esquema.

**Cambio.** `listMpMovements` (GET `/structures/:id/mp-movements`) ahora expone también
`fechaCaptacion: string` (ISO) por movimiento, para que la ficha la muestre en sólo lectura. Como un
movimiento son dos data points hermanos (cantidad + precio) creados juntos, se toma la captación **más
temprana** de los hermanos como "cuándo entró el movimiento al sistema". `fechaHecho` sigue viajando
como `YYYY-MM-DD` (o `null` si el dato nunca la tuvo — retrocompat: el front la muestra "—").

**Sin cambios en imputación:** la regla §3 (`proposeImputation` en el front, decisión `POST
/data-points/:id/imputacion` en el back) ya estaba y se reusa tal cual; F07 no toca esa lógica.

**Verificación.** `typecheck` ✅ + `vitest` 503✅/1 skip (sin regresión; el test de latencia por área,
que ya leía `fechaCaptacion`, sigue verde). Flujo end-to-end en navegador: ver más abajo / DECISIONES
del frontend.

## F09-4 — Ningún mensaje 422 expone el id interno de un centro (siempre el nombre humano)

Parte backend del pulido F09 (regla del proyecto #7: nunca `serv3`/`prod2` en texto de usuario).
Casi todos los mensajes del prorrateo (`indirect-costs.ts`, `calculate.ts`) ya usaban `«${serviceName}»`
(nombre humano). Quedaban DOS `CalcError` (que mapean a **422**, visibles al usuario) que interpolaban el
id crudo:
- `Servicio inexistente en prorrateo: ${dist.serviceCenterId}` (secundario directo).
- `Cierre de un centro inexistente: ${cl.serviceCenterId}` (escalonado).

**Cambio.** En `secondaryProration` se computa `serviceName` ANTES del chequeo y su fallback pasó de
`?? id` a `|| 'un centro de servicio'` (nunca el id), y el mensaje se reescribió en términos de cátedra
("no tiene costo del prorrateo primario para repartir…"). En `stepwiseProration`, como el centro es
literalmente inexistente y no se puede nombrar con certeza, el mensaje quedó genérico y accionable ("el
orden de cierre incluye un centro que ya no existe… revisá el orden de cierre") sin ningún id. El resto
de mensajes ya por nombre no cambian de comportamiento (el fallback genérico solo aplica en el caso
—casi imposible— de un centro ausente del catálogo).

**Verificación.** `typecheck` (tsc) ✅ + `vitest` 503✅/1 skip, sin regresión (los tests de prorrateo,
incluidos los que verifican mensajes por nombre humano, siguen verdes). Nota de entorno: `prisma generate`
dentro de `npm run build` falló por un lock de Windows (EPERM al renombrar el `query_engine`.dll); es
transitorio y ajeno al cambio —el `tsc` compila limpio y el cliente ya generado corre los 503 tests—.

## B01 — Se persiste el `costingSystem` al crear la estructura (compuerta de Costeo por Procesos)

La columna `CostStructure.costingSystem` (enum `ORDERS | PROCESSES`, default `ORDERS`) y el schema de
alta (`createCostStructureSchema`) ya aceptaban el campo, pero `CostStructureService.create()` lo
descartaba: el `data` de `costStructure.create()` solo incluía `companyId, userId, productName, period`.
Resultado: TODA estructura nacía como `ORDERS`, sin importar lo que mandara el cliente, y nada aguas
abajo podía distinguir los dos sistemas. Es la compuerta de toda la feature de Costeo por Procesos.

**Cambio 1 — persistencia en el alta.** Se agregó `costingSystem: input.costingSystem ?? 'ORDERS'` al
`data`. El default defensivo en la capa de servicio es redundante con el `.default('ORDERS')` del Zod
(el schema ya lo garantiza en la ruta), pero cubre cualquier llamador interno que arme el input a mano.

**Cambio 2 — cambiar el sistema solo si NO hay cálculos (nuevo `PATCH
/cost-structures/:id/costing-system`).** Se puede cambiar el sistema de costeo mientras la estructura no
tenga historia de cálculo. Si ya la tiene, se devuelve un **422** accionable en castellano ("No se puede
cambiar el sistema de costeo de una estructura que ya tiene cálculos…"), nunca un 500.
**Rationale:** mezclar el rastro de dos motores distintos (órdenes vs procesos) sobre una misma
estructura corrompería el árbol de derivación.

**Decisión (ambigüedad → default conservador): "tener cálculos" abarca los DOS registros de historia.**
La tarea nombraba `CalculationRun` (los runs trazables de Trazabilidad v1). Se bloquea el cambio si existe
**cualquiera** de los dos: `CalculationRun` (árbol de derivación) **o** `CostCalculation` (snapshot del
motor legado). Es la opción más segura para la integridad: ambos son "historia de cálculo", y ninguno de
los dos debería quedar con el sistema cambiado por debajo. No sobre-bloquea ningún flujo existente porque
el endpoint es nuevo (ningún test previo lo usaba).

**Auditoría** en la misma transacción, siguiendo el patrón `recordAudit` del servicio: acción
`cost_structure.costing_system.update`, con `oldValue`/`newValue` del sistema. El chequeo de cálculos y el
`update` van dentro del mismo `$transaction`.

**Sin migración:** la columna `costingSystem` ya existía en `CostStructure`. No se corrió `prisma migrate
dev` (regla del repo: siempre `npm run prisma:deploy`; esta tarea no necesitó ninguna migración).

**Verificación.** `tsc --noEmit` ✅ + `vitest run` **508 ✅ / 1 skip** (antes ~503; +5 tests nuevos, sin
regresión). Tests nuevos (`tests/application/costing-system-persist.test.ts`): (1) crear con
`PROCESSES` lo persiste; (2) crear sin el campo cae en `ORDERS`; (3) cambiar el sistema sin cálculos
funciona; (4) con un `CalculationRun` devuelve 422 en castellano y no toca la estructura; (5) idem con un
`CostCalculation` legado. Verificación a nivel de servicio (unit) por ser cambio backend puro sobre una
compuerta sin UI todavía; la ruta es un wrapper delgado sobre `updateCostingSystem`.

## B02 — Se extrae la interfaz `CostingEngine` y se envuelve el motor de Órdenes (patrón Strategy)

Preparación para el Costeo por Procesos SIN tocar el comportamiento del motor de Órdenes. La regla
número uno de la tarea: el cálculo por Órdenes tiene que dar **byte-idéntico** después del refactor.
Ni un número de los fixtures (fx3-dorado, r5-fixtures, allocation-primario/secundario/escalonado,
multi-materia-prima, production-quantity, etc.) se movió.

**Decisión de diseño: Strategy, NO un `if (costingSystem === 'PROCESSES')` dentro del cálculo.**
La función `runCalculation` (Hojas 1-4) está verificada al centavo contra la cátedra; ramificar por
dentro es la vía más rápida a una regresión silenciosa. En su lugar se introdujo un contrato común y se
despacha por fuera.

**Forma de la interfaz `CostingEngine`** (`src/application/cost-structures/costing-engine.ts`), que el
motor de Procesos (B17) implementará tal cual:
- `readonly engineVersion: string` — la versión con la que se calculó, que se persiste en
  `CalculationRun.engineVersion`. Cada motor expone la suya (el de Órdenes devuelve `ENGINE_VERSION`,
  hoy `v1.0.0`; Procesos tendrá la propia). Antes el servicio leía la constante importada directamente;
  ahora la toma del motor elegido → para Órdenes es el mismo valor, byte-idéntico.
- `run(input: CalculationInput): CostingResult` — función **pura** (sin DB ni red). `CalculationInput`
  son los insumos ya resueltos (config de la estructura + datos del período). `CostingResult` es
  **exactamente** lo que el camino actual ya producía, sin inventar forma nueva:
  `{ results: CalculationOutput; tree: TreeNode[] }` — `results` es el output consolidado de
  `runCalculation`; `tree` es el árbol de derivación de `buildCalculationTree` (todavía sin persistir).
  La incompletitud (F04), la persistencia (`CalculationRun` + `CalculationNode`) y la auditoría **quedan
  fuera del motor**, en el servicio: son orquestación común a cualquier sistema de costeo, no cálculo.

**`OrdersCostingEngine`** (`orders-costing-engine.ts`) es una **extracción, no una reescritura**: su
`run()` llama `runCalculation` y `buildCalculationTree` sin tocar una sola fórmula ni ninguna llamada de
dominio (MP, MOD, CIF, estado de costos, bases de asignación, prorrateo primario/secundario/escalonado).

**Despacho en `CalculationRunService.calculate()`**: `selectCostingEngine(s.costingSystem)` se llama
**antes** de validar las secciones de Órdenes. Así una estructura de Procesos corta con un **422**
accionable en castellano (`CostingSystemNotAvailableError`: "El costeo por procesos todavía no está
disponible…") en vez de confundir al costista con "Falta cargar la sección de Materia Prima". Es un
placeholder temporal que reemplazará el motor de Procesos (B17), nunca un 500 ni un crash. Cualquier
valor que no sea `PROCESSES` (incluido `ORDERS` o el campo ausente en estructuras/mocks viejos) cae en el
motor de Órdenes → cero regresión.

**Persistencia de trazabilidad intacta**: el camino de Órdenes sigue armando `tree` con
`buildCalculationTree`, enriqueciéndolo con `attachDataPointSources`, y persistiendo `CalculationRun` +
`CalculationNode` en la misma transacción, exactamente como antes. Solo cambió de dónde salen `results`
y `tree` (del motor en vez de las dos llamadas sueltas) y de dónde sale `engineVersion` (del motor).

**Sin migración:** refactor puro, ningún cambio de schema. No se corrió `prisma migrate dev`.

**Verificación.** `tsc --noEmit` ✅ + `vitest run` **510 ✅ / 1 skip** (antes 508; +2 tests nuevos, cero
regresión — todos los fixtures de Órdenes pasan con valores idénticos). Test nuevo
(`tests/application/costing-engine-dispatch.test.ts`): (1) una estructura `PROCESSES` corta con 422
(`CostingSystemNotAvailableError`, `statusCode 422`, mensaje en castellano) y no toca la persistencia
(ni corrida, ni nodos, ni auditoría); (2) una estructura `ORDERS` no cae en el placeholder (sigue al
motor de Órdenes).

## B03 — Migración + modelo `ProcessDepartment` (departamento de la cadena de Procesos)

Primera tabla del batch de Costeo por Procesos. Un `ProcessDepartment` es un departamento/etapa de un
proceso productivo **secuencial** (depto 1 → depto 2 → …): el costo terminado de un departamento se
transfiere al siguiente y cada uno produce su propio "cuadro de movimiento de unidades" e informe de
costos. Es **distinto** de los `centers[]` de `indirectCostConfig`, que solo prorratean CIF y no tienen
orden/precedencia. Esta tarea crea **solo** la tabla del departamento; el cuadro de movimiento
(`UnitMovementSchedule`) y los costos conjuntos llegan en B04/B05.

**Fuente del modelo.** Se leyó la §5.2 del plan
(`Plan-Implementacion-Costeo-Ordenes-y-Procesos.md`), accesible en disco (carpeta de outputs de una
sesión local, no en la ruta del vault del prompt). Los campos son idénticos a la spec.

**Se omitió la relación `schedules UnitMovementSchedule[]` que la §5.2 muestra en el modelo.** Esa
relación apunta a `UnitMovementSchedule`, tabla que no existe hasta B04. Incluirla ahora rompería la
compilación del schema. El propio enunciado de B03 acota el alcance a "solo la tabla del departamento" y
su spec de campos ya la omite. Se agregará en B04 junto con la tabla destino.

**Tipos de columna: se copió exactamente el patrón de `CostStructure`** (no el de `cost_periods`).
`id UUID` sin `DEFAULT` (el uuid lo genera Prisma en la app, `@default(uuid())`), `createdAt TIMESTAMP(3)
DEFAULT CURRENT_TIMESTAMP`, `updatedAt TIMESTAMP(3)` sin default, `deletedAt TIMESTAMP(3)` nullable
(soft-delete = papelera recuperable). Para garantizar **cero drift**, el SQL de la tabla se generó con
`prisma migrate diff` (salida canónica de Prisma) y recién después se lo volvió idempotente a mano.

**Idempotencia.** `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE UNIQUE INDEX IF
NOT EXISTS`, y la FK envuelta en un bloque `DO $$ … EXCEPTION WHEN duplicate_object THEN NULL $$`
(ADD CONSTRAINT no admite IF NOT EXISTS). Verificado: el `migration.sql` corre dos veces seguidas contra
una DB que ya tiene la tabla, exit 0 ambas veces (skips por NOTICE, ningún error). Esto es porque
`scripts/migrate-deploy.mjs` puede re-aplicar una migración marcada como rolled-back.

**RLS (obligatorio — sin esto la tabla es una fuga de datos entre tenants).** `process_departments` no
tiene `userId` propio; el tenant se define por la estructura a la que pertenece. Se agregó la política
`tenant_isolation` a `prisma/rls.sql` con el patrón de tabla-alcanzada-por-`structureId` (idéntico a
`data_points` / `calculation_runs`): `"structureId" IN (SELECT id FROM cost_structures WHERE "userId" =
current_app_user_id())`, con `ENABLE`+`FORCE ROW LEVEL SECURITY`. Verificado en la DB: `relrowsecurity`
y `relforcerowsecurity` = `t`, policy `tenant_isolation` presente.

**Timestamp de la migración.** `20260723182912` (hora UTC real de la corrida), estrictamente mayor que la
última carpeta existente (`20260723120000_add_daily_signal_source`) y que el piso de la tarea
(`20260713010000`). Se creó la carpeta y el SQL **a mano**; nunca se corrió `prisma migrate dev` (en este
repo genera una `_init` basura por drift intencional). No se tocó `migration_lock.toml` ni ninguna
migración ya commiteada.

**Verificación.**
- `npm run prisma:deploy`: aplica limpio sobre la DB local (1 migración nueva, cero fallidas).
- **Desde cero sobre una DB vacía** (`costear_scratch` creada al vuelo): `prisma:deploy` aplica las 32
  migraciones sin error y `db:rls` corre limpio (41 statements). DB descartable eliminada al terminar.
- `npm run db:rls`: 41 statements aplicados, política nueva presente.
- `prisma migrate diff --from-migrations … --to-schema-datamodel …` (con shadow DB descartable): la
  tabla `process_departments` **no aparece** en el diff → cero drift para B03. El drift residual que sí
  reporta (`allocation_bases`, `cost_config_versions`, `cost_periods`, `vault_chunks`) es **pre-existente
  de la branch**: se probó corriendo el mismo diff con los cambios de B03 stasheados y da exactamente las
  mismas 5 tablas, sin `process_departments`. No lo introduce esta tarea.
- Suite completa: **510 passed / 1 skipped** (62 archivos), cero regresión.
- `@@unique([structureId, sequence])` presente como índice único en la DB (`process_departments_
  structureId_sequence_key`); FK a `cost_structures` con `ON DELETE CASCADE`; índice por `structureId`.
- Cero carpetas de migración basura en el árbol; jamás se corrió `prisma migrate dev`.

## B04 — Migración + modelo `UnitMovementSchedule` (cuadro de movimiento de unidades)

Segunda tabla del batch de Costeo por Procesos. Una fila por **(departamento, período)** que resume el
movimiento de unidades del período: existencia inicial de producción en proceso (EI), puestas en
elaboración / recibidas del departamento anterior / aumento de número de unidades, terminadas y
transferidas, terminadas en existencia, pérdidas (normal / real total / extraordinaria), existencia final
de producción en proceso (EF), el grado de avance por elemento del costo (MP y Conversión) tanto de la EI
como de la EF, y los costos del período por elemento (MP / MO / CIF), incluyendo el costo $ arrastrado en
la EI. Es el insumo que el motor (B17) convertirá en producción equivalente e informe de costos. **Esta
tarea solo crea la tabla**; no hay lógica de negocio ni endpoints todavía.

**Modelo (`prisma/schema.prisma`).** `UnitMovementSchedule` → `@@map("unit_movement_schedules")`. FK
`departmentId` → `ProcessDepartment` y FK `periodId` → `CostPeriod`, ambas `onDelete: Cascade`. Se
agregaron las relaciones inversas `schedules UnitMovementSchedule[]` en `ProcessDepartment` y
`unitMovementSchedules UnitMovementSchedule[]` en `CostPeriod`. `@@unique([departmentId, periodId])`: un
solo cuadro por departamento y período.

**Decisiones de tipos (documentadas por ambigüedad, default más simple).**
- Todas las cantidades de unidades → `Decimal(18,4)` (mismo ancho que las cantidades del resto del
  dominio, p.ej. `CostPeriod.productionQuantity`).
- Todos los grados de avance (`*Avance`) → `Decimal(9,4)`, según el enunciado.
- `normalLossPct` es un **porcentaje**, no una cantidad → se modeló como `Decimal(9,4)` (mismo criterio
  que los avances). Los seis campos de costo del período (`periodCost*`, `initialWipCost*`) son montos →
  `Decimal(18,4)`.
- Campos derivables por diferencia (`transferredOut`, `finalWip`, `normalLoss`, `extraordinaryLoss`) y
  todos los inputs condicionales por `sequence` quedan **opcionales**; solo `initialWip` y
  `finishedInStock` son `NOT NULL DEFAULT 0`, como pide el spec. La regla de "no editable"
  (`normalLoss`) es una restricción de la capa de aplicación (B17), no de la tabla; acá es nullable.
- `createdAt`/`updatedAt` siguen el estilo de `process_departments` (`TIMESTAMP(3)`), no el `Timestamptz`
  de `cost_periods`, para mantener consistencia dentro del batch de Procesos.
- Sin `deletedAt`: el spec no lo pide y el `@@unique` ya garantiza una fila por (depto, período); si se
  necesita reemplazar, se actualiza la fila. B03 sí tiene soft-delete porque un departamento es una
  entidad de catálogo; un cuadro de movimiento es un dato del período.

**RLS (obligatorio).** `unit_movement_schedules` no tiene `userId` ni `structureId` propios: el tenant se
resuelve por la cadena **departamento → estructura → dueño**. Política `tenant_isolation` en
`prisma/rls.sql` con `USING`/`WITH CHECK` sobre `departmentId IN (SELECT pd.id FROM process_departments pd
JOIN cost_structures cs ON cs.id = pd."structureId" WHERE cs."userId" = current_app_user_id())` — mismo
patrón de join que usan `calculation_nodes` y la nota de B03. `ENABLE` + `FORCE ROW LEVEL SECURITY`.

**Timestamp de la migración.** `20260723195013` (hora UTC real de la corrida), estrictamente mayor que la
última carpeta existente (`20260723182912_add_process_departments`) y que el piso indicado por la tarea.
SQL escrito **a mano**, idempotente (`CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`,
`ADD CONSTRAINT` guardado con `DO $$ … EXCEPTION WHEN duplicate_object THEN NULL $$`) y aditivo. Nunca se
corrió `prisma migrate dev`. No se tocó `migration_lock.toml` ni ninguna migración ya commiteada.

**Nota sobre la DB local (pre-existente, no la introduce esta tarea).** La DB de desarrollo `costear`
estaba construida con `prisma db push` (tenía las 35 tablas pero **sin** tabla de historial
`_prisma_migrations`), por lo que `prisma migrate deploy` fallaba con P3005 ("schema is not empty"). Se
**baselineó** la DB marcando las 32 migraciones previas como aplicadas (`prisma migrate resolve
--applied …`, sin re-ejecutar SQL, operación no destructiva) para que `prisma:deploy` pueda correr. Es la
adopción estándar de Prisma Migrate sobre una DB existente.

**Verificación.**
- **Desde cero sobre una DB vacía** (`costear_b04_verify` creada al vuelo): `prisma migrate deploy` aplica
  las **33** migraciones sin error y `db:rls` corre limpio (45 statements). La tabla, el índice único
  `unit_movement_schedules_departmentId_periodId_key`, la política `tenant_isolation` y `rowsecurity`/
  `forcerowsecurity` quedan presentes. DB descartable eliminada al terminar.
- `npm run prisma:deploy` sobre la DB local (post-baseline): aplica **solo** la migración nueva; una
  segunda corrida da "No pending migrations to apply" (idempotente).
- `npm run db:rls`: 45 statements aplicados, política nueva presente sobre la DB local.
- `prisma migrate diff --from-migrations … --to-schema-datamodel …` (con shadow DB descartable): ninguna
  línea menciona `unit_movement_schedules`/`schedule` → **cero drift nuevo** por esta tabla. El drift
  residual (`allocation_base_values`, `allocation_bases`, `cost_config_versions`, `cost_periods`,
  `vault_chunks`) es **pre-existente de la branch** (M-DRIFT), no lo introduce esta tarea.
- Suite completa: **510 passed / 1 skipped** (62 archivos), cero regresión.
- Cero carpetas de migración basura en el árbol; jamás se corrió `prisma migrate dev`.

## B05 — Migración + modelos `JointCostAllocation` + `ByProductLine` (costos conjuntos)

Tercera "pieza de datos" del batch de Costeo por Procesos. En un **punto de separación** un proceso rinde
varios productos a partir de un **costo conjunto** (compartido): **coproductos** (principales),
**subproductos** (secundarios) y **desechos**. El costo conjunto se reparte entre ellos por uno de cuatro
métodos. Se crean **dos tablas**: `joint_cost_allocations` (cabecera del reparto) y
`joint_cost_by_product_lines` (una fila por línea de producto). **Esta tarea solo crea el esquema**; la
matemática de los cuatro métodos llega en **B11** y se conecta al motor en **B17** — no hay lógica de
negocio ni endpoints todavía.

**Enum (`prisma/schema.prisma`).** `JointAllocationMethod` con los cuatro métodos de la cátedra:
`PHYSICAL_UNITS` (unidades físicas), `TECHNICAL_YIELD` (rendimiento técnico), `MARKET_VALUE` (valor de
mercado en el punto de separación) y `NET_REALIZABLE_VALUE` (valor neto de realización).

**Modelos.**
- `JointCostAllocation` → `@@map("joint_cost_allocations")`. Cabecera: `structureId` → `CostStructure`,
  `departmentId` → `ProcessDepartment` (depto. donde ocurre el punto de separación) y `periodId` →
  `CostPeriod`, las tres FK `onDelete: Cascade`. `method JointAllocationMethod`, `jointCostTotal
  Decimal(18,4)` (MP + conversión acumulados hasta el punto de separación), `createdAt`, y la relación
  `products ByProductLine[]`. `@@unique([departmentId, periodId])`: un solo reparto por depto. y período.
- `ByProductLine` → `@@map("joint_cost_by_product_lines")`. `allocationId` → `JointCostAllocation`
  `onDelete: Cascade`. `productName`, `kind` (`'coproduct' | 'byproduct' | 'waste'`), `unitsObtained
  Decimal(18,4)`; magnitudes por método, todas opcionales: `yieldPct Decimal(9,4)` (TECHNICAL_YIELD),
  `marketPrice Decimal(18,4)` (MARKET_VALUE / NET_REALIZABLE_VALUE), `sellingCostVarPct Decimal(9,4)` y
  `sellingCostFixedPerUnit Decimal(18,4)` (NET_REALIZABLE_VALUE), `byproductRecognition` (`'at_sale' |
  'at_production'`, solo `kind='byproduct'`); y los resultados calculados `allocatedCost` /
  `unitCost Decimal(18,4)`.
- Relaciones inversas `jointCostAllocations JointCostAllocation[]` agregadas en `CostStructure`,
  `CostPeriod` y `ProcessDepartment`, según el spec.

**Decisiones de tipos (documentadas por ambigüedad, default más simple).**
- Porcentajes (`yieldPct`, `sellingCostVarPct`) → `Decimal(9,4)`, mismo criterio que los avances de B04.
  Montos (`jointCostTotal`, `marketPrice`, `sellingCostFixedPerUnit`, `allocatedCost`, `unitCost`) y
  cantidades (`unitsObtained`) → `Decimal(18,4)`, ancho estándar del dominio.
- `kind` y `byproductRecognition` se modelan como `String` (no enum): el spec los describe como cadenas
  con valores fijos y la validación de dominio vive en la capa de aplicación (B11), no en la tabla —
  mantiene la tabla flexible y evita un enum extra para un campo que aún no tiene lógica.
- `JointCostAllocation` lleva `createdAt` pero **no** `updatedAt` (el spec solo pide `createdAt`), y
  `ByProductLine` no lleva ninguno de los dos: son datos de un reparto puntual del período, no entidades
  de catálogo. Sin `deletedAt` por el mismo motivo (igual criterio que B04).
- Índices añadidos: `@@index([structureId])` en la cabecera (lookups por estructura) y
  `@@index([allocationId])` en las líneas (FK sin unique). El `@@unique([departmentId, periodId])` ya cubre
  el índice sobre `departmentId`.

**RLS (obligatorio, ambas tablas).** Ninguna tabla tiene `userId` propio; el tenant se resuelve por la
cadena de propiedad, mismo patrón que B03/B04. `joint_cost_allocations`: aislamiento directo por
`structureId IN (SELECT id FROM cost_structures WHERE "userId" = current_app_user_id())`.
`joint_cost_by_product_lines`: aislamiento por join **línea → reparto → estructura → dueño**
(`allocationId IN (SELECT jca.id FROM joint_cost_allocations jca JOIN cost_structures cs ON cs.id =
jca."structureId" WHERE cs."userId" = current_app_user_id())`). Ambas con `ENABLE` + `FORCE ROW LEVEL
SECURITY` y política `tenant_isolation` en `prisma/rls.sql`.

**Timestamp de la migración.** `20260723203711` (hora UTC real de la corrida), estrictamente mayor que la
última carpeta existente (`20260723195013_add_unit_movement_schedules`, B04). SQL escrito **a mano**,
aditivo e idempotente. El **enum** es el punto delicado: Postgres no admite `CREATE TYPE IF NOT EXISTS`, así
que se envuelve en `DO $$ BEGIN CREATE TYPE … EXCEPTION WHEN duplicate_object THEN NULL; END $$` — la
segunda corrida ignora el error y no rompe. Tablas con `CREATE TABLE IF NOT EXISTS`, índices con `CREATE
[UNIQUE] INDEX IF NOT EXISTS`, y las cuatro FK guardadas con `DO $$ … EXCEPTION WHEN duplicate_object $$`.
Nunca se corrió `prisma migrate dev`. No se tocó `migration_lock.toml` ni ninguna migración commiteada.

**Verificación.**
- **Desde cero sobre una DB vacía** (`costear_b05_scratch` creada al vuelo): `prisma migrate deploy` aplica
  las **34** migraciones sin error; `db:rls` corre limpio (**53** statements); `migrate diff` contra el
  schema no muestra ninguna línea `joint*`. DB descartable eliminada al terminar.
- `npm run prisma:deploy` sobre la DB local: aplica **solo** la migración nueva.
- **Idempotencia probada**: se re-ejecutó el `migration.sql` completo una segunda vez con `prisma db
  execute` → `Script executed successfully`, sin error en el enum ni en nada. Sobrevive dos corridas.
- `npm run db:rls`: 53 statements; ambas políticas nuevas presentes (`tenant_isolation` sobre las dos
  tablas), verificado por consulta a `pg_policies` (2/2).
- `prisma migrate diff --from-url <DB local> --to-schema-datamodel …`: **ninguna** línea menciona
  `joint_cost_*` ni `JointAllocationMethod` → **cero drift nuevo** por estas tablas. El drift residual
  (`allocation_base_values`, `allocation_bases`, `cost_config_versions`, `cost_periods`, `vault_chunks`) es
  **pre-existente de la branch** (M-DRIFT), no lo introduce esta tarea.
- Objetos confirmados por consulta a los catálogos de Postgres: 2 tablas, 1 enum, 2 políticas, 1 índice
  único `joint_cost_allocations_departmentId_periodId_key`.
- Suite completa: **510 passed / 1 skipped** (62 archivos), cero regresión.
- Cero carpetas de migración basura; jamás se corrió `prisma migrate dev`.
- **Nota (entorno):** `prisma generate` no pudo renombrar el `query_engine-windows.dll` (`EPERM`) porque
  hay procesos node del usuario usando el engine; no se mataron. La migración, el schema (`prisma
  validate` OK) y los tests no dependen de esa regeneración; el cliente se regenera solo en el próximo
  arranque limpio.

## B06 — Dominio: `buildUnitMovementSchedule` (cuadro de movimiento de unidades, función pura)

Primer paso, fundacional, del Costeo por Procesos: resuelve el cuadro de movimiento de unidades de UN
departamento para UN período. Todo lo de aguas abajo (producción equivalente, informe de costos —
B11/B17) depende de que este cuadro cuadre. Vive en `src/domain/calculations/process-costing.ts`,
100 % puro (sin Prisma, HTTP ni servicios), al estilo de `raw-material.ts` / `indirect-costs.ts`:
`Decimal` de decimal.js para toda cantidad, JSDoc en español con terminología de la cátedra, mensajes
de error en español.

**Nombres de campo en inglés, no en español.** La consigna pide "terminología exacta de la cátedra en
español". Se resolvió: los identificadores replican **exactamente** los de la tabla `UnitMovementSchedule`
(B04) — `initialWip`, `startedInProduction`, `receivedFromPrevious`, `unitIncrease`, `transferredOut`,
`finishedInStock`, `normalLossPct`, `normalLoss`, `totalLossReported`, `extraordinaryLoss`, `finalWip` —
y la terminología de la cátedra ("existencia inicial de producción en proceso", "puestas en elaboración",
"unidades del período", "a justificar / justificado") va en JSDoc, comentarios y mensajes. Motivo: (a) es
la convención ya establecida en el repo (todo `src/domain/calculations/*` usa identificadores en inglés +
comentarios en español), y (b) que los nombres calcen 1:1 con la fila persistida hace que el motor de
Procesos (B17) mapee de la tabla a esta función sin traducir ni un campo. Cambiar a identificadores en
español rompería esa simetría y la convención del repo.

**`normalLossPct` es una fracción (0.02 = 2 %), no un porcentaje (2).** Mismo criterio que `holdingRate`
en `raw-material.ts` (Wilson usa 0.30, no 30). Documentado en el JSDoc del input. El caso ancla lo
confirma: 0.02 × 30.000 = 600.

**Reglas implementadas (fuente de verdad = cátedra, no se reinterpreta):**
- **R1 — derivación por diferencia.** Las dos derivables son `transferredOut` y `finalWip`. Si falta una,
  se despeja de `Σ a justificar − Σ salidas conocidas`. Si faltan **las dos**, son dos incógnitas →
  `ProcessValidationError`. Si la derivada sale **negativa** (las salidas informadas ya superan a las
  entradas) → también `ProcessValidationError`, es un cuadro imposible.
- **R2 — base de la pérdida normal = "unidades del período", nunca la EI.** sequence = 1 ⇒ puestas en
  elaboración; sequence > 1 ⇒ recibidas del anterior + aumento de unidades. Se expone `periodUnits` en el
  resultado para que el front lo muestre. El test compara un depto. inicial vs. uno posterior con **los
  mismos insumos totales pero distinta composición** (8.000 vs. 6.000+1.000) y el mismo 5 %: dan 400 vs.
  350 — prueba que la base cambia y que la EI **no** entra en la base.
- **R3 — pérdida extraordinaria por diferencia = `totalLossReported − normalLoss`.** Nunca se ingresa
  directa. Sin `totalLossReported` ⇒ la pérdida real total se asume igual a la normal (extraordinaria = 0).
  Si la real informada es **menor** que la normal (extraordinaria negativa) → `ProcessValidationError`.
- **R4 — coherencia por posición.** Depto. inicial (sequence = 1) con `receivedFromPrevious` o
  `unitIncrease` distintos de cero → error. Se agregó el chequeo **simétrico** (no exigido explícitamente,
  pero es la misma regla de dominio): un depto. posterior con `startedInProduction` ≠ 0 también corta,
  porque "puestas en elaboración" solo existen en el inicial. Se considera "provisto" un valor definido y
  **no nulo**: pasar `0` o `null`/`undefined` (como los trae la fila de un depto. inicial en la DB) es
  inofensivo; solo una cantidad real que no corresponde dispara el 422.
- **R5 — chequeo duro final.** `Σ a justificar = Σ justificado`. Si no, `ProcessValidationError` con la
  diferencia en el mensaje **y** en `details.difference` — eso es lo que leerá el indicador
  "cuadra / no cuadra" del front. Cuando se derivó una línea por diferencia, R5 cuadra por construcción;
  el chequeo muerde de verdad cuando el usuario carga **ambas** derivables a mano.

**`ProcessValidationError`** (nuevo, en `src/domain/errors/calculation-errors.ts`) extiende
`UnprocessableEntityError` → **422**, nunca 500. Lleva mensaje accionable en español y `details`
(`difference` y/o `field`) suficiente para que la capa HTTP (B17) arme el 422 y el front ubique el dato.
Sigue el estilo de `MissingInputError` / `MissingAllocationBaseError` del mismo archivo.

**Verificación.** `tests/domain/process-costing.test.ts` (8 casos): cuadro balanceado con EF derivada;
`transferredOut` derivada dando la EF; R2 (inicial vs. posterior, base distinta); R4 (recibidas y aumento
en el inicial, dos casos); R5 (desbalance, con la diferencia = 500 nombrada); R1 (dos incógnitas); y el
**caso ancla de la cátedra (Azur Alcoholes, Destilado, abril)** que reproduce exactamente
30.000 + 600 + 1.000 + 3.400 = 35.000. Suite completa: **518 passed / 1 skipped** (63 archivos), cero
regresión. Sin migración, sin `prisma migrate dev` (B06 es dominio puro, no toca schema ni DB).

## B07 — Dominio: `calcEquivalentProduction` (producción equivalente, función pura)

Segundo paso del Costeo por Procesos, el más importante después del cuadro: la **producción equivalente**
expresa, en términos de unidades terminadas, cuánto se procesó realmente en el período. Si sale mal, toda
la hoja de costos sale mal. Vive en el **mismo archivo** que B06
(`src/domain/calculations/process-costing.ts`), 100 % pura (sin Prisma, HTTP ni servicios), misma
convención: `Decimal` de decimal.js, identificadores en inglés que calzan 1:1 con `UnitMovementSchedule`,
JSDoc/comentarios/mensajes en español con terminología de la cátedra.

**Toma el cuadro ya resuelto (`UnitMovementSchedule` de B06), no lo recalcula.** La entrada es el cuadro
que devuelve `buildUnitMovementSchedule` más los grados de avance de la existencia final por elemento. Así
las dos funciones componen sin duplicar la aritmética del cuadro, que es la que ya está testeada.

**Una columna por elemento; el fórmula es la misma para todas.** Para cada columna:
`terminadas y transferidas + terminadas en existencia + pérdidas extraordinarias` (todas al 100 %, es el
campo `unitsAtFullCompletion`, común a todas las columnas) `+ EF × (grado de avance de ESE elemento)`.

**Reglas implementadas (fuente de verdad = cátedra):**
- **R1 — las pérdidas NORMALES no entran.** Las absorben las unidades buenas; no aparecen en ninguna
  columna. Un test con pérdida normal grande (1.000) y EF = 0 lo fija: la PE es exactamente las terminadas
  (9.000), no 10.000.
- **R2 — las pérdidas EXTRAORDINARIAS sí entran, al 100 %.** La cátedra lo marca explícitamente como
  fuente de error frecuente. Se suman dentro de `unitsAtFullCompletion`. Test de contraste: en la CC del
  caso ancla, contarlas da 33.720 y no contarlas daría 32.720 — el delta es exactamente las 1.000
  extraordinarias.
- **R3 — la MP va al 100 % en la EF por default, overridable.** La materia prima se incorpora al inicio
  del proceso, así que `mpAvance` es 1 por default; se puede sobrescribir cuando la MP no está toda al
  inicio. Dos sub-casos en los tests: default (MP = 34.400) y override al 50 % (MP = 32.700).
- **R4 — la EF es la ÚNICA fila multiplicada por un grado de avance.** Todas las demás filas van al 100 %.
  Sale directo de la fórmula: solo `finalWip` se multiplica por el avance.

**Agrupación de la conversión = flag del departamento, modelada como unión discriminada
(`conversionUnified`).** `ProcessDepartment.defaultConversionAvanceEqualsMO` decide:
`conversionUnified: true` → una sola columna **"Costo de Conversión (CC)"** (MOD y CIP comparten avance);
`conversionUnified: false` → columnas separadas **MOD** y **CIP** con avances distintos. El tipo obliga a
dar `conversionAvance` en el primer caso y `modAvance`/`cipAvance` en el segundo — imposible olvidarse un
dato en tiempo de compilación.

**"Costo primo" (MP+MOD agrupados) queda fuera de B07 — deferido a propósito.** La consigna lo menciona
como agrupación posible, pero (a) ningún test lo pide, (b) el esquema de la DB solo distingue avance de MP
y avance de Conversión para la EF (`finalWipMpAvance` / `finalWipConvAvance`), no un avance de MOD separado
que habilite juntar MP+MOD, y (c) la decisión que sí codifica el modelo es CC-unificada vs. separada. Se
implementa lo que el modelo soporta hoy (regla #8: default más simple que cumple el spec, documentado);
costo primo llega cuando el modelo lo necesite.

**"CIP" en el dominio, aunque la tabla diga "Cif".** La consigna (fuente de verdad) nombra los tres
elementos MP / MOD / **CIP** (costos indirectos de producción). Se usan esas etiquetas de cátedra en el
código nuevo; los campos de la tabla `UnitMovementSchedule` siguen diciendo `periodCostCif` /
`finalWipConvAvance` (B04, no se tocan). El motor de Procesos (B17) mapea uno a otro.

**Validación de grados de avance: fracción en [0, 1] o 422.** Un avance fuera de rango casi siempre es un
porcentaje sin normalizar (80 en vez de 0.80). Se corta con `ProcessValidationError` (422, nunca 500)
accionable, mismo criterio que `normalLossPct` en B06.

**Verificación.** `tests/domain/process-costing.test.ts` extendido con 7 casos B07 (15 en total): caso
ancla **Azur Alcoholes, Destilado, abril → MP 34.400 / CC 33.720 exacto**; R2 (extraordinarias al 100 %,
con contraste 33.720 vs 32.720); R1 (normales excluidas); R3 (MP default 100 % y override); tres elementos
separados con tres columnas distintas; y avance fuera de [0,1] → 422. Suite completa: **556 passed /
1 skipped** (71 archivos), cero regresión. Sin migración, sin `prisma migrate dev` (dominio puro).

**Re-sync con `origin/staging` + un test rojo pre-existente de staging.** Antes de empezar se mergeó
`origin/staging` (rule #1c). Conflicto en `cost-period-service.ts`: solo texto de mensajes de alerta de
anomalía — se tomó la redacción estandarizada de staging (`[Alerta de Anomalía: …]`) para no regresar su
cambio intencional. Además, al correr la suite completa apareció **1 test rojo que ya venía roto en
`origin/staging`** (probado: los archivos involucrados son byte-idénticos a staging): en
`tests/application/cost-period-compare.test.ts`, el caso de `macroContrast` con un período **OPEN** fuerza
el recálculo (`toSide → computeResult`), y el fixture de ese archivo traía un `directLaborConfig`/
`indirectCostConfig` con forma vieja que ya no valida contra los esquemas actuales (post B40:
`itcs.uncertainRemunerative`/`uncertainNonRemunerative` requeridos, `centers.min(1)`). Los períodos CLOSED
leen su snapshot y nunca parsean esos configs, por eso el test pasaba antes de que staging agregara el caso
OPEN. Fix **solo de datos de test** (sin tocar lógica de producto): se le dio al fixture un
`directLaborConfig`/`indirectCostConfig` válido y recomputable, restaurando la intención del autor del test.
Con eso la suite queda verde de punta a punta.

**Nota de entorno (no es del código):** `tsc --noEmit` marca errores de cliente Prisma desactualizado
(`companyTargetBudget`, `whatsappPhoneNumber`) que trajo el merge de staging; se arreglan con
`prisma generate` (lo corre el script `build`), pero acá el `.dll` del query engine está tomado por un
proceso node en ejecución (dev server) y el generate da `EPERM`. No se mató el proceso del usuario. El
código nuevo de B07 es type-clean y toda la suite de tests pasa.

## B08 — Dominio: `calcNormalAndExtraordinaryLosses` (pérdidas normales y extraordinarias, función pura)

**Qué hace.** Determina las pérdidas **normales** y **extraordinarias** de un departamento para un
período. Función pura, mismo archivo que B06/B07 (`src/domain/calculations/process-costing.ts`), sin
Prisma/HTTP/servicios. La consumen el cuadro (B06), el CAUP/CAUO (B09) y el informe (B10).

**Fuente ÚNICA de la regla de pérdidas (el punto central de la tarea).** B06 ya calculaba las pérdidas
*inline* dentro de `buildUnitMovementSchedule` (base "unidades del período", pérdida normal y
extraordinaria por diferencia). Eso era exactamente la duplicación que la consigna pedía eliminar. Se
**extrajo** esa lógica a `calcNormalAndExtraordinaryLosses` y **B06 ahora delega** en ella (le pasa las
entradas ya corregidas por posición y desestructura `periodUnits`/`normalLoss`/`extraordinaryLoss`). La
regla vive en un solo lugar; no hay forma de que B06 y B08 diverjan. Un test lo prueba célula a célula
(cuadro ancla vs. función pura → mismas pérdidas).

**Reglas modeladas (source of truth: cátedra):**
- **R1 — base "unidades del período", que DIFIERE por posición:** depto. inicial (seq 1) → puestas en
  elaboración; depto. posterior (seq > 1) → recibidas del anterior + aumento de número de unidades. **El %
  NUNCA se computa sobre la existencia inicial** (son unidades del período anterior). Regla explícita y muy
  tomada. En la función pura, la EI **ni siquiera es un campo del input**: es estructuralmente imposible
  que entre en la base. Además hay un test a nivel cuadro que pasa una EI no trivial (8.000) y comprueba
  que la pérdida normal no se mueve.
- **R2 — extraordinaria por diferencia:** `extraordinaria = pérdida real total informada − pérdida normal`.
  Nunca se ingresa directa; los únicos inputs son el % normal y la pérdida real total. Si la real < normal
  ⇒ `ProcessValidationError` (422 accionable en español), porque una extraordinaria negativa es imposible.
  Sin pérdida real informada ⇒ default = normal (sin extraordinaria).
- **R3 — tratamiento (banderas de salida).** La función computa **cantidades**; la valuación es de pasos
  posteriores. Se exponen `normalLossAbsorbedAutomatically` (true en el depto. inicial: la absorben las
  unidades buenas sin cálculo extra) y `normalLossGeneratesCaup` (true en deptos. posteriores: la normal
  genera el CAUP/CAUO en B09). La extraordinaria ya la consume B07 al 100 % en la producción equivalente y
  se valúa al Estado de Resultados, no al costo del producto.

**Decisión de diseño — B06 pasa entradas ya corregidas por posición.** `buildUnitMovementSchedule` ya
resuelve los ceros que impone la posición (un depto. inicial no tiene recibidas/aumento; uno posterior no
tiene puestas). Le pasa esos Decimals ya corregidos a B08. Como B08 vuelve a ramificar por `sequence` para
elegir la base, el resultado es idéntico y la regla de "qué base según posición" queda escrita una sola vez
(en B08). No se movió la validación R4 de coherencia de entradas: sigue en B06, que es el que arma el cuadro.

**Casos ancla reproducidos exactos.** Destilado (seq 1): puestas 30.000, 2 % → normal **600**; real 1.600 →
extraordinaria **1.000**. Purificado (seq 2): recibidas 30.000 + aumento 2.000 = base 32.000, 1 % → normal
**320** (el valor que usa el CAUP en B09), con test que descarta las bases equivocadas (300 sin aumento,
400 con EI, 80 solo EI).

**Verificación.** `tests/domain/process-costing.test.ts` extendido con 7 casos B08 (22 en total): R1 base
inicial (600); R2 extraordinaria por diferencia (1.000); R1 base posterior "recibidas + aumento" (320);
R1 la EI nunca entra aunque el cuadro la lleve (Purificado con EI 8.000 → sigue 320); R2 real < normal →
422; default sin extraordinaria; y la delegación B06→B08 (mismas pérdidas). Suite completa: **563 passed /
1 skipped** (71 archivos), cero regresión. `tsc --noEmit` limpio. Sin migración, sin `prisma migrate dev`
(dominio puro, no toca schema ni DB).

## B09 — Dominio: `calcTransferredCost` (costo transferido = costo modificado + CAUP, función pura)

**Qué hace.** Calcula el costo unitario que un departamento lleva HACIA ADELANTE, al siguiente ("costo
del departamento anterior"). No es el costo unitario tal cual: se recalcula por DOS ajustes
independientes y ORDENADOS. Función pura, mismo archivo que B06/B07/B08
(`src/domain/calculations/process-costing.ts`), sin Prisma/HTTP/servicios. La consumirá el informe (B10)
y el motor de Procesos (B17).

**Por qué es la tarea más delicada.** Es la parte más fácil de equivocar de todo el motor: dos ajustes
que se pisan si se aplican en el orden equivocado, y una matriz de combinaciones donde cada celda hace
algo distinto. Por eso se implementó la **matriz de 4 combinaciones como CUATRO RAMAS EXPLÍCITAS** (no un
cálculo "inteligente" que las colapse), con **un test por celda** más el ancla y el control.

**Terminología.** CAUP = CAUO = "Costo Adicional por Unidades Perdidas" (sinónimos). En el código se usa
**CAUP**; se acepta que el plan/otros docs digan CAUO.

**Los dos pasos (source of truth: cátedra):**
- **PASO 1 — COSTO MODIFICADO.** Recalcula el costo unitario del anterior cuando cambia la cantidad de
  unidades. Aplica si hay existencia inicial (EI) recibida del anterior **y/o** aumento de número de
  unidades: `costo modificado = (costo total EI + costo total del anterior del período) ÷ (unidades EI +
  recibidas + aumento)`. Sin EI, el promedio se reduce a `costo del período ÷ (recibidas + aumento)` (la
  EI aporta 0 y 0). **Ni EI ni aumento ⇒ se usa el costo unitario previo DIRECTO** (sin modificación).
  **CONTROL de cátedra:** con aumento, el costo modificado debe ser **estrictamente menor** que el previo
  (más unidades diluyen el mismo costo total); si sale ≥, es error de carga ⇒ `ProcessValidationError`
  (422 accionable en español, nunca 500).
- **PASO 2 — CAUP.** Solo en departamentos posteriores (seq > 1) y solo con pérdidas normales:
  `costo de la pérdida = pérdidas normales × costo modificado`; `unidades buenas = unidades a justificar −
  pérdidas normales`; `CAUP = costo de la pérdida ÷ unidades buenas`. Las pérdidas **extraordinarias** son
  unidades buenas (se terminaron y luego se perdieron): las únicas "malas" acá son las normales.
  `costo transferido = costo modificado + CAUP`.

**Decisión de diseño — las ramas son la matriz literal (aumento × pérdidas normales).** El `if/else`
ramifica sobre los DOS ejes de la matriz de cátedra —aumento y pérdidas normales—, una rama por celda, de
modo que cada celda mapea 1:1 a un test. El manejo de la EI (source of truth: "promedio con EI si la hay,
si no el costo previo") vive DENTRO del Paso 1 (`computeCostoModificado`), no como un tercer eje: así la
fila `(No, No)` con EI presente igual promedia (respeta el spec de Paso 1) sin romper la lectura de la
matriz. El control de dilución solo corre en las ramas con aumento.

**Decisión de diseño — una sola cantidad para "unidades a justificar".** El denominador del Paso 1
(EI + recibidas + aumento) es EXACTAMENTE las "unidades a justificar" que el Paso 2 usa para las unidades
buenas. Se computa UNA vez (`unidadesAJustificar`) y se reutiliza, para que los dos pasos no puedan
divergir.

**Ambigüedad resuelta (regla #8).** La matriz rotula el eje como "aumento", pero el spec de Paso 1 (source
of truth) dispara con **EI y/o aumento**. Se tomó el spec: el disparador real de la modificación es
`EI || aumento`, y la columna "aumento" de la matriz es una simplificación (su fila `(No, Sí)` ya aclara
"promedio con EI si la hay"). Documentado; sin riesgo de pérdida de datos.

**Caso ancla reproducido EXACTO.** Azur Alcoholes, Purificado, abril: EI $11.120 + período $112.500 =
$123.620 ÷ 35.320 → costo modificado **$3,50** (< $3,75 previo ✓); pérdidas normales 320 → costo de la
pérdida $1.120, unidades buenas 35.000, CAUP **$0,032**; costo transferido $3,50 + $0,032 = **$3,532**.

**Verificación.** `tests/domain/process-costing.test.ts` extendido con 5 casos B09 (27 en total): las 4
celdas de la matriz —(aumento Sí, normales No) con dilución; (No, Sí) promedio-con-EI + CAUP; (Sí, Sí) el
ancla Purificado 3,50/0,032/3,532; (No, No) devuelve el previo sin cambios— más el control de dilución
(aumento con modificado ≥ previo → 422). Suite completa: **568 passed / 1 skipped** (71 archivos), cero
regresión. `tsc --noEmit` limpio. Sin migración, sin `prisma migrate dev` (dominio puro, no toca schema ni DB).

## B10 — Dominio: `buildProductionCostReport` (informe de costos de producción, función pura)

**Qué hace.** Ensambla la hoja de costos de UN departamento para UN período: los números finales
valuados. Cierra la matemática por departamento a partir de las piezas de B06-B09 (cuadro de movimiento,
producción equivalente, pérdidas, costo transferido). Función pura, mismo archivo que B06/B07/B08/B09
(`src/domain/calculations/process-costing.ts`), sin Prisma/HTTP/servicios. La consumirá el motor de
Procesos (B17).

**Función ENSAMBLADORA, no calculadora.** El punto de la tarea es que B10 NO recalcula nada: toma el
`UnitMovementSchedule` (B06), el `EquivalentProductionSchedule` (B07) y los costos por elemento (más el
costo transferido de B09 en seq > 1) ya resueltos, y los combina. Así la regla de cada pieza vive en un
solo lugar y B10 no puede divergir de sus insumos.

**Las tres partes de la hoja (source of truth: cátedra):**
- **PARTE 1 — COSTO A JUSTIFICAR.** Sección A (costo del departamento anterior, SOLO seq > 1) + Sección B
  (costos del departamento, abiertos por elemento en inventario inicial y período). Costo unitario del
  elemento = `(costo inv. inicial + costo del período) ÷ producción realmente procesada` (**promedio
  ponderado**, único método acá). Costo unitario total acumulado = Σ costos unitarios (+ costo transferido
  en seq > 1). Costo acumulado a justificar = Σ de todos los costos totales.
- **PARTE 2 — JUSTIFICACIÓN.** Terminadas y transferidas, terminadas en stock y pérdidas extraordinarias,
  cada una × costo unitario total acumulado. La **existencia final se obtiene POR DIFERENCIA** (costo a
  justificar − las tres líneas): es la única línea que no se computa directo, porque las unidades en
  proceso no están terminadas y no se les aplica el costo de la unidad terminada.
- **PARTE 3 — VALUACIÓN DE LA EF (verificación).** Recomputa la EF por el OTRO camino, por elemento:
  `Σ (unidades equivalentes de la EF del elemento × costo unitario del elemento)` (+ en seq > 1) `unidades
  EF × costo transferido del anterior` (siempre al 100 %).

**Doble verificación (assertion dura).** La valuación por elemento (Parte 3) DEBE igualar la EF por
diferencia (Parte 2) dentro de una tolerancia de redondeo. Si difieren más que la tolerancia ⇒
`ProcessValidationError` (422 accionable en español); NUNCA se devuelve un informe inconsistente. Un ajuste
de pocos pesos por redondeo de los costos unitarios se **acepta y se registra** (`ajustePorRedondeo`); uno
desproporcionado al total delata un error previo (costos, costo transferido o cuadro) y corta.

**Decisión de diseño — la Sección A se pasa explícita (costo unitario + costo total).** En seq > 1 el
costo del departamento anterior necesita el costo unitario transferido (B09, para el costo unitario total
acumulado y la valuación al 100 % de la Parte 3) y el costo total acumulado (para el costo a justificar).
Se piden los DOS por separado en `previousDepartmentCost` en vez de reconstruir la semántica del CAUP
(total = unidades buenas × costo transferido) dentro de B10: mantiene a B10 como ensamblador y deja que la
inconsistencia entre ambos —si el llamador se equivoca— la atrape la doble verificación. En seq 1 la
Sección A va en blanco: informarla es error, y omitirla en seq > 1 también (guardas simétricas, criterio
de la R4 de B06).

**Decisión de diseño — tolerancia de redondeo absoluta, configurable.** `DEFAULT_ROUNDING_TOLERANCE = 5`
pesos, sobrescribible por `roundingTolerance`. La cátedra habla de "unos pocos pesos"; una cota absoluta
simple alcanza para distinguir el residuo de redondeo de un error real (que es de orden mucho mayor). El
`ajustePorRedondeo` se computa siempre como `EF por diferencia − EF por elemento` y viaja en la salida;
la Parte 2 (por diferencia) queda como la EF oficial y la Parte 3 reconcilia con ese ajuste.

**Ambigüedad resuelta (regla #8).** El split inventario inicial / período de cada elemento NO cambia el
costo unitario (solo entra la SUMA); se conserva la apertura porque la hoja la muestra en dos subsecciones,
pero los tests eligen libremente el reparto. Documentado; sin riesgo de pérdida de datos.

**Casos ancla reproducidos EXACTO.** Azur Alcoholes, abril:
- **Destilado (seq 1):** costo unitario MP $2,00 + CC $1,75 = **$3,75**; costo acumulado a justificar
  **$127.810**; terminadas 30.000 × $3,75 = $112.500; extraordinarias 1.000 × $3,75 = $3.750; **EF por
  diferencia $11.560** = por elemento (MP 3.400 × $2,00 = $6.800 + CC 2.720 × $1,75 = $4.760). Ambos
  caminos $11.560, ajuste $0.
- **Purificado (seq 2):** costo unitario total **$6,532** ($3,532 transferido + $1,00 MP + $2,00 CC); **EF
  por elemento $31.992** (anterior 6.000 × $3,532 = $21.192 + MP 6.000 × $1,00 = $6.000 + CC 2.400 × $2,00
  = $4.800), coincide con la EF por diferencia.

**Verificación.** `tests/domain/process-costing.test.ts` extendido con 5 casos B10 (32 en total): los dos
anclas (EF por AMBOS caminos en Destilado; costo total $6,532 y EF $31.992 en Purificado); la doble
verificación que lanza 422 al forzar una inconsistencia (Sección A corrompida, ajuste $26.380); un ajuste
por redondeo de $2 dentro de tolerancia que se acepta y registra; y las guardas de Sección A (depto.
inicial no la lleva, depto. posterior sin ella → 422). Suite completa: **573 passed / 1 skipped** (71
archivos), cero regresión. `tsc --noEmit` limpio. Sin migración, sin `prisma migrate dev` (dominio puro,
no toca schema ni DB).

## B11 — Costos conjuntos: los 4 métodos de reparto (dominio puro)

**Qué se hizo.** `src/domain/calculations/joint-costs.ts` (función pura, sin Prisma/HTTP/servicios): reparte
el costo conjunto (MP + conversión acumulados hasta el punto de separación — el TODO) entre los productos que
emergen en el punto de separación. Cuatro funciones con la MISMA firma `(products, jointCostTotal)` —
`allocateByPhysicalUnits`, `allocateByTechnicalYield`, `allocateByMarketValue`, `allocateByNetRealizableValue`—
y un dispatcher `allocateJointCosts(products, method, jointCostTotal)`. Ningún método es "el correcto": el
usuario elige y cada uno da un costo unitario distinto. Nombres de campo alineados a `ByProductLine` (B05) para
que el motor (B17) mapee sin traducir.

**Diseño — núcleo compartido.** Los cuatro métodos difieren SOLO en la "base de reparto" de cada línea; el
resto (participación = base ÷ Σ bases; asignado = participación × total; unitario = asignado ÷ unidades; y los
dos controles) vive UNA sola vez en `allocate(...)`, al que cada método le pasa su `baseOf`. Evita divergencia
entre métodos y garantiza firma/salida idénticas.

**Ambigüedad resuelta (regla #8) — factor técnico sin `rawMaterialKg`.** El spec define kilos obtenidos(p) =
kg MP × % rendimiento(p), pero los kg de MP son un FACTOR COMÚN a todas las líneas y se cancelan en la
participación (kilos obtenidos ratio = rendimiento ratio). La firma fija de tres parámetros del dispatcher no
lleva kg de MP, así que la base de reparto del método es directamente `yieldPct` (rendimiento). Da igual
fracción o porcentaje mientras sea consistente entre líneas. Las `unitsObtained` de la línea son los kilos
obtenidos y hacen de denominador del costo unitario. Reproduce las participaciones del ancla M2 exacto sin
pedir un dato extra.

**Diseño — controles de la cátedra como aserción dura.** `assertAllocationConsistency` verifica Σ
participaciones = 100 % (tol. 1e-9) y Σ costos asignados = costo conjunto total (tol. $0,01). Se cumplen por
construcción; la cota solo absorbe el residuo de redondeo al dividir. Que fallen sería un error de
programación, no de datos. Validaciones de datos rotos (sí accionables, 422 `ProcessValidationError`, nunca un
500): sin productos, unidades ≤ 0, costo conjunto negativo, falta un campo del método (precio/rendimiento),
base total ≤ 0 (p. ej. todos los precios en 0) y VNR negativo (gastos de comercialización > valor de venta).

**Casos ancla FX-J1 reproducidos EXACTO** (`tests/domain/joint-costs.test.ts`):
- **M1 (unidades físicas):** costo conjunto $570.000; A 2.500 / B 3.000 / C 4.000 (buenas 9.500; desperdicio
  500 NO se lista) → $60/kg → A $150.000, B $180.000, C $240.000. Control $570.000.
- **M3 (valor de mercado):** $570.000; bases $300.000 / $510.000 / $900.000 (Σ $1.710.000) → A $100.000
  ($40/kg), B $170.000 ($56,67/kg), C $300.000 ($75/kg). Control $570.000.
- **M4 (VNR):** $110.000; var 3 % sobre valor de venta + fija $10/kg → VNR $56.200 / $113.400 / $190.000 (Σ
  $359.600) → A $17.191,32 ($85,96/kg), B $34.688,54, C $58.120,13. Control $110.000. Nota: la cátedra imprime
  el unitario de B/C redondeado a pesos enteros ($115 y $145); los tests comparan el asignado (que es el que
  reproduce el ancla) y el unitario con la precisión que corresponde.
- **M2 (factor técnico):** MP 1.000 kg; rendimientos 6 % / 0,50 % / 5 % → kilos 60/5/50 (Σ 115) →
  participaciones 52,17 % / 4,35 % / 43,48 %; asignado = participación × costo conjunto total.

**Verificación.** 10 casos nuevos: los 4 anclas + "los 4 métodos sobre el MISMO dataset dan costo unitario
distinto" (los 4 unitarios de A son todos diferentes) + controles y datos rotos que lanzan 422. Suite completa:
**583 passed / 1 skipped** (72 archivos), cero regresión. `tsc --noEmit` limpio. Sin migración, sin `prisma
migrate dev` (dominio puro, no toca schema ni DB).

## B15 — Application: `unit-movement-service` (cuadro de movimiento como servicio + trazabilidad)

**Qué se hizo.** CRUD del cuadro de movimiento de unidades por (departamento, período), apoyado en las
funciones PURAS del dominio (`buildUnitMovementSchedule` B06, `calcEquivalentProduction` B07): el servicio
`src/application/cost-structures/process-costing/unit-movement-service.ts` orquesta (validar → persistir →
auditar → trazar), nunca reimplementa la matemática. Tres endpoints protegidos por auth, solo para estructuras
`costingSystem = 'PROCESSES'`:
- `GET  /structures/:id/process/departments/:deptId/periods/:periodId/movement` — cuadro guardado + resuelto
  (con derivados por diferencia y estado "cuadra / no cuadra") + `dataPointId` de cada cifra trazable.
- `PUT  …/movement` — upsert (clave única `[departmentId, periodId]`), valida con el dominio, traza.
- `GET  …/equivalent-production` — deriva la producción equivalente (B07) del cuadro guardado.

**Trazabilidad reusando `DataPointService` (no un mecanismo paralelo).** Cada valor MANUAL del cuadro se
persiste como un `DataPoint` versionado. El valor DERIVADO por diferencia (el de `transferredOut` o `finalWip`
que el usuario NO cargó) NO es DataPoint: es computado, no ingresado. La regla es simple y testeable: un campo
se traza sí y solo sí viene en el body (no `undefined`), lo que excluye automáticamente al derivado (que se
omite). Un re-save con el mismo valor no versiona (sin ruido); con un valor distinto agrega `version_n+1`
(append-only, nunca pisa).

**Decisión — una sola transacción atómica.** El `save` completo (upsert de la fila + todos los DataPoints +
sus auditorías) corre dentro de UN `withTenant`. Para reusar `DataPointService` sin abrir transacciones
sueltas, se extrajeron dos métodos componibles —`createInTx(tx, …)` y `addVersionInTx(tx, …)`— y los públicos
`create`/`addVersion` ahora delegan en ellos dentro de su propio `withTenant`. La API pública y el
comportamiento no cambian (los tests existentes de `DataPointService` siguen verdes): la lógica de creación y
corrección de un dato trazable vive en UN solo lugar.

**Decisión — `element = 'MP'` para todo el cuadro.** El cuadro de movimiento sigue UNIDADES FÍSICAS del
producto (la materia que fluye por el proceso), no un elemento del costo puntual — la apertura por elemento
(MOD/CIP) recién aparece en la producción equivalente (B07). El enum `CostElement` no tiene una opción
"unidades", así que MP es el hogar natural y estable de estas cifras. Los grados de avance (MP/Conversión) se
persisten para la producción equivalente pero NO se trazan como DataPoints: son insumos de la PE, no del cuadro
de movimiento.

**Decisión — `fieldKey` con scope depto+período.** Como `DataPoint` se ancla solo a `structureId`, la clave
`proceso.cuadro.{periodId}.{departmentId}.{campo}` hace única cada celda del cuadro por estructura, depto,
período y campo, para que un re-save encuentre el dato existente y le agregue versión en vez de duplicarlo. El
`fieldKey` es una clave interna de máquina (nunca se muestra al usuario; lo que se ve es el `label` humano
"Recibidas del departamento anterior · Destilado, Abril 2026"), así que no viola la regla de no exponer ids.

**Decisión — errores accionables en español, nunca un 500.** Los `ProcessValidationError` del dominio (cuadro
que no cuadra, dos incógnitas, depto. inicial con recibidas/aumento) se re-emiten anteponiendo el NOMBRE del
departamento (nunca su id) → 422. Sobre una estructura de Órdenes, un 422 que nombra el producto y explica que
el cuadro solo aplica a Procesos. `equivalent-production` sin cuadro cargado → 422 accionable nombrando el
departamento y el período.

**Decisión — producción equivalente con un solo avance de conversión.** La tabla `unit_movement_schedules`
persiste un único `finalWipConvAvance`; si el departamento sigue MOD y CIP por separado
(`defaultConversionAvanceEqualsMO = false`), ambas columnas usan ese avance común. Sin avance cargado, la EF
aporta 0 a la conversión (default explícito, no se inventa un número).

**Sin migración.** La tabla `unit_movement_schedules` y su RLS ya existen (B04). Cero `prisma migrate dev`.

**Verificación.** 9 tests nuevos de aplicación (Prisma mockeado, mismo patrón que `data-point-service.test.ts`):
round-trip save+get que cuadra y deriva la EF; cuadro desbalanceado → 422 nombrando el depto; cada valor manual
crea un DataPoint y el derivado NO; auditoría del cuadro en la misma transacción; `equivalent-production`
reproduce el resultado B07; endpoints sobre Órdenes → 422; re-save sin cambio no versiona y con cambio versiona.
Suite completa: **592 passed / 1 skipped** (73 archivos), cero regresión. `tsc --noEmit` limpio. (Nota: el
script `npm run lint` está roto a nivel repo —ESLint v9 sin `eslint.config.js`—, ajeno a esta tarea.)

## B16 — Application: `joint-cost-service` (costos conjuntos como servicio + trazabilidad)

**Qué se hizo.** CRUD del reparto de costos conjuntos por (departamento punto de separación, período), apoyado
en la función PURA del dominio `allocateJointCosts` (B11): el servicio
`src/application/cost-structures/process-costing/joint-cost-service.ts` orquesta (validar → repartir →
persistir → auditar → trazar), NUNCA reimplementa la matemática de los cuatro métodos (PHYSICAL_UNITS /
TECHNICAL_YIELD / MARKET_VALUE / NET_REALIZABLE_VALUE). Dos endpoints protegidos por auth, solo para
estructuras `costingSystem = 'PROCESSES'`:
- `GET /structures/:id/process/periods/:periodId/joint-costs?deptId=…` — configuración guardada + resultado recalculado.
- `PUT /structures/:id/process/periods/:periodId/joint-costs` — persiste, computa y devuelve el reparto.

**Decisión — el departamento viaja en query/body, no en el path.** El enunciado fijó los paths scopeados por
estructura+período (`…/process/periods/:periodId/joint-costs`), sin segmento de departamento, pero un reparto
es único por `(departmentId, periodId)` y la FK exige un departamento. Para honrar el path literal del enunciado
SIN perder el departamento, `deptId` viaja como query param en el GET y como campo del body en el PUT. Es un
identificador de recurso (no se muestra en ningún mensaje), así que no viola la regla de no exponer ids.

**Decisión — FX-J2: la pérdida se MUESTRA, nunca se descarta.** Un método (típicamente el factor técnico, que
reparte por rendimiento e ignora el precio) puede asignarle a un producto un costo mayor a su valor de mercado.
Ese producto queda con MARGEN NEGATIVO, pero el reparto es válido. El servicio devuelve cada línea con TODOS sus
números (costo asignado, costo unitario, `marketValue`, `margin`) y una bandera `isLoss = margin < 0`; jamás
filtra la línea. El `margin` queda en `null` si no hay precio de mercado cargado (no se inventa un valor de
venta). El dominio solo corta con 422 el caso IMPOSIBLE de repartir (VNR negativo, base total 0), no la pérdida.

**Decisión — `method` de reparto vs. `captureMethod` de trazabilidad.** El body usa `method` para el método de
REPARTO (como pidió el contrato `save(...{ method, jointCostTotal, products })`) y `captureMethod` para el
método de CAPTURA del dato trazable, evitando la colisión con el `method` de `captureMethodSchema` que usa el
resto de Trazabilidad.

**Decisión — líneas reemplazadas, no append-only.** La cabecera `JointCostAllocation` se hace upsert y las
`ByProductLine` se borran y recrean en cada save (el reparto es una CONFIGURACIÓN editable, igual que el cuadro
de movimiento B15, no un log). La append-only vive donde corresponde: en los `DataPoint` de trazabilidad, que
versionan sin pisar. Los resultados calculados (`allocatedCost`, `unitCost`) se persisten en la línea pero NO
son DataPoints (son derivados, no ingresados).

**Decisión — trazabilidad de los insumos manuales.** Se persiste como `DataPoint` versionado (vía
`DataPointService`, mismo mecanismo que B15) el costo conjunto total y, por línea, cada insumo cargado
(`unitsObtained`, `yieldPct`, `marketPrice`, `sellingCostVarPct`, `sellingCostFixedPerUnit`). `fieldKey` con
scope `proceso.costos-conjuntos.{periodId}.{departmentId}.[jointCostTotal | producto.{nombre}.{campo}]` — clave
interna de máquina (nunca se muestra; lo que se ve es el `label` humano). El `element` del DataPoint mapea al
`CostElement` que mejor describe el impacto: cifras de costo/físicas (costo total, unidades, rendimiento) → MP;
cifras de venta (precio, gastos de comercialización) → VENTA, para que la ficha muestre los impactos correctos.
Un re-save con el mismo valor no versiona (sin ruido); con un valor distinto agrega la versión n+1.

**Decisión — errores accionables en español, nunca un 500.** Los `ProcessValidationError` del dominio (Σ% ≠
100 %, base de reparto total 0, VNR negativo, falta de precio/rendimiento) se re-emiten anteponiendo el NOMBRE
del departamento (nunca su id) → 422. Sobre una estructura de Órdenes, un 422 que nombra el producto y explica
que el reparto solo aplica a Procesos.

**Sin migración.** Las tablas `joint_cost_allocations` y `joint_cost_by_product_lines` y su RLS ya existen
(B05). Cero `prisma migrate dev`.

**Verificación.** 9 tests nuevos de aplicación (Prisma mockeado, mismo patrón que `unit-movement-service.test.ts`):
round-trip save+get (ancla M1); los 4 métodos con los números ancla FX-J1 (M2 participaciones, M3 costos
asignados/unitarios, M4 VNR); FX-J2 la línea con costo > valor de mercado se muestra con `isLoss=true` y no se
descarta; dataset roto (base 0) → 422 nombrando el depto; cada insumo manual crea un DataPoint (total + los de
la línea) y los resultados NO; auditoría del reparto en la misma transacción; endpoints sobre Órdenes → 422; get
sin reparto → `exists=false`; re-save sin cambio no versiona. Suite completa: **601 passed / 1 skipped** (74
archivos), cero regresión. `tsc --noEmit` limpio. (Nota: el script `npm run lint` sigue roto a nivel repo
—ESLint v9 sin `eslint.config.js`—, ajeno a esta tarea.)
