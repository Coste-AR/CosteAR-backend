# Continuación corta — AUD-2026-09-16 — cierre de las dos preguntas abiertas

> Complementa `07-dictamen.md`, no lo reemplaza (DOM-01: se agrega, no se saca). Todo lo que sigue
> es verificación NUEVA de esta sub-sesión, con evidencia en vivo.

## 1.a · ¿El resolver de clasificación alimenta alguna pantalla?

**SÍ.** `GET/PUT /companies/:companyId/parametros-costeo/:clave` alimenta
`CostBehaviorClassificationTab.tsx` (la pestaña **"Fijo / variable"** de la empresa — la misma que
aparece en la barra de tabs de la ficha de cliente, visible en la captura de `BLOQUE 3`). Es la
pantalla donde el costista confirma MP/MOD/CIF como Variable/Fijo/Semifijo
(`src/features/companies/cost-behavior-hooks.ts:37-50`, componente en
`src/features/companies/components/CostBehaviorClassificationTab.tsx`).

**Pero: esa pantalla NUNCA pasa `periodId`.** `grep` exhaustivo de `parametros-costeo` sobre TODO
`src/` del frontend (`cost-behavior-hooks.ts` y `cost-parameters-hooks.ts`, únicos consumidores):
**cero llamados con `periodId` en la querystring.** Las dos hooks (`useCostBehaviorClassifications`,
`useConfirmCostBehavior`) llaman siempre `/companies/${companyId}/parametros-costeo/${key}` a
secas.

**Conclusión — el alcance visible de AUD-05 es INDIRECTO, no directo:**

- No existe ninguna pantalla donde un costista pueda preguntar "¿qué clasificación tenía el
  período M1 (cerrado) cuando se cerró?" y ver el valor vigente en su lugar — porque no existe
  ninguna pantalla que muestre clasificación *por período* en absoluto. La pestaña "Fijo/variable"
  siempre muestra y edita el valor **de la empresa, ahora mismo**, sin importar qué período esté
  seleccionado en otro lado de la app.
- El daño real ocurre un paso más allá: alguien cambia la clasificación en esa pestaña (una acción
  legítima y esperada — la clasificación cambia con el tiempo), y **cualquier RECÁLCULO
  posterior de cualquier período que dependa de esa clave** (abierto siempre; cerrado según el
  costingSystem — ver 1.b) absorbe el valor nuevo sin dejar rastro de que estaba resolviendo
  contra el "ahora" y no contra el "cuando se cerró".
- Esto **no invalida** `AUD-2026-09-14-05` (la reproducción original consultó el endpoint
  directamente con `?periodId=X` para demostrar el mecanismo, y eso sigue siendo cierto a nivel de
  API) — pero **acota** su severidad de exposición: nadie ve el número equivocado *etiquetado como
  "esto es lo que M1 tenía"*. Lo ve, sin saberlo, en el tablero del dueño del período cerrado, si
  y solo si ese período llega a recalcularse (ver 1.b).

## 1.b · ¿PROCESSES reproduce AUD-05?

**No llega a plantearse la pregunta: el tablero del dueño NUNCA se puebla para un período de
Costeo por Procesos, con o sin AUD-05, con o sin período cerrado.** Es un hallazgo nuevo y más
severo que la pregunta original.

**Evidencia, verificada en vivo dos veces** (`evidencia/bloque-followup-processes-tablero.mjs` +
comandos de seguimiento, `evidencia/followup-processes-output.log`):

1. Estructura `PROCESSES` completa: 1 departamento, cuadro de movimiento cargado, `calculate` →
   200, período cerrado.
2. `PUT /cost-structures/:id/sales` (precio $50.000, 970 unidades) → **200 OK**, incluso sobre una
   estructura `PROCESSES` (el endpoint no la rechaza).
3. `unidadGestion` configurada (workaround de siembra directa, igual que en BLOQUE 3).
4. `GET tablero-dueno` → `contribucionMarginalPorCajon`, `precioPromedioVenta`, `resultadoPeriodo`
   y `costoPorCajon` **siguen `null`**, con motivo *"Falta cargar ventas del período para obtener
   este indicador"* — **pese a que las ventas SÍ estaban cargadas** un paso antes.
5. Se recalculó explícitamente (`POST /structures/:id/process/periods/:periodId/calculate`, con
   sales y unidadGestion YA puestos) → nueva `CalculationRun` (`e9695eeb...`) → **mismo resultado:
   todos los campos marginales siguen `null`.**

**Causa raíz, confirmada por código:** `ProcessCalculationService.calculate()`
(`src/application/cost-structures/process-costing/process-calculation-service.ts:49-104`) persiste
`results = { ...output, incompletitud }` — el output crudo del motor de Procesos más la marca de
incompletitud — y **nunca llama a `enrichCalculationResult`**
(`src/application/cost-structures/calculation-result-enrichment.ts`), que es la única función que
sabe calcular `contribucionMarginal`/`puntoEquilibrio`/`grossMargin`. Ese enriquecimiento solo
corre desde `CalculationRunService.calculate()`
(`src/application/cost-structures/calculation-run-service.ts:261`), que a su vez **rechaza
explícitamente las estructuras `PROCESSES`** con un 422 (`CostingSystemNotAvailableError`,
`calculation-run-service.ts:193-195`) — es decir, el único camino que sabe enriquecer el resultado
con la capa marginal está bloqueado, por diseño, para el sistema de costeo que audita esta sesión.

