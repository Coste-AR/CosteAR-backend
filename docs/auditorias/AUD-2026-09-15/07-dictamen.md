# Dictamen de auditoría — AUD-2026-09-15

## 1. Alcance

- **Repo y rama:** backend `auditoria/AUD-2026-09-14` @ `a249414`, mismo commit durante toda la
  sesión (no se tocó código de producto, solo se corrieron scripts contra el servidor real).
- **Continuación dirigida de:** `AUD-2026-09-14` (opinión ADVERSA, dos CRÍTICOS: `04a` y `05`).
  Esta tanda es un pedido puntual de cinco pasos, no una auditoría de 7 fases completa — no hay
  F1 (plan/riesgo) ni un repaso de R1-R35 propio; el marcador de reglas duras vigente sigue siendo
  el de `AUD-2026-09-14` (13/35 evaluadas), sin delta calculado esta sesión.
- **Qué se hizo:** PASO 1 (experimento controlado sobre `04a`), PASO 2 (cargar `FX-AV-B` M1-M4 por
  API), PASO 3 (orden de cierre, reapertura en cascada, dato tardío, magnitud de `05`, recálculo
  de período cerrado), PASO 4 (auditoría de `period-comparison`), PASO 5 (capturas).
- **Qué quedó fuera y por qué:**
  - Granja→Fraccionadora (huevo→cajón) sigue sin cargarse limpio — sigue bloqueada por `04a`
    en sí (no arreglada esta sesión, solo diagnosticada con más certeza).
  - La magnitud exacta en pesos de PASO 3.D (`cm`/PE del fixture) — necesitaba una estructura a
    escala completa con ventas configuradas, fuera de presupuesto.
  - R6 (amortización) sobre Granja — no se cargó Granja esta sesión; se verificó indirecto vía
    Planta (Procesos) y por lectura de código (capa de clasificación de Órdenes).
  - El conversor de pesos a cajones y el PE-vs-techo en pantalla (PASO 5) — la empresa de prueba
    no tiene unidad de gestión ni ventas configuradas.
  - Ningún R1-R35 nuevo evaluado — fuera del alcance de este pedido.
- **Entorno:** local, `localhost:3000`/`:3001` (backend, misma Postgres `localhost:5433`),
  `localhost:5173` (frontend). Registro real por API/browser en todos los casos.

## 2. Opinión

**ADVERSA — se mantiene el bloqueo de `AUD-2026-09-14`, con hallazgos nuevos que lo profundizan.**

Esta tanda no encontró un motor más sano de lo que ya se sabía — lo confirmó con más precisión y
encontró que el problema de "un período cerrado no está protegido" es más grande de lo que decía
la ficha original. El experimento del PASO 1 prueba, sin ambigüedad, que `AUD-2026-09-14-04a` es
puntual (representabilidad decimal) y que el resto del motor de Procesos está sano — cargar
`FX-AV-B` completo, cuatro períodos, cerrado en secuencia, sin ningún workaround, lo confirma en
la práctica. Pero en el camino aparecieron **dos hallazgos nuevos con reproducción en vivo, no por
lectura de código**: la misma familia de defecto que `04a` reaparece en `normalLossPct`
(`Decimal(9,4)`, sin tolerancia — bloqueó dos períodos en esta misma sesión) y, más serio, **un
período cerrado no protege su contenido en absoluto**: se le puede escribir un costo distinto por
`PUT` directo, en silencio, sin que el sistema note ni avise que el período está cerrado. Combinado
con que la reapertura de un período intermedio deja a los posteriores con una existencia inicial
vieja **sin ningún aviso** (desvío medido: $56.603,77 en un caso chico de prueba), la conclusión es
que "cerrado" hoy protege la SECUENCIA de apertura, no protege NADA del contenido ya cargado.

## 3. Hallazgos de esta sesión

### 🔴 CRÍTICOS (3 nuevos)

#### AUD-2026-09-15-01 · `normalLossPct` en `Decimal(9,4)` — misma familia que `04a`, sin tolerancia
Ver ficha completa en `02-paso2-fxavb.md`. **Magnitud:** bloqueó el cálculo de M2 y M4 de una
carga en vivo con `extraordinaryLoss` negativo de hasta `-0,0704` unidades por un redondeo de
0,0001 en la columna. **Camino de remediación:** misma familia que `04a` — precisión suficiente o
modelar la pérdida normal como cantidad de unidades, no como fracción a recalcular.

#### AUD-2026-09-15-02 · Un período `CLOSED` no protege su contenido — `PUT movement` se acepta y persiste en silencio
Ver ficha completa en `03-paso3-periodos-movibles.md §C`. **Magnitud:** `periodCostMp` de un
período cerrado se reescribió de $23.520.000 a $99.999.999 sin ningún rechazo. **Camino de
remediación:** `UnitMovementService.save()` (o el nivel que corresponda) tiene que rechazar
escrituras cuando `period.status === 'CLOSED'`.

