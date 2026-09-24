# 0032 — Cerrar un período congela sus insumos y su resultado; toda escritura posterior pasa por el dato tardío

- **Fecha:** 2026-09-24
- **Estado:** Propuesta — la firman Alan y Lautaro (dominio) antes de encolar
- **Decide:** Alan + Lautaro
- **Contexto de origen:** ADR-2 del plan de remediación AUD-2026-09; auditorías AUD-2026-09-14-05, AUD-2026-09-15-02 y -03 (familia B) y AUD-2026-09-23-05

## Contexto

Hoy **"cerrar" congela el resultado, pero no los datos que lo produjeron.** `cost-period-service.ts` `close()` guarda `resultSnapshot` y `closedRunId`, y eso está bien. Pero:

- El movimiento de unidades y los costos de procesos (`PUT .../departments/:deptId/periods/:periodId/movement`) **aceptan escrituras sobre un período `CLOSED` y devuelven 200**. El 23-09 el costo de materia prima de un mes cerrado cambió un 20 % sin pasar por ningún control.
- El flujo de dato tardío (`late-data-service.ts`, `LateDataDecision`, `lateDataPolicy` = `ASK` | `CURRENT_PERIOD` | `REOPEN`) existe, pero **solo lo usa la carga por `DataPoint`** (camino de órdenes). Procesos, gastos de no fabricación, ventas y conceptos con `periodId` no pasan por él.
- La clasificación (fijo/variable) se resuelve contra el período que se calcula, pero **la pantalla de clasificación nunca manda `periodId`** y no tiene selector de período. En la interfaz no existe la idea de "la clasificación de marzo".
- `reopen()` pide motivo y cuenta reaperturas, pero **no dice qué pasa con los meses siguientes**, cuya existencia inicial salió del mes que se reabre (AUD-15-03).

El dueño decide con el mes cerrado. Si ese número cambia sin que nadie lo decida, el producto de costos deja de ser confiable.

## Decisión

1. **Al cerrar se congelan los insumos, no solo el resultado.** Junto a `resultSnapshot` se guarda un `inputsSnapshot` con **IDs de las versiones usadas**, no con copias de los valores: movimientos de unidades por departamento, versión de cada `ConceptoCosteo` e importe, `ParametroCosteo`, series de índices de precio, tramos y unidad de gestión. Es el mismo patrón append-only de los ADR 0028 y 0030. Un período cerrado se recalcula **solo** contra ese snapshot.
2. **Un solo guardia para toda escritura sobre un período cerrado.** Todo servicio que escriba algo con `periodId` (movimiento de procesos, data points, gastos de no fabricación, ventas, desperdicios, conceptos e importes con `periodId`, joint costs) llama al mismo `assertPeriodoEscribible()`. Si el período está `CLOSED`:
   - responde **409 `PERIOD_CLOSED`**, con la política vigente de la estructura y las opciones posibles. **Nunca un 200 silencioso.**
   - `ASK` → crea una `LateDataDecision` pendiente con el valor propuesto y la deja en la bandeja.
   - `CURRENT_PERIOD` → imputa el dato al período abierto, con traza del período al que pertenecía.
   - `REOPEN` → reabre con el motivo que venga en el pedido (obligatorio) y escribe; queda en la bitácora.
3. **`LateDataDecision` deja de depender de `DataPoint`.** Migración aditiva: `targetKind` + `targetId`, y `dataPointId` pasa a ser opcional. Así el mismo mecanismo cubre procesos y los demás insumos.
4. **Reabrir un período marca los siguientes, no los reescribe.** Los períodos posteriores ya cerrados quedan con `requiereRecalculo = true` y un aviso visible ("el inicial de este mes viene de un mes que se reabrió el DD-MM"). Su resultado congelado **no cambia solo**. Se recalculan en cascada cuando alguien lo pide desde la pantalla, y cada recálculo deja una nueva versión del snapshot con motivo.
5. **Qué necesita la UI:** selector de período en la pantalla de clasificación, un cartel de "período cerrado" en toda pantalla de carga, la bandeja de datos tardíos con los nuevos `targetKind` y el aviso de "requiere recálculo" en el tablero de los meses afectados.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Bloquear toda escritura sobre un cerrado con 422, sin bandeja | Viola la Constitución §6 (se guarda y se marca): la factura de junio que llega en agosto no tiene dónde ir, y el usuario queda sin salida |
| Recalcular en cascada automáticamente al reabrir | Reescribe meses con los que el dueño ya decidió, sin que lo haya pedido. Es exactamente el defecto que se quiere cerrar, pero hacia adelante |
| Congelar copiando los valores en vez de los IDs de versión | Duplica datos, pierde la traza de quién cambió qué, y no es coherente con 0028/0030 |
| Dejar el guardia en cada servicio por separado | Es lo que hay hoy: uno lo tiene (data points) y cinco no. Un solo guardia es lo único que un test puede cubrir entero |

## Consecuencias

**A favor**

- Un mes cerrado se puede recalcular años después y da lo mismo.
- El dato tardío tiene un solo camino, con decisión registrada, para todos los insumos.
- Reabrir deja de romper en silencio los meses siguientes.

**En contra / lo que aceptamos pagar**

- Migraciones aditivas: `inputsSnapshot` en `CostPeriod`, `targetKind`/`targetId` en `LateDataDecision`, y `requiereRecalculo` en `CostPeriod`.
- Cinco servicios cambian su camino de escritura para pasar por el guardia (unit-movement, gastos de no fabricación, ventas, desperdicios, conceptos e importes).
- Más trabajo para el usuario cuando elige `ASK`: tiene que resolver la bandeja. Es el precio de que nada cambie sin que alguien lo decida.

**Qué se rompe si alguien la revierte sin leer esto**

- Vuelve la familia B: el pasado se reescribe con un 200 y el tablero del mes cerrado deja de coincidir con lo que el dueño vio cuando decidió.

## Cómo se verifica que sigue vigente

- Test de integración **por cada servicio que escribe con `periodId`**: escribir sobre un período `CLOSED` da 409, y el valor en base no cambia. El test escribe primero y espera el rojo.
- Test: cerrar FX-AV M1, cambiar un concepto, recalcular M1 → mismo resultado (usa el snapshot).
- Test: reabrir M1 con M2 cerrado → M2 queda `requiereRecalculo = true` y su `resultSnapshot` es idéntico al de antes.
- Check en CI: todo `PUT`/`POST`/`PATCH` bajo una ruta con `:periodId` pasa por `assertPeriodoEscribible` (lista explícita, comparada contra las rutas registradas).
