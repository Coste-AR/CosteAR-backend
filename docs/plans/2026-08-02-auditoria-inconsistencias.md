---
title: "Auditoría de inconsistencias — análisis estático + simulación end-to-end"
fecha: 2026-08-02
metodo: "ESLint, tsc con flags de código muerto, ts-prune, y una simulación contra Postgres real con RLS"
---

# Auditoría de inconsistencias

Dos capas: análisis estático de todo el código, y una **simulación end-to-end**
contra un Postgres real con las políticas RLS aplicadas, recorriendo el camino
completo de un costista de Costeo por Procesos.

La simulación es la que encontró lo que importa. El análisis estático salió casi
limpio; los bugs de verdad solo aparecen cuando las piezas se tocan.

---

## Resumen

| # | Hallazgo | Gravedad | Estado |
|---|---|---|---|
| A1 | **Un período de Procesos NUNCA se puede cerrar** | Crítico | Abierto |
| A2 | La comparación de períodos usa el motor de Órdenes | Alto | Abierto |
| A3 | La repropagación informaba meses que no tocaba | Alto | **Arreglado** |
| A4 | El export a Excel usa el motor de Órdenes | Medio | Abierto |
| A5 | El simulador de escenarios usa el motor de Órdenes | Bajo | Abierto |
| B1 | Lógica de espejo al período duplicada 3 veces | Medio | Abierto |
| B2 | Chequeo de consistencia de MP que nadie ejecuta | Medio | Abierto |
| B3 | Exports muertos (14 backend, 14 frontend) | Bajo | Abierto |
| B4 | 3 parámetros sin usar | Cosmético | Abierto |

---

## A1 — CRÍTICO: un período de Costeo por Procesos nunca se puede cerrar

**Qué pasa.** `CostPeriodService.computeResult()` corre `runCalculation()` —el
motor de **Órdenes**— sobre los JSON de configuración del período,
**sin mirar nunca `costingSystem`**. En una estructura de Procesos esos JSON
están vacíos por diseño: los costos viven en el cuadro de movimiento de unidades.

Resultado: cerrar el período falla siempre, con este mensaje:

> No se puede cerrar "Julio 2026": el sistema no pudo calcular los números del
> período. Revisá que las tres secciones (materia prima, mano de obra y costos
> indirectos) estén completas.

Le pide al costista completar secciones **que en su pantalla no existen**.

**Por qué es crítico y no solo molesto.** `openNext()` se niega a abrir un
período nuevo mientras haya uno abierto. Como el cierre nunca puede completarse,
**una estructura de Procesos queda trabada en su primer período para siempre**.
Y sin cierres no hay cadena de períodos: no hay arrastre, no hay comparación, no
hay histórico.

**Cómo se detectó.** La simulación intentó cerrar julio y fue rechazada. En la
suite de tests no aparece porque ningún test cierra un período de una estructura
de Procesos.

