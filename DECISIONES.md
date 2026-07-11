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
