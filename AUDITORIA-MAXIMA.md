# AUDITORÍA MÁXIMA — CosteAR

Auditoría línea por línea del código de **cálculo de costos** y **trazabilidad**
contra el criterio de la cátedra de Costos (UNT) y los principios de Zayún.
Lenguaje simple: la leen costistas y desarrolladores.

- **Fecha:** 2026-07-11
- **Rama:** `AlanSandbox` (backend `Costear.api`, frontend `Costear.web/CosteAR-frontend`)
- **Base de tests al iniciar:** 193 verdes + 1 skip (motor puro, sin DB). Tras F0: 203 verdes.
- **Nota de ubicación:** este informe y `DECISIONES.md` viven en `Costear.api/`
  porque es un repo git con historia y donde ya estaba `DECISIONES.md`. El
  nivel `CosteAR rep/` no es un repo git (no se puede commitear ahí).

Convención de severidad:
🔴 rompe el número o la regla dura (R1–R7) · 🟠 concepto contable mal o gap
serio de trazabilidad · 🟡 terminología / UX / deuda menor.

---

## RESUMEN EJECUTIVO (10 líneas)

1. **El motor matemático puro está muy bien.** PPP, Wilson, días efectivos,
   ITCS aditivo con IAP derivado, cuotas, aplicado y variaciones replican la
   cátedra al centavo (FX1, FX2 y ahora FX3 en verde).
2. **El talón de Aquiles es la trazabilidad de la fuente de verdad.** El motor
   lee la config desde 3 columnas JSONB (`rawMaterialConfig`, etc.) que se
   **pisan con UPDATE** cada vez que el costista guarda → viola R1.
3. El sistema append-only de `DataPoint`/`DataPointVersion` es excelente, pero
   corre **en paralelo** al JSONB que realmente calcula: hay dos verdades.
4. Las mutaciones legadas (`updateConfig`, `create`, `calculate`, `updateSales`)
   escriben la auditoría **fuera de transacción** → viola R2.
5. **No existe la entidad "base de asignación".** El prorrateo se hace con
   unidades tipeadas a mano por centro; no hay catálogo (criterio B) ni el
   escalonado con orden de cierre (criterio A.3.c) → error (c) del 10/07.
6. Etiqueta **"Horas trabajadas"** donde el dato es presupuesto → error (a).
7. En Costos Indirectos, **real y presupuestado conviven en la misma tabla**
   sin separación fuerte → error (b).
8. El **período de costo** ya vive en la estructura (`period`), pero falta
   mostrarlo como atributo claro + distinguir captación (error d, parcial).
9. IAP ya es derivado de solo lectura (bien); falta mostrar su fórmula.
10. Terminología suelta y artefactos visuales menores (error e) a limpiar.

---

## 1) MOTOR DE CÁLCULO vs CRITERIO A

### Materia Prima (PPP y Wilson)

**🟢 OK** `src/domain/calculations/raw-material.ts:141` — `calcStockLedgerPPP`
recalcula el PPP tras cada compra y valúa los consumos al PPP vigente sin
alterarlo. Es exactamente el criterio A.1. Verificado por FX1 (2.043.076,92) y
FX3 (PPP 1.160, consumo 348.000). El consumo **no** tiene precio propio: sale
del PPP. Correcto.

**🟢 OK** `raw-material.ts:53` — `calcOptimalLot` = √(2·R·S/(K·C)) con guardas de
división por cero. Fiel a Wilson.

**🟡** `raw-material.ts:92` — el modelo asume **una sola materia prima** por
estructura (una ficha de stock, un Wilson). El criterio C exige "nunca una
sola MP genérica: múltiples MP con codificación real". — *Debería:* soportar N
materias primas por estructura. — *Importa:* con una sola MP no se puede costear
un producto real con varios insumos. — *Fix:* modelo `RawMaterial[]` por
estructura (Parte 3.1 / F4).

### Mano de Obra Directa (días, ITCS, IAP)

**🟢 OK** `direct-labor.ts:55` `calcWorkingDays` — días efectivos = total −
no pagos − pagos no trabajados. FX1 = 222. Correcto.

**🟢 OK** `direct-labor.ts:76` — **IAP derivado** = ausentismo pago / días
efectivos, nunca input manual. Cumple criterio A.2 ("SIEMPRE derivado"). El
frontend además lo bloquea explícitamente (`DirectLaborForm.tsx:213`).

