# PASO 3 — Cómo se comporta el sistema cuando los períodos se mueven

Sobre la serie `FX-AV-B` M1..M4 ya cargada y cerrada (PASO 2). Scripts:
`evidencia/paso3-periodos-movibles.mjs` (A, B, C, E) y `evidencia/paso3d-aud05-magnitud.mjs` (D).
Log final: `evidencia/paso3-output.log` (los intentos `run1`/`run2` con payload incompleto quedan
como evidencia de diagnóstico, no como resultado).

---

## A · Orden de cierre

**¿Se puede cerrar M3 sin haber cerrado M2?** No se pudo poner a prueba en el sentido literal,
porque el sistema **nunca permite que exista más de un período abierto a la vez** en una
estructura, sin importar cuál: `POST /structures/:id/periods` (abrir el siguiente) revisa si hay
**algún** período con `status: 'OPEN'` — no solo el más reciente — y lo bloquea.

**Reproducido en vivo:**
1. Reabrir M2 (ya cerrado) → `200 OK`, M2 vuelve a `OPEN` (M3 y M4 siguen `CLOSED`).
2. Con M2 abierto, intentar abrir M5 → `400 VALIDATION_ERROR`:
   *`"No se puede abrir un período nuevo: "Febrero 2026" sigue abierto. Cerralo primero."`*
3. Intentar volver a cerrar M3 (ya cerrado) → `400 VALIDATION_ERROR`:
   *`"El período "Marzo 2026" ya está cerrado."`*

**Veredicto A:** el sistema protege la **secuencia de apertura** de forma correcta y global (no
solo contra el último período). Lo que **no** protege —ver C— es el **contenido** de un período
ya cerrado: la protección de A es sobre "no avances mientras algo esté abierto", no sobre "no
toques lo cerrado".

---

## B · Reapertura en cascada

Con M2 reabierto (de A), se le sumó $1.000.000 a `periodCostMp` de Planta y se recalculó:

```
Planta M2 ANTES:  u.total $252,00   | EF $1.699.200,00
Planta M2 DESPUÉS: u.total $259,86  | EF $1.755.803,77   (recalculo en caliente, 200 OK)
```

Se volvió a cerrar M2 (`200 OK`, `status: CLOSED`, `closedAt` actualizado). Se inspeccionó
`initialWipCostMp` de M3 (arrastrado de M2) **antes y después** de recerrar M2:

```
M3 Planta.initialWipCostMp SIN recerrar M2:    $1.584.000,00
M3 Planta.initialWipCostMp DESPUÉS de recerrar: $1.584.000,00   ← IDÉNTICO, no se actualizó
```

**Desvío medido:** la EI-MP que M3 *debería* tener si el arrastre se hubiera re-ejecutado contra
el M2 corregido es `$1.755.803,77 − ($7.200 × 0,5 × $32,00) = $1.640.603,77` (la porción MP de la
nueva EF de Planta M2). Contra el `$1.584.000,00` que M3 realmente tiene:

> **DESVÍO: $56.603,77**

**Las tres posibilidades que planteaba el pedido:**
- ❌ NO se recalculan en cascada.
- ❌ El sistema NO lo impide (dejó reabrir, editar y recerrar M2 sin ningún aviso sobre M3/M4).
- ✅ **Quedan inconsistentes en silencio.** M3 sigue "cerrado" mostrando una existencia inicial
  que ya no es la que su propio predecesor (M2) produce. No hay ningún warning, ningún flag de
  "desactualizado", nada. El único lugar donde esto se nota es comparando el número a mano contra
  lo que el motor produciría hoy.

**Veredicto B:** el arrastre (`processWipCarryOver`) es una **foto tomada una sola vez, al abrir
el período**. Reabrir y editar el predecesor no la actualiza — ni automáticamente, ni con un
aviso, ni siquiera al volver a cerrar el predecesor. Si M3/M4 también se reabrieran y
recalcularan, tampoco se arreglaría solo: `initialWipCostMp` es un valor **guardado** en la fila
del cuadro de M3, no algo que el motor recalcule desde la fuente cada vez.

---

## C · Dato tardío en período cerrado

Se intentó un `PUT movement` directo sobre Planta de M1 (**CERRADO**, nunca reabierto), con
`fechaHecho: '2026-01-15'` (dentro del período) y `periodCostMp: 99.999.999` (vs. el original
`23.520.000`), reenviando el resto del cuadro completo (necesario — ver nota de payload abajo):

```
PUT movement Planta M1 (CERRADO) -> 200 OK
GET movement Planta M1 después   -> periodCostMp: 99999999  (era 23520000)
```

