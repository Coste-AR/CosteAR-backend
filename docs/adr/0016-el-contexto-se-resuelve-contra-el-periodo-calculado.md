# 0016 — El contexto de configuración se resuelve contra el período que se calcula, no contra el abierto

- **Fecha:** 2026-09-14
- **Estado:** Aceptada
- **Decide:** Giuliana (sesión de Claude)
- **Contexto de origen:** MX-04 del plan de análisis marginal v2 (`CosteAR-admin`); mismo modo de
  falla que el hallazgo **E1-03** de la auditoría E2E del 06-09-2026

## Contexto

`enrichCalculationResult` resolvía la cascada de clasificación de comportamiento
(`período → estructura → empresa`, `resolverComportamiento`) contra el período con
`status: 'OPEN'` de la estructura — **sin importar qué período se estuviera calculando**:

```ts
db.costPeriod.findFirst({ where: { structureId, status: 'OPEN', deletedAt: null } })
```

Mientras haya un solo período abierto por estructura, eso coincide con el período que se calcula y
nadie lo nota. Dos cosas rompen esa coincidencia, y las dos son alcanzables hoy:

1. **`CostPeriodService.reopen()` reabre un período cerrado sin comprobar que no haya otro
   abierto**, y `prisma/schema.prisma` no tiene ningún `@@unique` sobre `(structureId, status)`
   que lo impida. Reabrir agosto con septiembre abierto deja la estructura con dos períodos `OPEN`.
2. Ese `findFirst` **no traía `orderBy`**: con dos abiertos, cuál devolvía lo decidía el plan de
   ejecución de Postgres.

El daño no era solo la clasificación. `enrichCalculationResult` **devuelve** ese `periodId` y
`CalculationRunService` lo usa para persistir la corrida y para evaluar la alerta de punto de
equilibrio. O sea que la corrida podía quedar atribuida a un período distinto del que la originó.
Y `DailyRunService.runAll()` recorre **todos** los períodos abiertos llamando a
`ordersCalc.calculate(userId, structureId, …)` sin decir cuál: con dos abiertos, las dos vueltas
resolvían al mismo período arbitrario.

Es exactamente el hallazgo **E1-03** del 06-09 —los formularios leían el config vivo de la
estructura en vez del config del período seleccionado— en otra capa. Por eso conviene que la
decisión quede escrita una sola vez para las dos.

## Decisión

**Quien conoce su período lo pasa explícito; el fallback al período abierto se conserva, acotado y
determinista.**

- `enrichCalculationResult` acepta `periodId?: string | null`. Si viene, se usa y **no se consulta**
  el período abierto.
- `CalculationRunService.calculate` acepta un `periodId` opcional y lo reenvía.
- `DailyRunService` lo pasa siempre: recorre períodos, así que sabe cuál está calculando. (El
  camino de Procesos ya lo hacía; el de Órdenes era el que faltaba.)
- El fallback queda para los dos caminos que legítimamente calculan *la estructura* y no un
  período —el botón manual de Órdenes y la simulación— y ahora ordena por `code: 'desc'`, igual que
  `CostPeriodService.getOpen()`, para que con dos abiertos elija siempre el más nuevo.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Hacer `periodId` obligatorio | Los dos caminos de «calcular la estructura» no tienen período que pasar. Obligarlos los forzaría a inventar uno — que es el problema que se quiere evitar. |
| Prohibir dos períodos abiertos (`@@unique` o guarda en `reopen`) | Ataca una de las dos causas y es un cambio de reglas del dominio: reabrir un período cerrado para corregirlo mientras el mes en curso sigue abierto puede ser deseable. Se deja anotado como pregunta para el equipo, no se decide acá. |
| Sumar un motivo de incompletitud cuando se usa el fallback (lo que pedía la tarea) | **Sería una regresión.** `completo()` marca `completo: motivos.length === 0`, así que ese motivo dejaría *toda* corrida manual y *toda* simulación en «incompleto» — y en esos caminos el período abierto no es un error, es el comportamiento correcto y documentado. Ver «Lo que quedó abierto». |

## Consecuencias

**A favor**

- Recalcular un período cerrado (o uno de dos abiertos) usa **su** clasificación.
- La corrida se persiste contra el período que efectivamente la originó.
- El fallback dejó de ser no determinista.

**En contra / lo que aceptamos pagar**

- `calculate()` gana un quinto parámetro posicional opcional. Si aparece un sexto, conviene pasar a
  un objeto de opciones.
- Siguen pudiendo existir dos períodos abiertos: esto hace que elegir entre ellos sea predecible,
  no lo impide.

**Qué se rompe si alguien la revierte sin leer esto**

- Volver a resolver el contexto contra el período abierto reintroduce E1-03 en la capa de cálculo,
  y encima de forma silenciosa: los números salen, solo que con la clasificación de otro mes.

## Cómo se verifica que sigue vigente

`tests/application/clasificacion-periodo-calculado.test.ts`: con agosto clasificando los CIP como
`FIJO` y septiembre como `VARIABLE`, calcular agosto devuelve `FIJO` y `parametroId` de la fila de
agosto; sin período explícito sigue resolviendo contra el abierto; y el fallback consulta con
`orderBy: { code: 'desc' }`.

## Lo que quedó abierto (para el equipo)

1. **¿Se permite más de un período abierto por estructura?** Si la respuesta es que no, el arreglo
   de fondo es una guarda en `reopen()` más un `@@unique`, y este fallback deja de importar.
2. La tarea original pedía además marcar la corrida cuando usa el fallback. No se hizo, por la
   regresión explicada arriba. Si igual se quiere la señal, tiene que viajar por un campo propio
   (`contextoResueltoPor: 'explicito' | 'periodo-abierto'`), no por `motivos`.