#### AUD-2026-09-15-03 · Reapertura en cascada deja a los períodos posteriores con existencia inicial desactualizada, en silencio
Ver ficha completa en `03-paso3-periodos-movibles.md §B`. **Magnitud:** $56.603,77 de desvío en
la EI-MP de un período posterior tras editar y recerrar su predecesor. **Camino de remediación:**
al reabrir un período con sucesores ya cerrados, invalidar visiblemente (o re-ejecutar) el
arrastre hacia adelante — hoy es una foto tomada una sola vez al abrir, que nada vuelve a tocar.

### 🟠 GRAVE (1 nuevo)

#### AUD-2026-09-15-04 · `period-comparison` no cubre punto de equilibrio, techo de tramo, ni mix
Ver ficha completa en `04-paso4-period-comparison.md §3/§4`. La pantalla que existe para explicar
variaciones entre períodos no tiene ningún campo relacionado con la capa marginal — un costista
que solo mire "Comparación" nunca se entera de que el PE se movió por un cambio de mix, ni de que
cayó fuera de la capacidad instalada. **Camino de remediación:** o se extiende
`PeriodComparison` con esos campos, o se documenta explícitamente que esa pregunta la responde
otra pantalla (hoy no está documentado en ningún lado visible al usuario).

### 🟡 OBSERVACIÓN (1 nueva)

#### El `PUT` de movimiento no mergea parcialmente el cuadro de unidades
`startedInProduction`, `transferredOut`, `finalWip`, `normalLossPct`, `totalLossReported` deben
reenviarse completos en cada `PUT` (a diferencia de `initialWipCost*`, que sí se preservan si se
omiten). No es un defecto — es una asimetría del contrato del endpoint que retrasó dos intentos de
esta sesión (`evidencia/paso3-run1-*`, `run2-*`) y podría confundir a un consumidor nuevo de la
API. Vale documentarlo en el propio schema (`unit-movement.schema.ts`).

## 4. P-03 (promedio ponderado y arrastre entre períodos)

**✅ VERIFICADO** (antes: DIFERIDA, bloqueada por `04a`). Ver `02-paso2-fxavb.md`. Las 4
transiciones de período de Planta cerraron exactas contra el fixture, incluido el chequeo
específico pedido (u.MP de M2 = $220,00 exacto, no $217,20 — confirmado por API y en pantalla).

## 5. Lo que se verificó y está bien

- El motor de Costeo por Procesos, con un factor de conversión representable, funciona de punta a
  punta sin contaminación: cuadro de unidades, producción equivalente, CAUP, existencia final,
  arrastre entre 4 períodos consecutivos — todo exacto contra el fixture.
- El arrastre de existencia inicial (`processWipCarryOver`) es automático al abrir un período
  nuevo de Procesos, no depende del flag `carryAmounts`, y no revalúa el costo heredado al precio
  del período nuevo.
- El sistema impide activamente que la secuencia de apertura avance mientras cualquier período
  (no solo el más reciente) esté abierto.
- El recálculo de un período (abierto o reabierto) nunca pisa una corrida anterior: cada
  `calculate` crea una `CalculationRun` nueva, con `runN` correlativo protegido por lock, y la
  auditoría se escribe en la misma transacción (DOM-01/DOM-02, confirmado por código y en vivo).
- `period-comparison` etiqueta correctamente `frozen` vs. `recomputed` según el estado real de
  cada período comparado, con warnings explícitos cuando corresponde.

## 6. Limitaciones

- Granja→Fraccionadora (la cadena real del fixture avícola) sigue sin cargarse limpia — `04a`
  sigue bloqueando esa cadena específica, no arreglado esta sesión.
- Magnitud en pesos de PASO 3.D (AUD-05): NO VERIFICADA, necesita estructura a escala del fixture
  con ventas configuradas.
- R6 sobre Granja (amortización del plantel): NO VERIFICADO en vivo esta sesión.
- Conversor de pesos a cajones y PE-vs-techo en pantalla: NO REPRODUCIBLE con la empresa de
  prueba de esta sesión (sin unidad de gestión ni ventas).
- Causa raíz de por qué `:3000` y `:3001` comparten `terms.id` pero no las credenciales de login:
  no investigada, fuera del objeto de esta auditoría.
- No se corrió una query SQL directa contra la tabla de auditoría para PASO 3.E — se confía en
  lectura de código + el `runN` observable en vivo.

## 7. Reproducibilidad

- Fixture: `FX-AV` + `FX-AV-B`, `.claude/skills/costear-auditoria/scripts/calc_fx_av.py` (corrido
  con `--assert`: **OK — 36 cuadres verificados**, incluye los 3 nuevos de `FX-AV-B`).
- Inputs exactos de `FX-AV-B`: `evidencia/dump_paso2_inputs.py` (reusa las funciones puras del
  fixture, no re-deriva nada a mano).
- Semilla de datos: `evidencia/paso2-fxavb-m1-m4.mjs` (exporta `cargarFxAvB()`, reutilizado por
  `paso3-periodos-movibles.mjs` y `paso4-period-comparison.mjs`).
- Comandos de la corrida: ver `evidencia/` — todos los `.log` con salida completa, incluidos los
  intentos fallidos que llevaron a los workarounds declarados.