**Veredicto C: ACEPTADO EN SILENCIO.** Ni rechazo (`4xx`), ni "dato tardío" registrado en ningún
`late_data_decisions`, ni aviso de que el período está cerrado. El campo `status: CLOSED` del
período **no se consulta en absoluto** en el camino de guardado del cuadro de movimiento
(`UnitMovementService.save`, invocado por `PUT /structures/:id/process/departments/:deptId/
periods/:periodId/movement`). Esto es **más grave que `A`**: la protección de secuencia (A) da
una falsa sensación de que "cerrado" significa protegido — y no es así para el contenido.

**Nota de método:** el primer y segundo intento de este chequeo fallaron con `422` *por mi propio
payload* ("el cuadro no cuadra"), no por protección del sistema — el endpoint exige reenviar el
cuadro de unidades COMPLETO en cada `PUT` (no hace merge parcial de `startedInProduction`,
`transferredOut`, `finalWip`, etc., a diferencia de los campos `initialWipCost*`, que sí se
preservan si se omiten). Ver `evidencia/paso3-run1-B-y-C-incompletos.log` y
`paso3-run2-B-y-C-aun-incompletos.log`. Una vez reenviado el cuadro completo, el `PUT` sobre el
período cerrado **se aceptó igual** — la asimetría de merge no es la causa del hallazgo, solo
retrasó la prueba correcta.

---

## D · AUD-05 con magnitud

**Mecanismo, reconfirmado:** estructura ORDERS mínima (mismo patrón que
`docs/auditorias/AUD-2026-09-14/evidencia/p07-periodo-cerrado.mjs`), clasificación
`comportamiento_materia_prima = FIJO`, M1 cerrado, `GET .../tablero-dueno` antes y después de
reclasificar a `VARIABLE` con M2 abierto. El `corrida.id` (`CalculationRun` congelado en el
`close()`) es **idéntico** antes y después de la reclasificación —
`8ced5d5e-555d-42d6-8491-12fae8bac32e` en las dos lecturas—: el "resultado informado" (la corrida
que se guardó al cerrar) no se recalcula ni se reemplaza solo porque la clasificación empresa-wide
cambió. Esto es consistente con la lectura del fixture: *"RESULTADO INFORMADO: NO SE MUEVE"*.

**Magnitud exacta del fixture: NO VERIFICADA esta sesión.** Para reproducir los números concretos
que pide el pedido (`cm $30.000,00 → $27.333,33`, `PE 600,0 → 585,4`, etc.) hace falta una
estructura con la escala de M1 de `FX-AV` (750 cajones, `cm` real, ventas configuradas) — la
estructura mínima de este chequeo no tenía `unidadGestion` ni la clasificación de MOD/CIF
completa, así que `tablero-dueno` devolvió "Incompleto" en `costoPorCajon`/`contribucionMarginal`/
`puntoEquilibrio` en las dos lecturas (mismo motivo en ambas: correcto per R13, pero no deja medir
la magnitud pedida). Se necesitaría, en una próxima tanda, la cadena Granja→Fraccionadora completa
con el workaround de `04a` (o ya resuelto) y ventas cargadas — fuera del presupuesto de esta
sesión.

**Veredicto D:** mecanismo CONFIRMADO (ya lo estaba desde `AUD-2026-09-14-05`; esta sesión agrega
la evidencia puntual de que el `CalculationRun` en sí no cambia de identidad). Magnitud en pesos:
**NO VERIFICADA**, declarado, no inventado.

---

## E · Recálculo de período cerrado

Reabierto M4 (nunca tocado desde que se cerró en PASO 2) y calculado **dos veces seguidas**:

```
1er recalculate M4 -> runId: 0009616a-...  runN: 7
2do  recalculate M4 -> runId: 40693e79-...  runN: 8
```

**Veredicto E: NO SE PISA.** Cada recálculo crea una `CalculationRun` nueva, con `runN`
correlativo — confirmado en vivo. Por lectura de código
(`src/application/cost-structures/calculation-run-persistence.ts:85-143`, función
`persistCalculationRun`):

- `runN` se asigna con un lock explícito (`SELECT ... FOR UPDATE` sobre la fila de la estructura)
  para que dos corridas concurrentes no choquen contra `@@unique([structureId, runN])` — comentado
  en el propio código como una carrera ya prevista.
- La fila de la corrida guarda `executedBy`, `validated`, `validatedAt`, `validatedBy` — el
  "quién y cuándo" pedido. Para `trigger: 'MANUAL'` o `'CLOSE'`, `validated = true` (alguien miró);
  para `'AUTO_DAILY'`, `false`.
- `recordTraceAudit(...)` se llama con el **mismo `tx`** de la transacción que crea la corrida —
  la bitácora queda en la misma unidad atómica (DOM-02), no en una escritura separada.

**Lo NO verificado esta sesión:** no se corrió una query SQL directa contra la tabla de auditoría
para confirmar que la fila realmente quedó (se confía en la lectura de código + el resultado
observable de `runN` incrementando). Declarado como límite del alcance, no como duda sobre el
mecanismo.
