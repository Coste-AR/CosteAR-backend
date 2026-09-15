# PASO 2 — FX-AV-B por API, M1→M4

Empresa nueva, cadena `Planta (kg, secuencia 1) → Embolsado (bolsa de 50 kg, secuencia 2)`,
`conversionFromPrevious: 1/50`. Cargado y cerrado M1→M2→M3→M4 en secuencia, por el flujo normal
(`process-setup` → `periods` → `movement` ×2 → `calculate` → `close`). Script:
`evidencia/paso2-fxavb-m1-m4.mjs`, log final: `evidencia/paso2-output.log`.

## Anclas de Planta — TODAS exactas, los 4 períodos

| | u.total real | ancla | a justificar real | ancla | EF real | ancla |
|---|---:|---:|---:|---:|---:|---:|
| M1 | $230,00 | $230,00 | $26.904.000 | $26.904.000 | $2.064.000 | $2.064.000 |
| M2 | $252,00 | $252,00 | $31.939.200 | $31.939.200 | $1.699.200 | $1.699.200 |
| M3 | $278,5661 | $278,5661 | $37.355.000 | $37.355.000 | $2.088.528,97 | $2.088.528,97 |
| M4 | $247,2151 | $247,2151 | $33.364.928,97 | $33.364.928,97 | $1.375.290,80 | $1.375.290,80 |

**✓ TODAS coinciden exactas.** Sin ningún workaround, sin ningún fudge — a diferencia de M1 de
`AUD-2026-09-14` (Granja+Fraccionadora), que necesitó `750,06` en vez de `750` para poder cerrar.

## El chequeo específico pedido: u.MP de M2

> *"tiene que dar $220,00 EXACTO — si da $217,20 revalúa el inicial"*

**Real: $220,00 exacto.** Verificado dos veces: por API (`report.elements[MP].costoUnitario` en
el cuadre implícito de `u.total = 252,00 = 220,00 + 32,00`) y en pantalla — ver `05-capturas.md`,
la captura de Febrero 2026 muestra la tarjeta "MATERIA PRIMA (MP) $220,000" (formato AR:
$220,00). **No revalúa el inicial.**

## Identidad de arrastre (B18) — verificada exacta, automática

El sistema arrastra la existencia inicial del período siguiente **automáticamente al abrir**
(`processWipCarryOver` en `cost-period-propagation-service.ts:392-461`), **independiente del flag
`carryAmounts`** (ese flag es para otra cosa — el arrastre de Procesos corre siempre que
`costingSystem === 'PROCESSES'` y hay un período previo). No hace falta reenviar nada: los campos
`initialWip*` quedan escritos en la fila del período nuevo antes de que el costista toque nada.

```
Planta.initialWip == EF de M1:            real=9600    ancla=9600    ✓
Planta.initialWipCostMp == EF-MP de M1:   real=1920000 ancla=1920000 ✓
Planta.initialWipCostCif == EF-CC de M1:  real=144000  ancla=144000  ✓
```

Repetido igual, exacto, en las transiciones M2→M3 y M3→M4.

## P-03 — Promedio ponderado y arrastre entre períodos

**Estado anterior (`AUD-2026-09-14`): DIFERIDA — bloqueada por AUD-04a.**

**Estado esta sesión: ✅ VERIFICADO.** Los cuatro períodos de Planta cierran exactos contra el
fixture, la identidad de arrastre B18 cierra exacta y automática en las tres transiciones, y el
chequeo puntual "u.MP no se revalúa" (el riesgo concreto que P-03 existe para atajar) se confirmó
con el número exacto pedido. Limitación declarada: verificado sobre Planta (que no tiene
existencia inicial contaminada por AUD-04a); el mismo mecanismo de arrastre para Embolsado
también cerró (ver más abajo), pero sus valores absolutos arrastran el desvío del hallazgo
`AUD-2026-09-15-01` (no es un problema de arrastre, es un problema de precisión de un campo
distinto — ver abajo).

## Embolsado — desvíos pequeños, explicados, no misteriosos

| | modificado real | ancla | unitario real | ancla | diff unitario |
|---|---:|---:|---:|---:|---:|
| M1 | $11.500,00 | $11.500,00 | $13.735,38 | $13.735,84 | −$0,46 |
| M2 | $12.576,98 | $12.576,99 | $14.715,04 | $14.715,28 | −$0,24 |
| M3 | $13.900,25 | $13.900,25 | $16.150,86 | $16.151,35 | −$0,49 |
| M4 | $12.412,31 | $12.412,33 | $14.632,59 | $14.633,39 | −$0,80 |