**Por qué esto reencuadra la pregunta:** AUD-05 es "un período cerrado resuelve contra la
clasificación vigente en vez de la congelada". Eso presupone que el período **tiene** una
contribución marginal calculada para empezar. Para `PROCESSES`, nunca la tiene — ni abierto, ni
cerrado, ni antes ni después de reclasificar nada. El defecto de AUD-05 (usar clasificación
vigente) es, en este sentido, **irrelevante para Procesos**, pero por la peor razón posible: no
porque esté protegido, sino porque **el número que corrompería nunca llega a existir.**

**Y esto es, en sí mismo, el hallazgo más severo de toda la continuación:** el tablero del dueño —
la pantalla insignia del producto, los "seis números"— es **estructuralmente inutilizable para el
100% de las empresas que usan Costeo por Procesos**, que es el único sistema de costeo que usa el
vertical avícola (el foco exclusivo declarado del producto, y el del cliente piloto). No es un
caso de "falta configurar algo": se probó CON `unidadGestion`, CON `sales` cargado y CON un
recálculo explícito posterior a ambos, y el resultado no cambió. Esto explica, con causa raíz
identificada, por qué ninguna de las tres auditorías de esta serie (`AUD-2026-09-14`,
`AUD-2026-09-15`, `AUD-2026-09-16`) pudo nunca capturar un tablero del dueño real y completo para
una estructura de Procesos — las capturas de `BLOQUE 3` de esta misma sesión usaron una estructura
`ORDERS` como *stand-in* de los números de M3 precisamente por esto, no solo por el bloqueo de
`04a`.

### 🔴 CRÍTICO nuevo — AUD-2026-09-16-09

**Título:** El tablero del dueño no calcula contribución marginal, punto de equilibrio, costo por
cajón ni resultado del período para ninguna estructura de Costeo por Procesos.
**Dónde:** `src/application/cost-structures/process-costing/process-calculation-service.ts:81-93`
(nunca llama a `enrichCalculationResult`) · contraste en
`src/application/cost-structures/calculation-run-service.ts:193-195,261` (Órdenes sí lo llama, y
además rechaza explícitamente a Procesos si se intentara por ese camino).
**Qué hace hoy:** persiste el resultado crudo del motor de departamentos, sin la capa marginal.
**Qué debería hacer:** o `ProcessCalculationService.calculate()` llama también a
`enrichCalculationResult` con las unidades/precio que correspondan a Procesos (posiblemente el
total transferido del último departamento de la cadena), o se documenta explícitamente — en el
producto, no solo en código — que el tablero del dueño no aplica a Procesos y se ofrece otra
pantalla equivalente.
**Magnitud:** 100% de las empresas de Costeo por Procesos — el vertical de foco exclusivo del
producto — no pueden ver contribución marginal, punto de equilibrio, costo por cajón, conversor de
pesos ni resultado del período en el tablero del dueño, bajo ninguna configuración.
**Cómo se reproduce:** `evidencia/bloque-followup-processes-tablero.mjs` +
`evidencia/followup-processes-output.log`.
**Regla/doctrina:** P-08 (contribución marginal y PE), AM5, AM14 — el motor de Procesos completo
del catálogo de pruebas sustantivas asume que esta capa existe.
**Issue/PR de origen:** preexistente, arquitectónico (ausente desde que existe el motor de
Procesos, no introducido por ningún PR reciente identificado en esta sesión).

---

## 2 · INSUMOS PARA ISSUES — reemitido completo, sin ambigüedad

### A · `04a` — ¿DÓNDE exactamente falla?

**Falla en el MOMENTO 3 exclusivamente: al calcular el período. Nunca al configurar el
departamento ni al cargar el movimiento.**

| Momento | Endpoint | Resultado |
|---|---|---|
| 1 · Configurar el departamento con el factor | `POST /structures/:id/process-setup` con `conversionFromPrevious: 1/360` | **200 OK.** Se guarda truncado en silencio a `Decimal(18,6)`: `0.002778` (no `0.002777...`). `prisma/schema.prisma:1749`. |
| 2 · Cargar el movimiento de unidades | `PUT /structures/:id/process/departments/:deptId/periods/:periodId/movement` con `receivedFromPrevious: 750` | **200 OK.** Este endpoint no cruza-valida contra el departamento anterior en absoluto. |
| 3 · Calcular el período | `POST /structures/:id/process/periods/:periodId/calculate` | **422 MISSING_INPUT — acá y solo acá.** |