**🟢 OK** `direct-labor.ts:127` `calcITCS` — fórmula **aditiva** ITCS = CSC +
Σinciertas remun (incl. IAP) + Σno remun + Σderivadas, con factor de derivación
`base + SAC + base·SAC` (SIN art_fija en el factor, como pide el criterio).
FX2 en verde (0,799903 / 0,676078 / 0,390833). Correcto.

**🟠** `direct-labor.ts:180` — el campo se llama **`hoursWorked`** ("Horas-hombre
trabajadas") y alimenta la tarifa horaria integral. — *Debería:* según criterio
A.2 estas son **horas presupuestadas** (capacidad normal), no trabajadas; las
trabajadas son el dato REAL de fin de mes. — *Importa:* mezcla el concepto de
presupuesto con el de real; es la raíz conceptual del error (a). — *Fix:*
renombrar a `budgetedHours` en dominio/schema y "Horas presupuestadas" en UI
(F6). Ver también `cost.schema.ts:77`.

### Costos Indirectos (prorrateos, cuotas, variaciones)

**🟢 OK** `indirect-costs.ts:66` `primaryProration` — reparte cada concepto por
su base y valida base total = 0 (lanza `CalcError`). Correcto para el modo
"unidades por centro".

**🔴** `indirect-costs.ts:120` `secondaryProration` — hace **una sola pasada
directa** servicio→productivo. — *Debería:* criterio A.3.c pide método
**escalonado** con **orden de cierre** explícito donde un servicio puede
transferir a **otro servicio que aún no cerró** (FX4: "Mantenimiento PUEDE
recibir porque aún no cerró; Of. Técnica NO porque ya cerró"). — *Importa:* sin
esto no se puede costear ninguna planta con más de un centro de servicio
interdependiente; es el corazón del error (c). — *Fix:* motor escalonado nuevo
(F3, Parte 4.4) manteniendo la pasada directa como caso particular.

**🟠** `indirect-costs.ts:104` + `cost.schema.ts:104,108` — la distribución
(`concept.distribution`, `serviceDistributions.toProductive*`) son **unidades
crudas tipeadas por centro**. — *Debería:* existir la entidad "base de
asignación" (criterio B: superficie m², HP, focos, requisiciones…) con su
catálogo, valores por centro trazables, y que el sistema calcule la cuota =
importe ÷ total base. — *Importa:* hoy no se puede elegir una base del catálogo
ni ver la cuota en el árbol; el número "aparece de la nada" (viola el principio
de Mirta). — *Fix:* tabla `allocation_bases` + valores por centro + selector de
modo por concepto (F3, Parte 4).

**🟢 OK** `indirect-costs.ts:197` `calcPredeterminedQuota` = presupuesto ÷
capacidad normal, separando fija y variable. FX1 (1.323,75 / 1.058,57) y FX3
(2.125 / 1.625) en verde.

**🟢 OK** `indirect-costs.ts:255` `calcVarianceAnalysis` — usa **`actualCip`
(CIP real ingresado)** para la variación presupuesto y `cuota fija × (cap.
normal − actividad real)` para la de volumen. Cumple criterio A.3.f al pie
("la variación usa el CIP real ingresado, nunca el presupuesto distribuido").
FX1 (−129.500 / +29.500) y FX3 (21.500 / 9.750) en verde.

**🟢 OK** `calculate.ts:166` — el **presupuesto del centro productivo se deriva
del prorrateo** (`computeProductiveBudgets`), nunca se tipea a mano. Cumple
criterio A.3 ("jamás carga manual del presupuesto").

### Estado de costos y margen

**🟢 OK** `cost-statement.ts:58` — Costo de producción = MP consumida + MOD +
CIP aplicado; luego CPV, ingreso y margen. Redondeo al final (Decimal.js en
todo el camino, `.toNumber()` solo al exponer). Cumple criterio A.4. FX1
(7.924.863,75 / margen 2.675.136,25). Diferencia de 1 centavo con la spec por
ROUND_HALF_EVEN vs Excel, ya documentada — no es regresión.

**🟡** `calculate.ts:63` — `CalculationOutput` expone números planos además del
árbol `raw`. El front **no** debe recalcular: debe leer el árbol persistido.
Verificar que ningún componente derive costos por su cuenta (ver §4).

---

## 2) TERMINOLOGÍA DEL DOMINIO (criterio C, D)

| Ubicación | Dice | Debería decir | Sev |
|---|---|---|---|
| `DirectLaborForm.tsx:265,278` | "Horas trabajadas" | **Horas presupuestadas** | 🟠 |
| `ValidacionesPage.tsx:846` | "Horas Trabajadas" | **Horas presupuestadas** | 🟠 |
| `cost.schema.ts:77`, `direct-labor.ts:180` | `hoursWorked` | `budgetedHours` | 🟠 |
| Costos Indirectos (tabla productiva) | real y presup. juntos | secciones separadas y etiquetadas "Datos reales (fin de mes)" | 🟠 |
| IAP en Resultado | valor sin fórmula | "IAP = 40 días pagos / 222 efectivos = 18,02%" | 🟡 |
| Período | "Período de costo: {period}" (`CostStructurePage.tsx:142`) | + badge "Captación: continua"; distinguir período de costo vs de captación | 🟡 |

Bien resueltos ya: IAP como derivado read-only (dominio + UI), keys por id de
centro (no por nombre), sobre/subaplicación nombrada en `indirect-costs.ts:222`.

---

## 3) CUMPLIMIENTO R1–R4

**🔴 R1 (nada se pisa)** `cost-structure-service.ts:153` — `updateConfig` hace
`costStructure.update({ data: { rawMaterialConfig|directLaborConfig|
indirectCostConfig } })`: **sobrescribe el JSONB de config en el lugar**. El
valor anterior desaparece. Lo mismo `updateSales:163`. — *Debería:* todo valor
de costo se versiona append-only. — *Importa:* si el costista corrige el precio
de una compra, la versión anterior de la config se pierde; el `DataPoint`
append-only es un store aparte que el motor **no** lee. — *Fix:* o bien el motor
pasa a leer de `DataPoint`s, o se versiona la config (snapshot por cambio) y se
liga al `calculation_run`. (F2 / Parte 2.1.)

**🔴 R2 (auditoría en la misma transacción)** `cost-structure-service.ts:51-59,
110-118, 153-159, 163-172, 200-218` — cada método hace `db.update/create` y
**después** `recordAudit(...)` como statement separado sobre `this.db`, **sin
`$transaction`**. Si la auditoría falla, la mutación ya se confirmó. — *Debería:*
mutación + auditoría en una sola transacción con rollback conjunto. — *Contraste:*
`DataPointService` (trazabilidad nueva) **sí** lo hace bien con `withTenant(tx)`
(`data-point-service.ts:45,101,151`). — *Fix:* envolver las mutaciones legadas
en `$transaction` y registrar dentro (F2).

**🟠 R2 (cobertura)** `cost-structure.routes.ts` — no existe un middleware
`audited()` como pide la spec 2.1; cada servicio llama a `recordAudit` a mano y
las rutas de config escriben al `audit_logs` **legado**, no a `trace_audit_log`.
Resultado: las acciones sobre la fuente de verdad (guardar MP/MOD/CIF) no
aparecen en la bitácora de trazabilidad. — *Fix:* `audited()` o registrar en
`trace_audit_log` desde el servicio (F2).

**🟢 R3 (timestamps de servidor, timestamptz)** — todos los modelos de
trazabilidad usan `@db.Timestamptz` con `@default(now())` (servidor). La UI
convierte a `America/Argentina/Tucuman` en `format.ts`. Correcto. No se detectó
uso de hora de cliente en mutaciones.

**🟢 R4 (nunca 500 crudo)** `error-handler.ts:34` traduce `DomainError` a su
`statusCode`; `UnprocessableEntityError`/`MissingInputError` (422) con
`{code,message,field?}` en `domain-error.ts:58` y `calculation-errors.ts:8`. El
motor de CIF lanza 422 accionable ante insumo faltante. Correcto. Pendiente:
extender a los casos nuevos de base faltante (F3, `MISSING_ALLOCATION_BASE`).

---

## 4) TABLA DE COBERTURA DE TRAZABILIDAD (criterio C, D)

Por cada input que el sistema acepta: área fuente esperada (Depósito D /
Contaduría C / Planta P), si registra quién/cuándo/cómo/desde-dónde, si es
versionado append-only, y si es clickeable a su ficha.

| Input | Área | ¿quién/cuándo/cómo? | ¿versionado? | ¿clickeable? | Gap |
|---|---|---|---|---|---|
| MP · existencia inicial (cant.) | D | parcial (backfill por bloque) | ❌ pisa JSONB | parcial | 🔴 versionar por campo |
| MP · existencia inicial (precio) | C | parcial | ❌ | parcial | 🔴 |
| MP · compra cantidad | D | ✅ si se carga como DataPoint | ✅ (DataPoint) | ✅ | ok en camino nuevo |
| MP · compra precio | C | ✅ (DataPoint) | ✅ | ✅ | ok en camino nuevo |
| MP · consumo cantidad | D | parcial | ❌ | parcial | 🟠 |
| MP · Wilson (R,S,K,C) | P/C | ❌ | ❌ | ❌ | 🟠 sin ficha |
| MOD · remuneración básica | C | ❌ (JSONB) | ❌ | ❌ | 🔴 |
| MOD · horas presupuestadas | P | ❌ | ❌ | ❌ | 🔴 |
| MOD · días (ausentismos) | C/P | ❌ | ❌ | ❌ | 🟠 |
| MOD · coeficientes ITCS | C | ❌ | ❌ | ❌ | 🟠 |
| CIF · concepto importe f/v | C | ❌ | ❌ | ❌ | 🔴 |
| CIF · base de distribución | P/C | **no existe entidad** | ❌ | ❌ | 🔴 Parte 4 |
| CIF · capacidad normal | P | ❌ | ❌ | ❌ | 🟠 |
| CIF · actividad real | P | ❌ | ❌ | ❌ | 🟠 real fin de mes |
| CIF · CIP real | C | ❌ | ❌ | ❌ | 🟠 real fin de mes |
| Venta · precio y cantidad | comercial | ❌ (`updateSales`) | ❌ | ❌ | 🟠 |

**Lectura:** el camino NUEVO (endpoints `/data-points`) cumple todo el contrato
(quién/cuándo/cómo/desde-dónde, versionado, clickeable). El camino LEGADO
(guardar config por sección) **no**: escribe JSONB plano. El `db:backfill`
crea un `DataPoint` por **bloque** (no por campo), así que casi ningún input
individual es hoy versionado + clickeable de punta a punta. **Ese es el gap
central a cerrar en F2/Parte 2** para que se cumpla "ningún número aparece de
la nada" (Mirta).

---

## 5) LOS CINCO ERRORES DEL 10/07 (confirmados con archivo:línea)

- **(a) "Horas trabajadas" donde va "Horas presupuestadas"** — CONFIRMADO:
  `DirectLaborForm.tsx:265` (encabezado), `:278` (celda),
  `ValidacionesPage.tsx:846`. Raíz en dominio: `hoursWorked` (`cost.schema.ts:77`,
  `direct-labor.ts:180`). 🟠
- **(b) Real y presupuestado mezclados sin separación** — CONFIRMADO:
  `IndirectCostsForm.tsx:451-489` mete "Cap. normal", "Actividad real (hs)" y
  "CIP real $" en la misma tabla, junto al presupuesto derivado. Falta bloque
  rotulado "Datos reales (fin de mes)". 🟠
- **(c) Base de distribución no configurable → prorrateo secundario no
  calculable** — CONFIRMADO: no hay entidad de base; `secondaryProration`
  (`indirect-costs.ts:120`) es pasada directa sin orden de cierre;
  `serviceDistributions` (`cost.schema.ts:108`) son unidades crudas. 🔴
- **(d) Período como configuración externa** — PARCIAL: la estructura ya tiene
  `period` y se muestra (`CostStructurePage.tsx:142`). Falta el badge explícito
  "Período de costo / Captación: continua" y separar el período de costo del de
  captación (criterio C). 🟡
- **(e) Líneas visuales sobrantes color bordó en Costos Indirectos** — A
  CONFIRMAR VISUALMENTE: los `focus:border-granate` son tema de marca
  (correctos). Candidatos a "sobrante": separadores `border-t border-line`
  duplicados en las subtablas de primario/secundario
  (`IndirectCostsForm.tsx:372-373`) y `divide-y` combinados con `border` del
  contenedor, que producen líneas dobles. Se ajusta en F6. 🟡

---

## 6) SEPARACIÓN REAL / PRESUPUESTADO POR VISTA (criterio C)

| Vista | Estado |
|---|---|
| Materia Prima | 🟢 solo datos de ficha (no hay "real vs presup" acá) |
| MOD | 🟠 "horas trabajadas" sugiere real, pero es presupuesto; sin bloque real de fin de mes |
| Costos Indirectos | 🟠 real (actividad/CIP) y presupuesto en la misma tabla |
| Resultado | 🟢 muestra aplicado vs real en variaciones, bien etiquetado |
| Validaciones | 🟡 sin comparativo contra período anterior (criterio C: un dato solo no valida) |

---

## ESTADO DE "TRAZABILIDAD TOTAL v1" (Paso 0)

| Pieza | Estado | Evidencia |
|---|---|---|
| Tablas `data_points` / `data_point_versions` | ✅ IMPLEMENTADO | `schema.prisma:629,656` |
| `evidence` / `trace_audit_log` | ✅ IMPLEMENTADO | `schema.prisma:679,698` |
| `calculation_runs` / `calculation_nodes` | ✅ IMPLEMENTADO | `schema.prisma:720,741` |
| Trigger append-only (BEFORE UPDATE/DELETE) | ✅ IMPLEMENTADO | migración `..._add_trazabilidad_total_v1` |
| Middleware `audited()` en toda ruta mutante | ⚠️ PARCIAL / CONTRADICE | trazabilidad usa `withTenant`+audit; legado escribe fuera de tx (§3) |
| Motor emitiendo árbol persistido + `engine_version` | ✅ IMPLEMENTADO | `calculation-run-service.ts`, `tree-builder.ts`, `ENGINE_VERSION` |
| Endpoints `/calculate` `/tree` `/runs` `/trace` `/audit` `/versions` `/validate` `/imputacion` | ✅ IMPLEMENTADO | `trazabilidad.routes.ts:35-134` |
| Doble período (hecho/captación/imputado) + modal | ✅ IMPLEMENTADO | `schema.prisma:639-641`, `ImputacionModal.tsx` |
| Estados borrador/validado/aplicado + firma | ✅ IMPLEMENTADO | `data-point-service.ts:145` |
| `TraceCard` (drill-down in-place) | ✅ IMPLEMENTADO | `DerivationTree.tsx` |
| Migración de datos viejos (`actor_role='desconocido (migrado)'`) | ✅ IMPLEMENTADO | `scripts/backfill-trazabilidad.mjs` |
| **Fuente de verdad append-only (config del motor)** | ❌ CONTRADICE LA SPEC | `updateConfig` pisa JSONB (§3, R1) |
| **Cada input versionado + clickeable de punta a punta** | ⚠️ PARCIAL | backfill por bloque, no por campo (§4) |
| **Ver dato / Ver cálculo en pestaña nueva** | ❌ AUSENTE | no hay ruta `/trazabilidad/dato/:id` |
| **Base de asignación como entidad** | ❌ AUSENTE | Parte 4 |
| **Prorrateo secundario escalonado** | ❌ AUSENTE | pasada directa (§1) |

---

## PLAN DE FASES (orden de ejecución)

- **F0 ✅** Diagnóstico + FX3 caracterización (203 verdes). *(hecho)*
- **F1 ✅** Este informe. *(hecho)*
- **F2** Cerrar gaps de trazabilidad v1: versionar la fuente de verdad
  (append-only real), auditoría legada en transacción (R2), ficha del dato
  completa. Fixtures verdes.
- **F3** Bases de asignación (Parte 4) + prorrateo **escalonado** con orden de
  cierre + **FX4** en verde, sin romper FX1/FX3 (modo %). *Va antes que la
  navegación porque desbloquea el cálculo.*
- **F4** Navegación lista→detalle por elemento (MP/MOD/CIF), breadcrumb, filtro
  de período, números clickeables.
- **F5** Pestaña nueva de trazabilidad (`/trazabilidad/dato/:id`,
  `/calculo/:runId`) con selector de período, formato comprobante imprimible.
- **F6** Correcciones puntuales: horas presupuestadas, datos reales separados,
  período como badge, IAP con fórmula, bordó, comparativo período anterior, y
  todo 🔴/🟠 restante.
- **F7** Verificación final: suite + FX1–FX4 + lint/typecheck/build + recorrido
  de usuario documentado.

> Limitación del entorno (documentada en `DECISIONES.md`): esta máquina no
> tiene Postgres/Redis, así que las migraciones y endpoints se validan con
> `prisma validate`/typecheck/tests puros, pero no se ejecutan contra una DB
> real. Los pasos exactos para que el equipo lo corra en local van al final del
> resumen de sesión.