Estos desvíos (todos menores a $1 por bolsa) **no son un hallazgo del motor de Procesos** — son
la consecuencia directa y documentada del workaround que hizo falta para *cargar* Embolsado, ver
`AUD-2026-09-15-01` abajo. `modificado` (que no depende de la pérdida normal/extraordinaria)
coincide casi exacto; `unitario` (que sí depende de `extraordinaryLoss`, ligeramente contaminado
por el workaround) arrastra un desvío proporcional al tamaño del error de redondeo del período.

---

## 🔴 AUD-2026-09-15-01 · `normalLossPct` es `Decimal(9,4)` — misma familia que AUD-04a, con menos tolerancia

**Severidad:** 🔴 CRÍTICO
**Dónde:** `prisma/schema.prisma:1850` — `normalLossPct Decimal? @db.Decimal(9, 4)`. Validación en
`src/domain/calculations/process-costing.ts` (`calcNormalAndExtraordinaryLosses`, R2: la pérdida
extraordinaria no puede ser negativa).
**Qué hace hoy:** `pn/periodUnits` (la pérdida normal expresada como fracción de las unidades del
período) es, en general, un número periódico en base 10 — igual que las conversiones de unidad de
`04a`. `normalLossPct` solo tiene **4 decimales**. Postgres redondea (no trunca) al guardar:
`13/1556 = 0,0083547...` se guarda como `0,0084`. Con esa fracción guardada,
`normalLoss = 1556 × 0,0084 = 13,0704`, mayor que el `totalLossReported = 13` que el costista
cargó de buena fe (sin pérdida extraordinaria ese período) → `extraordinaryLoss = −0,0704` →
**422 duro, sin ninguna tolerancia** (a diferencia de `AUD-2026-09-14-04b`, que sobre el chequeo
*cruzado* entre departamentos al menos tiene una tolerancia de `1e-4`, aunque insuficiente).
**Reproducido en vivo, dos veces**, con dos períodos distintos:
```
PROCESS_VALIDATION: "La pérdida real total (14) es menor que la pérdida normal
(14.00000000000000172)..." — M2, ver evidencia/paso2-run1-FALLA-extraordinaria-negativa.log
PROCESS_VALIDATION: "La pérdida real total (13) es menor que la pérdida normal (13.0704)..."
— M4, ver evidencia/paso2-run2-FALLA-M4-decimal94.log
```
**Qué debería hacer:** la misma familia de arreglo que `04a` — o bien una precisión suficiente
para la escala real de producción del rubro (y `Decimal(9,4)` claramente no alcanza incluso a
escalas moderadas, ~1.500 unidades), o bien modelar la pérdida normal como una cantidad de
unidades directa en vez de una fracción a recalcular, o bien dar tolerancia (no cero) al chequeo
`extraordinaryLoss ≥ 0` cuando la diferencia es del orden del redondeo de la columna.
**Workaround aplicado para poder seguir cargando esta tanda** (declarado): truncar
`normalLossPct` a los mismos 4 decimales de la columna, hacia abajo (`Math.floor(...*1e4)/1e4`),
para garantizar `normalLoss ≤ totalLossReported`. Esto **contamina** el `unitario`/`CAUP`/`EF` de
Embolsado en el orden de los centavos por unidad (tabla arriba) — declarado, no oculto.
**Magnitud:** cualquier período con una pérdida normal real (sobre la escala real de producción)
que no sea exactamente representable en 4 decimales, y sin pérdida extraordinaria ese mes,
**rechaza el cálculo aunque el dato cargado sea perfectamente correcto**. No es un caso de borde:
la inmensa mayoría de los % de pérdida normal reales (derivados de un conteo físico ÷ un lote) no
son "redondos".
**Cómo se reproduce:** `node evidencia/paso2-fxavb-m1-m4.mjs` con el truncamiento de
`normalLossPctEmb` revertido a `emb.pn / periodUnitsEmb` sin `Math.floor`.
**Issue/PR de origen:** preexistente, mismo origen que `04a` (migración
`20260803120000_add_process_department_unit`).
**Prueba que lo encontró:** PASO 2 de esta sesión, carga de Embolsado M2 y M4.