- **Archivo:línea del `throw`:** `src/application/cost-structures/validate-inputs.ts:296`
  (`if (Math.abs(diferencia) > 1e-4)`, dentro del bloque H12, líneas 289-308).
- **Archivo:línea del call site:** `src/application/cost-structures/process-costing/process-calculation-service.ts:240`
  (`validateProcessInputs(...)`).
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

### B · `normalLossPct` — disparador real: ¿tipeado o derivado de contar unidades?

**Confirmado en vivo con 6 casos controlados** (`evidencia/bloque5b-normallosspct-disparador.mjs`):
**NO falla con un porcentaje tipeado a mano (2,5% o 3,0% pasan limpio, en el `PUT` y en el
`calculate`). Falla cuando se DERIVA de contar unidades** (17 sobre 825 = 2,060606…%, 13 sobre
1.556 = 0,835475…%, 7 sobre 333 = 2,102102…%) — y falla en uno de DOS lugares distintos según el
caso, sin que el costista pueda predecir cuál:

| Caso | normalLossPct | `PUT movement` | `POST calculate` |
|---|---|---:|---:|
| Tipeado 2,5% | `0.025` | 200 | 200 OK |
| Tipeado 3% | `0.03` | 200 | 200 OK |
| Derivado 13/1556 | `0.008354755784061696` | 200 (guardado `0,0084`) | **422** (`extraordinaryLoss: -0.0704`) |
| Derivado 17/825 | `0.020606060606060607` | **422** (`extraordinaryLoss: -7.75e-16`) | — |
| Derivado 7/333 | `0.021021021021021023` | **422** | — |

**Con esas palabras exactas para el issue:** el defecto se dispara cuando el porcentaje se deriva
de una cuenta de unidades — que es como se mide en la realidad, nunca redondo — y puede rechazar la
carga en dos momentos con dos causas técnicas distintas: (1) en el `PUT` mismo, por ruido de punto
flotante IEEE-754 sobre el valor crudo sin redondear (`unit-movement-service.ts:456` →
`src/domain/calculations/process-costing.ts:206-232`); (2) en el `calculate`, por el redondeo a 4
decimales que Postgres ya aplicó al guardar, cuando ese redondeo empuja la pérdida normal por
encima de la pérdida real informada (mismo `throw`, corriendo sobre el valor persistido).

### C · Barrido de decimales — conteo por riesgo

Sin cambios respecto de `07-dictamen.md`: **12 campos catalogados + 1 comodín**, en
`docs/auditorias/AUD-2026-09-15/08-barrido-decimales.md`. De los 12: **2 bloquean con error duro**
(`ProcessDepartment.conversionFromPrevious`, `UnitMovementSchedule.normalLossPct`), **4 contaminan
en silencio** (los cuatro `*Avance` de WIP, `ByProductLine.sellingCostVarPct`,
`ByProductLine.yieldPct`, `UnidadMedida.factor`), **6 sin riesgo práctico** (umbrales de alerta,
resultados calculados, datos ya redondeados en origen), y el comodín
`ParametroCosteo.valorNum` (clave-valor genérico, riesgo indeterminado y creciente con cada
paquete de rubro nuevo).

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
La división (`cantidad = importeNumero / precio.valor`) es genérica, en el mismo archivo, línea
341 — no hace falta tocarla, solo lo que se le pasa como `precio`.

**Confirmado: el arreglo es 100% frontend. Sin schema, sin migración, sin backend.** El campo
correcto (`contribucionMarginalPorCajon`) **ya viaja en la misma respuesta** que este componente
consume — verificado en el JSON real de `GET /periods/:id/tablero-dueno` en esta sesión
(`contribucionMarginalPorCajon: { valor: 22063.68, ... }`, junto a `precioPromedioVenta` en el
mismo payload, para el escenario M3). Es un cambio de una línea (más, idealmente, el rótulo —
"esto te cuesta N cajones de venta adicional" en vez de "equivale a"). **Puede salir solo y antes**
de cualquier otro arreglo de esta lista — pero conviene que el issue aclare que **solo resuelve el
conversor para estructuras `ORDERS`**: para `PROCESSES`, el campo `contribucionMarginalPorCajon`
nunca se puebla (hallazgo `AUD-2026-09-16-09`), así que el conversor seguiría mostrando "—" para el
vertical avícola aunque se corrija esta línea.

## 3 · Cierre

No se abrió ningún issue esta sesión, según lo pedido. Papeles listos para que `/costear-issue`
los convierta en la próxima sesión.

## 4 · Reproducibilidad

- `evidencia/bloque-followup-processes-tablero.mjs` + `evidencia/followup-processes-output.log`
  (hallazgo 1.b / AUD-2026-09-16-09).
- `evidencia/bloque5b-normallosspct-disparador.mjs` (punto B, ya citado en `07-dictamen.md`).
- Grep de `parametros-costeo` sobre `Costear.web/CosteAR-frontend/src/`: dos archivos, cero
  ocurrencias de `periodId` (punto 1.a).
