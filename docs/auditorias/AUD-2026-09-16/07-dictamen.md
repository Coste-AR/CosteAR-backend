# Dictamen de auditoría — AUD-2026-09-16

## 1. Alcance

- **Repo y rama:** backend `auditoria/AUD-2026-09-14` (local, un commit adelante de
  `origin/staging` al cierre de F0) · frontend `auditoria/AUD-2026-09-14` @ `b0e7b5f` (=
  `origin/staging`).
- **Continuación dirigida** de `AUD-2026-09-14` (ADVERSA) y `AUD-2026-09-15` (ADVERSA). No es una
  auditoría de 7 fases completa: responde cinco bloques puntuales. El marcador de reglas duras no
  se recalculó esta sesión (sigue el de `AUD-2026-09-14`, 13/35 evaluadas).
- **Qué se hizo:** los cinco bloques pedidos, corridos en cola sin frenar. Cuatro de los cinco
  produjeron reproducción en vivo (API real, y en el caso de BLOQUE 3, navegador real); BLOQUE 2 se
  resolvió por lectura de código porque el hallazgo es la AUSENCIA de un camino de datos, no un
  comportamiento que se pueda "cargar y ver fallar".
- **Qué quedó fuera:** Granja→Fraccionadora (huevo→cajón) sigue bloqueada por `04a`, no se tocó.
  El marcador R1-R35 no se recorrió de nuevo. La reproducción de AUD-05 original (el resolver de
  clasificación, no el tablero) no se re-verificó en vivo esta sesión — se usa la de
  `AUD-2026-09-14`, y se agrega contexto nuevo sobre dónde SÍ y dónde NO se propaga.
- **Entorno:** local, `localhost:3000` (backend), `localhost:5173` (frontend), Postgres real
  `localhost:5433`. Registro real por API/browser en todos los casos, con una excepción declarada
  (siembra directa de `UnidadMedida`, sin endpoint — ver hallazgo 08).

## 2. Resultado de los cinco bloques

### BLOQUE 1 — P-06 (conjuntos por tamaño)

**No está bloqueado por `04a`.** Confirmado por lectura de código y en vivo:
`JointCostService.resolveContext` (`src/application/cost-structures/process-costing/joint-cost-service.ts:246-275`)
solo exige un `ProcessDepartment` y un `CostPeriod` válidos — nunca toca
`ProcessDepartment.conversionFromPrevious` ni `UnitMovementSchedule`. Se armó una estructura
`PROCESSES` con un único departamento (secuencia 1, sin conversión) y se corrieron los cuatro
métodos.

**a) Los cuatro métodos existen y dan distinto — verificado en vivo, exacto contra las anclas que
ya vivían como comentario en el propio dominio** (`src/domain/calculations/joint-costs.ts:247-318`,
nunca antes ejercitadas por ningún test ni ninguna auditoría — `grep` de
`allocateJointCosts\|allocateBy*` sobre `*.spec.ts`/`*.test.ts`: cero resultados):

| Método | A | B | C | Total asignado |
|---|---:|---:|---:|---:|
| PHYSICAL_UNITS (jointCost $570.000) | $60,00/kg ($150.000) | $60,00/kg ($180.000) | $60,00/kg ($240.000) | $570.000 ✓ |
| TECHNICAL_YIELD (jointCost $1.150.000, Jugo/Aceite/Cáscara) | 52,17 % | 4,35 % | 43,48 % | $1.150.000 ✓ |
| MARKET_VALUE (jointCost $570.000) | $40,00/kg ($100.000) | $56,67/kg ($170.000) | $75,00/kg ($300.000) | $570.000 ✓ |
| NET_REALIZABLE_VALUE (jointCost $110.000) | $85,96/kg ($17.191,32) | $115,63/kg ($34.688,54) | $145,30/kg ($58.120,13) | $110.000 ✓ |

Reproducible: `evidencia/bloque1-joint-costs.mjs` / `evidencia/bloque1-output.log`.

**b) La barrera de decisión (R15) — no se encontró ninguna violación, pero tampoco protección
activa: simplemente no hay ninguna pantalla de "rentabilidad por tamaño".** `JointCostsTab.tsx` es
la única vista que consume `allocatedCost`/`unitCost` en todo el frontend; no alimenta ningún
simulador, alerta ni tablero. R15 se sostiene hoy por ausencia de feature, no por diseño explícito.