**Es de la misma familia que el bug del botón Calcular** que se arregló hoy (PR
#31): el motor de Órdenes corriendo sin preguntar el sistema de costeo. Al
arreglar aquél no revisé si había otros puntos con el mismo patrón. Los hay.

**Fix propuesto.** `computeResult()` tiene que despachar por sistema de costeo.
Para Procesos el resultado congelado no puede tener la forma de Órdenes
(`rawMaterialConsumed`, `directLaborTotal`, …): hay que congelar el informe de
costos por departamento. Es un cambio de tamaño medio porque toca la forma de
`FrozenCalculation` y quien la lee.

---

## A2 — ALTO: la comparación de períodos usa el motor de Órdenes

Mismo origen que A1: `computeResult(period, 'comparar')`.

**Es alcanzable desde la interfaz.** La pestaña *Comparación* está en el juego de
pestañas compartido, así que aparece también en Procesos
(`tab-definitions.ts:85`). Al comparar dos períodos de una estructura de
Procesos, o falla con el mismo mensaje engañoso, o —si el clasificador autopobló
los JSON— **muestra números calculados con la matemática equivocada**.

El caso silencioso es el peligroso: números plausibles y mal calculados.

---

## A3 — ALTO (arreglado): la repropagación informaba meses que no tocaba

**Qué pasaba.** Al reabrir un período, `repropagateForward()` reescribe la
existencia inicial de los meses siguientes. Lo hacía con `updateMany`, que
**cuando no encuentra la fila no escribe nada y tampoco falla**.

Si el mes siguiente todavía no tenía cuadro de movimiento para ese departamento,
la repropagación no escribía una sola fila **pero informaba haber tocado el
mes** — y eso quedaba asentado en la bitácora. Es decir: la traza que el costista
consulta para entender por qué cambió un número decía algo que no había pasado.

**Cómo se detectó.** La simulación reabrió julio y después fue a mirar si agosto
tenía la existencia inicial escrita. No la tenía.

**Por qué la suite no lo veía.** Los mocks devuelven lo que se les pide. Un
`updateMany` que no matchea nada es indistinguible de uno que matchea, salvo que
se mire la base de verdad.

**Arreglado** en `1ee8ae9`: ahora es un `upsert`, que es exactamente lo que hace
la apertura normal de un período. Cuatro tests de regresión, uno de ellos
verificando que el arrastre escrito al crear y al actualizar sea idéntico —si
difirieran, el número de un mes dependería de si su cuadro ya existía.

---

## A4 — MEDIO: el export a Excel usa el motor de Órdenes

`excel-export.ts:140` corre `runCalculation()` sin mirar el sistema de costeo.
Exportar una estructura de Procesos produce un Excel con la estructura y los
números de Órdenes. Como el archivo sale del sistema y circula por mail, un
número mal calculado ahí es difícil de rastrear después.

---

## A5 — BAJO: el simulador de escenarios usa el motor de Órdenes

`cost-structure-service.ts:583`. No es alcanzable desde la interfaz —la pestaña
*Simulador* es solo de Órdenes (`tab-definitions.ts:64`)— pero **el endpoint está
abierto** y responde a quien lo llame.

---

## B1 — MEDIO: la lógica de espejo al período está duplicada tres veces

Existe `mirrorToOpenPeriod()` en `period-sync.ts`, escrita para ser la única
definición de "copiar al período abierto lo que se acaba de escribir en la
estructura".

**Nadie la usa en producción**: solo los tests. Las tres copias reales están
inline en `cost-structure-service.ts` (dos veces) y `cost-structure-populator.ts`.

Hoy las tres hacen lo mismo. El riesgo es el de siempre con la duplicación: la
próxima vez que alguien agregue un campo al espejo, lo va a agregar en una y no
en las otras dos, y la foto del período va a divergir de la estructura sin que
nada falle.

---

## B2 — MEDIO: hay un chequeo de consistencia que nadie ejecuta

`checkRawMaterialConsistency()` verifica que la MP consumida del estado de costos
coincida con la que calculó la ficha de stock. La diferencia tiene que ser cero.

Está implementado, tiene tests, y **no se llama desde ningún lado en producción**.

Es precisamente un chequeo de inconsistencias que la cátedra pide y que el
sistema no está haciendo. Engancharlo al cálculo y exponer la diferencia sería
barato y encaja con lo que se viene (alertas).

---

## B3 — BAJO: exports muertos

**Backend (14).** Casi todos son tipos derivados de schemas de Zod y helpers
usados solo en tests. Ruido, no riesgo. Los dos que sí importan son B1 y B2.

**Frontend (14).** Acá hay cuatro componentes enteros que no se renderizan en
ningún lado: `EditCompanyModal`, `HistoryTabSection`, `LedgerTabSection`,
`OperatorsSection`. Vale confirmar si es funcionalidad que se sacó y quedó el
archivo, o pantallas que se construyeron y nunca se conectaron — que es el mismo
patrón del botón de Procesos.

También hay hooks sin uso: `useValidateDataPoint`, `useDeleteCostStructure`,
`useRestoreCostStructure`, `useSetAllocationValue`. **`useDeleteCostStructure` y
`useRestoreCostStructure` llaman la atención**: hay soft-delete implementado en
el backend y papelera de estructuras, pero el frontend no la usa.

---

## B4 — COSMÉTICO: parámetros sin usar

Tres handlers de rutas con el parámetro `request` sin usar
(`benchmark.routes.ts:12`, `macro.routes.ts:88`, `vault-proposal.routes.ts:17`).
Inofensivo: es la firma de Fastify.

Nota: `tsconfig.json` no tiene `noUnusedLocals` ni `noUnusedParameters`
activados. Activarlos evitaría que se acumule código muerto, al precio de
arreglar estos tres.

---

## Lo que la simulación verificó que SÍ funciona

Todo esto se ejercitó contra la base real y pasó:

- La compuerta del setup rechaza calcular sin configuración inicial.
- El wizard detecta secuencias con huecos y avisa del desfasaje entre ritmo de
  costeo y de recuento sin bloquear.
- El cálculo de Procesos persiste la corrida con su período, validada, disparador
  `MANUAL`.
- **El job diario completo:** primera corrida no se saltea, nace sin validar y
  sin atribuirle la validación a nadie; la segunda corrida sin cambios se saltea
  por standby; con un dato nuevo vuelve a calcular.
- El resultado vigente devuelve la validada y no la última automática.
- El historial muestra todas por defecto (3) y solo 1 con el filtro.
- Una corrida automática no lleva nombre de persona.
- Validar dos veces no pisa al primero.
- Imputar a un período cerrado **no imputa** y crea la decisión pendiente.
- La bandeja trae las tres opciones, cada una con su consecuencia.
- Reabrir deja el período abierto, incrementa el contador y guarda el motivo.
- Tras el arreglo de A3, la repropagación escribe la existencia inicial del mes
  siguiente.

---

## Recomendación de orden

1. **A1 + A2 juntos** (mismo origen, mismo fix). Sin esto, Costeo por Procesos no
   tiene ciclo de vida: no cierra períodos y por lo tanto no avanza.
2. **A4 y A5**, que son el mismo patrón en dos lugares más y son baratos una vez
   resuelto el despacho.
3. **B2**, que además es un buen cimiento para las alertas.
4. **B1 y B3** cuando haya aire.

A1 es lo que convierte "el módulo de Procesos anda" en "el módulo de Procesos se
puede usar un mes tras otro".