**c) El descarte (R16) — CRÍTICO, irrealizable con el schema actual.** `marketPrice` está declarado
`z.number().finite().nonnegative()` (`src/shared/schemas/joint-cost.schema.ts:30,44`). Probado en
vivo: `marketPrice: -1500` → `400 VALIDATION_ERROR "Number must be greater than or equal to 0"`.
El propio comentario del dominio (`joint-costs.ts:244-246`) documenta que el desperdicio "no se
incluye en `products`, así que no participa del reparto" — es decir, el ÚNICO camino que el motor
ofrece hoy para tratar tamaños 0 y 4 es EXCLUIRLOS (tratarlos como merma gratuita), exactamente lo
que R16 prohíbe ("no merma de unidades"). Ver ficha `AUD-2026-09-16-01`.

**Hallazgo nuevo — el badge "en pérdida" del frontend da falso positivo, reproducido en vivo.**
`JointCostsTab.tsx:471`: `enPerdida = l.allocationBase > 0 && l.allocatedCost > l.allocationBase`.
Compara PESOS asignados contra `allocationBase`, que **NO es pesos en tres de los cuatro métodos**
(es unidades en PHYSICAL_UNITS, rendimiento en TECHNICAL_YIELD). Medido en vivo con los datos del
método 1: los tres productos (A, B, C) mostraron `enPerdida: true` — comparando $150.000 contra
2.500 unidades, $180.000 contra 3.000, $240.000 contra 4.000 — **siempre `true`, para cualquier
costo conjunto con más de unas pocas unidades**, sin que exista ningún concepto de pérdida real en
ese método (no hay precio de mercado cargado). El backend YA calcula correctamente `marketValue` /
`margin` / `isLoss` (`joint-cost-service.ts:352-368`, exactamente la doctrina FX-J2 "mostrar la
pérdida, nunca ocultarla"), pero el tipo del frontend (`JointCostLine`,
`process-costing-types.ts:194-202`) ni siquiera declara esos campos — se descartan en el borde de
red. Ver ficha `AUD-2026-09-16-02`.

### BLOQUE 2 — Corrimiento de mix

**El sistema no puede detectarlo porque no hay ningún dato de mix que alimente el punto de
equilibrio — no es una falla de presentación, es una ausencia de modelo.**

- `sales.salesUnitPrice`/`salesQuantity` (`src/shared/schemas/cost.schema.ts:475,477`) es un
  **escalar único** por período. No existe ningún campo de "líneas de venta por tamaño" que
  alimente la capa marginal.
- Existe `VentaProducto` (`prisma`, con campo `variante`) y un servicio
  (`src/application/operacion/venta-producto-service.ts`) que calcula un precio promedio ponderado
  real a partir de ventas individuales — pero **agrupa solo por `canal`, nunca por `variante`**
  (`resumen()`, líneas 68-86: el único `groupBy` implícito es `canales`). Ni siquiera leyendo ese
  reporte a mano un costista vería "cambió el mix de tamaños".
- Ese servicio **no está conectado a nada**: `precioPromedioVenta` en el tablero del dueño sale de
  `contribucion?.precioUnitario` (el escalar tipeado a mano,
  `owner-dashboard-service.ts:229`), nunca de `VentaProductoService.precioPromedio()`. Y el
  frontend no llama a ese endpoint en ningún lado (`grep` de `ventaProducto`/`precioPromedio` sobre
  `src/features/`: cero resultados reales — los dos hits previos eran falsos positivos de
  substring con `precioPromedioVenta`).

**Conclusión:** más allá de que `period-comparison` no lo cuente (ya confirmado en
`AUD-2026-09-15-04`), **no existe ningún lugar del producto — pantalla, alerta o endpoint
conectado — que pueda enterarse de un corrimiento de mix**, porque el dato de origen (ventas por
tamaño) nunca llega al motor de costos. Ver ficha `AUD-2026-09-16-03`.

### BLOQUE 3 — PE contra el techo del tramo, en pantalla

**Nunca se había visto con un caso real, ni podía: no hay `UnidadMedida` sin acceso directo a la
base** (ver hallazgo 08). Con ese workaround declarado, se armó una estructura ORDERS con los
números de M3 (`fixtures-avicola.md §6`: cajones 825, precio $47.960, cv $25.896,32, CF
$24.430.000) y se capturó el tablero real.

**PE = 1.107,25 cajones, mostrado como número suelto — sin techo, sin capacidad instalada, sin
alerta.** Capturas: `capturas/bloque3-m3-tablero-sin-techo.jpg`. La tarjeta "Producido contra
equilibrio" compara **producido (825) contra equilibrio (1.107,25)**, no equilibrio contra
capacidad — son dos comparaciones distintas y el tablero solo tiene la primera. "Alertas activas"
dice "Sin datos" pese a que el período pierde $6,2M y el equilibrio es matemáticamente
inalcanzable. No hay ninguna tarjeta de "margen de seguridad" en todo el tablero.

**Confirmado por código, no solo por la captura:** `grep` de `techo\|margenSeguridad\|capacidad\|tramo`
sobre `owner-dashboard.schema.ts` y sobre `src/domain/calculations/` + `src/application/cost-structures/`:
**cero resultados** fuera de subsistemas no relacionados (clasificador, vault). R29 no está
implementado en ningún nivel — ni dominio, ni API, ni pantalla. Ver ficha `AUD-2026-09-16-04`.

**El conversor divide por precio, reproducido en vivo, en esta misma captura.** Con
`$1.000.000` cargado: **"20,85 cajones"**, con el rótulo explícito **"Precio usado: $47.960,00 por
cajón"**. El valor correcto sería $1.000.000 ÷ $22.063,68 (cm) = 45,32 cajones — coincide con el
"correcto" del fixture (45,3) contra el "incorrecto" (20,9). Es el error vivo n.º 1, **sigue
presente**, y su ubicación exacta está en el BLOQUE 5.D. Captura:
`capturas/bloque3-conversor-divide-por-precio.jpg`.

### BLOQUE 4 — Magnitud de AUD-05

Se armó una estructura ORDERS con MP/MOD/CIF en tres categorías separadas ($15.000.000 /
$2.000.000 / $16.000.000 — exactamente los tres claves de clasificación que existen,
`calculation-result-enrichment.ts:118-134`), para poder mover EXACTAMENTE $2.000.000 de FIJO a
VARIABLE sin arrastrar nada más.

**El mecanismo cierra exacto contra la fórmula y contra el fixture, medido en vivo con
`unidadGestion` real:**

| | ANTES (MOD=FIJO) | DESPUÉS (MOD=VARIABLE, recálculo real) | Esperado (fixture §10/§13) |
|---|---:|---:|---:|
| cv | $20.000,00 | (no se pudo recalcular vía dashboard — ver abajo) | $20.000,00 → $22.666,67 |
| cm | $30.000,00 | ídem | $30.000,00 → $27.333,33 |
| PE | 600,0 | ídem | 600,0 → 585,4 |
| conversor $1M | 33,33 cajones | ídem | 33,3 → 36,6 |
| resultadoPeriodo | **$4.500.000** | **$4.500.000** (sin cambios, en las tres mediciones) | (no varía — absorción, no depende de la clasificación) |

**RESULTADO INFORMADO DEL PERÍODO CONFIRMADO QUE NO SE MUEVE** — medido tres veces (antes,
reclasificado sin recalcular, y después de recalcular): siempre $4.500.000. Es una propiedad
NECESARIA del número (absorción: `precio×unidades − costo total`, y el costo total no cambia
al reetiquetar fijo/variable), no un bug — pero es exactamente lo que hace al defecto invisible:
nadie que solo mire "Resultado del período" se entera de que la vista de gestión (cm/PE) cambió
por debajo. Reproducible: `evidencia/bloque4-*.mjs` y sus `.log`.

**Hallazgo nuevo — la magnitud completa (columna "DESPUÉS") no se pudo medir vía el tablero del
dueño para `ORDERS`, y la razón es una protección que SÍ funciona:** el único mecanismo que
regenera el `CalculationRun` que lee el tablero (`recalculateVariableView`,
`cost-structure-service.ts:331-341`) se dispara como efecto secundario de volver a guardar una
sección (`raw-material`/`direct-labor`/`indirect-costs`/`sales`) — y **esas escrituras están
bloqueadas en un período `CLOSED`** por `requireWritablePeriod`
(`src/application/cost-structures/period-sync.ts:64`, mensaje verificado en vivo: *"El período...
está cerrado: los números quedaron congelados y no se pueden editar"*). Para `ORDERS`, entonces,
**el tablero del dueño NO es vulnerable a AUD-05 después de cerrar**, porque no hay forma de
regenerarlo. Esto **acota** (no invalida) el hallazgo original: `AUD-2026-09-14-05` se reprodujo
contra `GET /companies/:companyId/parametros-costeo/:clave?periodId=X` (el resolver de
clasificación en crudo), un endpoint DISTINTO del tablero, que sí resuelve en vivo sin ninguna
protección. Si ese resolver alimenta alguna pantalla que un costista mire para un período cerrado,
el defecto sigue vivo ahí — **no verificado esta sesión, queda como pregunta abierta para el
issue**. Y por el lado de `PROCESSES`: `process-calculation-service.ts` no tiene ningún guard de
período cerrado (ni en el movimiento, ya confirmado en `AUD-2026-09-15-02`, ni en el cálculo) —
así que la vulnerabilidad real del tablero a AUD-05 probablemente vive del lado de `PROCESSES`, no
de `ORDERS`. Ver ficha `AUD-2026-09-16-05`.

### BLOQUE 5 — Insumos para los issues

Ver sección 4 (INSUMOS PARA ISSUES) más abajo — están resueltos con precisión quirúrgica ahí para
no duplicar.

## 3. Hallazgos nuevos de esta sesión

### 🔴 CRÍTICOS (3 nuevos)

#### AUD-2026-09-16-01 · R16 (descarte) es irrealizable: el schema prohíbe un coproducto de precio negativo
**Dónde:** `src/shared/schemas/joint-cost.schema.ts:30,44` (`marketPrice: amount.optional()`, con
`amount = z.number().finite().nonnegative()`). **Verificado en vivo:** `marketPrice: -1500` → `400`.
**Qué debería hacer:** permitir `marketPrice` negativo para líneas `kind: 'waste'` con costo de
eliminación, o modelar el costo de eliminación como un campo aparte que se reste del reparto de esa
línea. **Magnitud:** el 100% de los descartes por tamaño del rubro avícola (tamaños 0 y 4) no
tienen forma correcta de cargarse — solo excluirse, que es lo que la propia doctrina R16 prohíbe.

#### AUD-2026-09-16-02 · El badge "en pérdida" de conjuntos da falso positivo — comparación dimensionalmente inválida
**Dónde:** `Costear.web/CosteAR-frontend/src/features/cost-structures/components/process/JointCostsTab.tsx:471`.
**Verificado en vivo:** con PHYSICAL_UNITS, los 3 productos (A/B/C) mostraron `enPerdida: true`
comparando pesos asignados contra unidades físicas. **Magnitud:** falso positivo garantizado para
CUALQUIER carga de PHYSICAL_UNITS o TECHNICAL_YIELD con costo conjunto de más de unos pocos pesos —
es decir, dos de los cuatro métodos. **Camino de remediación:** consumir `marketValue`/`isLoss` que
el backend ya envía (`joint-cost-service.ts:352-368`); agregar esos campos a `JointCostLine`
(`process-costing-types.ts:194-202`).

#### AUD-2026-09-16-04 · R29 (PE contra el techo del tramo) no existe en ningún nivel del producto
**Dónde:** ausencia confirmada en `src/shared/schemas/owner-dashboard.schema.ts` (cero campos de
techo/capacidad/tramo) y en `src/domain/calculations/` + `src/application/cost-structures/` (cero
código). **Verificado en vivo:** captura con PE=1.107,25 cajones fuera de la capacidad real (972,3
del fixture), mostrado sin ningún contexto de capacidad, alerta en "Sin datos". **Magnitud:** el
100% de los períodos cuyo PE cae fuera de la capacidad instalada muestran un número
"aritméticamente correcto y operativamente inalcanzable" sin ningún aviso — exactamente el modo de
falla que la doctrina (`AM17 §5.1`) señala como el más peligroso.

### 🟠 GRAVE (2 nuevos)

#### AUD-2026-09-16-03 · No existe ningún camino de datos de "mix por tamaño" hacia el punto de equilibrio
`sales.salesUnitPrice` es un escalar; `VentaProducto` captura `variante` pero su agregación
(`venta-producto-service.ts:68-86`) solo agrupa por canal, y ese servicio no está conectado a
ninguna pantalla ni al motor de costos. **Camino de remediación:** o se conecta `VentaProducto`
(agrupando también por `variante`) al cálculo de `salesUnitPrice`, o se documenta explícitamente
que el mix se gestiona fuera del producto — hoy no hay ninguna de las dos cosas.

#### AUD-2026-09-16-05 · AUD-05 acotado: el tablero de ORDERS está protegido post-cierre; el resolver de clasificación y PROCESSES no
Ver detalle en BLOQUE 4 arriba. **Camino de remediación:** verificar si
`GET /companies/:companyId/parametros-costeo/:clave?periodId=X` alimenta alguna pantalla visible
para períodos cerrados (si no, el riesgo real es menor al asumido); y extender a
`process-calculation-service.ts` el mismo guard `requireWritablePeriod` que ya protege a `ORDERS`.

### 🟡 OBSERVACIÓN (1 nueva)

#### AUD-2026-09-16-08 · No existe ningún endpoint HTTP para crear `UnidadMedida`
`grep` exhaustivo de `unidadMedida.create` sobre todo `src/`: cero resultados. Los cuatro
consumidores (`company-service.ts`, `deposito-service.ts`, `venta-producto-service.ts`,
`parametros-costeo-service.ts`) solo hacen `findFirst`. El único `.create` de todo el repo vive en
`prisma/seed-tenant-avicola.ts` (un script de siembra) y en `PUT /companies/:id`, que acepta
`unidadGestionId` pero apunta a una fila que un usuario real **nunca puede crear**. **Por qué
importa:** sin `unidadGestion`, el tablero del dueño completo (costo por cajón, cm, PE, conversor,
"producido cajones") queda permanentemente `incompleta: true` — no por falta de carga, sino porque
no hay forma de cargarlo. Confirma por qué `AUD-2026-09-15` también declaró esto "no reproducible".
**No se eleva a GRAVE/CRÍTICO** porque no se verificó si existe otro flujo (alta de empresa vía
"paquete de rubro", onboarding) que la cree indirectamente — declarado como límite de esta
verificación, no como hallazgo cerrado.

## 4. INSUMOS PARA ISSUES

### A · `04a` — ¿DÓNDE exactamente falla?

**Falla en el MOMENTO 3 exclusivamente: al calcular/cerrar el período. Nunca en el momento 1
(configurar) ni en el momento 2 (cargar el movimiento).**

- **Momento 1 — configurar el departamento con el factor:** `POST /structures/:id/process-setup`
  con `conversionFromPrevious: 1/360` → **200 OK, sin error.** El valor se guarda TRUNCADO/redondeado
  a `Decimal(18,6)` en silencio (`0.002778`, no `0.002777...`). `prisma/schema.prisma:1749`.
- **Momento 2 — cargar el movimiento de unidades:** `PUT .../movement` con
  `receivedFromPrevious: 750` → **200 OK, sin error.** Este endpoint NO cruza-valida contra el
  departamento anterior (confirmado también para el caso `normalLossPct`, ver punto B — la
  cross-validación de *conversión entre departamentos* específicamente no corre acá en absoluto).
- **Momento 3 — calcular el período: acá y solo acá falla.** `POST /structures/:id/process/periods/:periodId/calculate`
  → **422 MISSING_INPUT.**
  - **Archivo:línea del throw:** `src/application/cost-structures/validate-inputs.ts:296`
    (`if (Math.abs(diferencia) > 1e-4)`), dentro del bloque `H12` (líneas 289-308).
  - **Archivo:línea del call site:** `src/application/cost-structures/process-costing/process-calculation-service.ts:240`
    (`validateProcessInputs(...)`, importado de `../validate-inputs.js:15`).
  - **Payload exacto que dispara el 422:**
    ```
    POST /structures/:id/process-setup
      { departments: [..., { name:'Fraccionadora', sequence:2, unit:'cajon', conversionFromPrevious: 1/360 }] }
    GET /structures/:id/process-setup   →  conversionFromPrevious guardado: 0.002778
    PUT .../Fraccionadora/periods/:id/movement { receivedFromPrevious: 750, ... }  →  200 OK
    POST .../periods/:id/calculate
    → 422 MISSING_INPUT
    "«Granja» transfirió 270000 unidades pero en «Fraccionadora» cargaste que recibió 750.
     Se esperaban 750.0600000000001 (270000 × factor 0.002778 = 750.0600000000001).
     Faltan 0.06000000000005912 unidades..."
    ```
  (Re-verificado esta sesión contra el código actual — mismas líneas que documentó
  `AUD-2026-09-14-04a`, sin drift.)

### B · `normalLossPct` — el disparador real, medido en vivo con 6 casos controlados

**Confirmado: NO es "un número no redondo".** `2,5%` se representa perfecto en `Decimal(9,4)`
(`0,0250`). Probado en vivo (`evidencia/bloque5b-normallosspct-disparador.mjs`):

| Caso | normalLossPct | PUT movement | POST calculate |
|---|---|---:|---:|
| A — tipeado 2,5% | `0.025` | 200 | 200 OK |
| B — tipeado 3% | `0.03` | 200 | 200 OK |
| D — derivado 13/1556 | `0.008354755784061696` | 200 (guardado: `0.0084`) | **422** — `extraordinaryLoss: -0.0704` |
| E — derivado 17/825 | `0.020606060606060607` | **422** | (no llegó) — `extraordinaryLoss: -7.75e-16` |
| F — derivado 7/333 | `0.021021021021021023` | **422** | (no llegó) |

**El disparador real: el porcentaje se DERIVA de un conteo físico (unidades perdidas ÷ unidades del
período) — así es como se mide en la realidad — y eso dispara el defecto en uno de DOS lugares
distintos, con DOS causas técnicas distintas, de forma impredecible para el costista:**

1. **En el `PUT` mismo**, cuando el ruido de punto flotante IEEE-754 hace que el cálculo sobre el
   valor CRUDO (sin redondear todavía) dé un `extraordinaryLoss` negativo por una magnitud
   infinitesimal (`-7,75e-16` en el caso E, matemáticamente cero). Camino:
   `buildUnitMovementSchedule` (`unit-movement-service.ts:456`) → `calcNormalAndExtraordinaryLosses`
   (`src/domain/calculations/process-costing.ts:206-243`, el `throw` en la línea 226-232).
2. **En el `calculate`**, cuando Postgres YA redondeó el valor a 4 decimales al guardarlo, y ese
   redondeo hacia arriba empuja `normalLoss` por encima del `totalLossReported` real (caso D: guarda
   `0,0084` en vez de `0,00835475...`, y `1556 × 0,0084 = 13,0704 > 13`). Mismo `throw`, pero
   corriendo sobre el valor YA PERSISTIDO, no el que se tipeó.

**Con esas palabras:** el defecto se dispara cuando el porcentaje se deriva de una cuenta de
unidades, y golpea al costista en el `PUT` (con un mensaje que cita un número casi-cero e ilegible)
o en el `calculate` (con un número claramente distinto de cero), según pura casualidad de en qué
dígito decimal cae el resto de la división. No hay forma de que un costista prediga cuál de las dos
le va a tocar.

### C · El barrido de decimales — conteo por riesgo

Ya está hecho de punta a punta en `docs/auditorias/AUD-2026-09-15/08-barrido-decimales.md`: **12
campos catalogados + 1 comodín** (`ParametroCosteo.valorNum`, clave-valor genérico sin distinción
de tipo). De los 12: **2 bloquean con error duro** (`conversionFromPrevious`, `normalLossPct`), **4
contaminan en silencio** (los cuatro `*Avance` de WIP, `sellingCostVarPct`, `yieldPct`, `factor` de
`UnidadMedida`), y **6 sin riesgo práctico** (umbrales de alerta, resultados calculados, datos ya
redondeados en origen). No se volvió a barrer esta sesión — el documento de origen ya es
exhaustivo y su fecha (15-09) es reciente.

### D · El conversor — archivo:línea, y confirmación de que el arreglo es solo frontend

**Archivo:línea de la fórmula incorrecta:**
`Costear.web/CosteAR-frontend/src/features/owner-dashboard/OwnerDashboardPage.tsx:586`:
```tsx
<MoneyToUnitConverter
  precio={data?.precioPromedioVenta}   {/* debería ser data?.contribucionMarginalPorCajon */}
  periodo={data?.periodo.codigo}
  unidad={data?.unidadGestion}
/>
```
La división en sí (`cantidad = importeNumero / precio.valor`) está en el mismo archivo, línea 341,
y es genérica — no hace falta tocarla, solo lo que se le pasa como `precio`.

**Confirmado: el arreglo es 100% frontend, sin schema, sin migración, sin backend.** El campo
correcto (`contribucionMarginalPorCajon`) **ya viaja en la misma respuesta** que consume este
componente — se verificó en el JSON real de `GET /periods/:id/tablero-dueno` en esta misma sesión
(`contribucionMarginalPorCajon: { valor: 22063.68, ... }`, junto a `precioPromedioVenta` en el
mismo payload). Es un cambio de una línea (más, idealmente, el rótulo — "esto te cuesta N cajones
de venta adicional" en vez de "equivale a", que también es puramente de copy). **Puede salir solo y
antes** de cualquier otro arreglo de esta lista.

## 5. Lo que se verificó y está bien

- Los cuatro métodos de reparto de costos conjuntos (P-06) son aritméticamente correctos, exactos
  contra sus propias anclas de dominio, y el servicio los orquesta con trazabilidad
  (`DataPointService`) y bitácora en la misma transacción — nunca antes ejercitado, y pasa limpio.
- El período `CLOSED` de una estructura `ORDERS` **sí está protegido** contra el mecanismo que
  regenera el tablero del dueño (`requireWritablePeriod`, verificado en vivo con el mensaje real).
  Este es el primer caso, en tres auditorías, donde una protección de período cerrado funciona como
  se espera.
- `resultadoPeriodo` (la vista de absorción) es estructuralmente inmune a la reclasificación
  fijo/variable, que es la propiedad matemática correcta — confirmado, no solo asumido.
- El fixture (`calc_fx_av.py`) sigue cerrando 36/36 sin cambios.

## 6. Limitaciones

- No se recorrió el marcador R1-R35 de nuevo.
- No se verificó si `GET /companies/:companyId/parametros-costeo/:clave?periodId=X` alimenta
  alguna pantalla real para períodos cerrados — queda como la pregunta abierta más importante para
  cerrar AUD-05 con precisión.
- No se probó si `process-calculation-service.ts` (PROCESSES) efectivamente reproduce AUD-05 en el
  tablero — se infirió por ausencia de guard, no se cargó un caso completo (bloqueado en la
  práctica por `04a` para el rubro avícola real; un caso FX-AV-B kg→bolsa sería el camino, no se
  hizo por presupuesto de esta tanda).
- La creación de `UnidadMedida` vía Prisma directo (hallazgo 08) es un workaround: no se investigó
  si el alta de empresa vía "paquete de rubro" la crea por otro camino.
- `resultadoPeriodo` no se pudo medir en el estado "DESPUÉS de recalcular con clasificación nueva"
  para el escenario BLOQUE 4 a escala completa del fixture — el hallazgo de que ORDERS bloquea el
  recálculo post-cierre se descubrió En el camino y se documentó, pero no se forzó un rodeo (reabrir
  el período) porque eso habría sido un mecanismo distinto al que pidió el bloque.

## 7. Reproducibilidad

- Fixture: `.claude/skills/costear-auditoria/scripts/calc_fx_av.py --assert` → OK, 36 cuadres.
- Scripts y logs: `evidencia/` (siete `.mjs` + sus `.log` de salida completa).
- Capturas: `capturas/bloque3-m3-tablero-sin-techo.jpg`,
  `capturas/bloque3-conversor-divide-por-precio.jpg`.
