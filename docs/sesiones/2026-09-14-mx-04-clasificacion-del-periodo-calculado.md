# Bitácora — MX-04: la clasificación se resuelve contra el período calculado

Segunda tarea de la **Ola A** del plan de análisis marginal v2. La primera fue `MX-03` (PR #359).

## El bug

`enrichCalculationResult` resolvía la cascada `período → estructura → empresa` contra el período
`OPEN` de la estructura, sin importar qué período se estuviera calculando.

El plan lo describe como «recalcular agosto con septiembre abierto usa la clasificación de
septiembre». Al ir a verificarlo encontré que **es peor de lo que el plan dice**, por dos motivos
que el plan no nombra:

1. **`CostPeriodService.reopen()` reabre un período cerrado sin comprobar que no haya otro
   abierto**, y el schema no tiene `@@unique` sobre `(structureId, status)`. Reabrir agosto con
   septiembre abierto deja **dos** períodos `OPEN`.
2. Ese `findFirst` **no traía `orderBy`**: con dos abiertos, cuál ganaba lo decidía Postgres.

Y el daño no se quedaba en la clasificación: `enrichCalculationResult` **devuelve** ese `periodId`,
y `CalculationRunService` lo usa para **persistir la corrida** y para evaluar la alerta de punto de
equilibrio. La corrida podía quedar atribuida a un período que no era el suyo. Peor todavía:
`DailyRunService.runAll()` recorre todos los períodos abiertos llamando a
`ordersCalc.calculate(userId, structureId, …)` **sin decir cuál** — con dos abiertos, las dos
vueltas resolvían al mismo período arbitrario.

## Qué se hizo

- **`calculation-result-enrichment.ts`** — `enrichCalculationResult` acepta `periodId?`. Si viene,
  se usa y ni siquiera se consulta el período abierto. El fallback ordena por `code: 'desc'`, igual
  que `CostPeriodService.getOpen()`.
- **`calculation-run-service.ts`** — `calculate()` acepta un `periodId` opcional y lo reenvía. Los
  dos sitios que persistían con el período (la corrida y la alerta de PE) pasan a usar el
  **resuelto**, no el parámetro, para no cambiar el comportamiento del camino manual.
- **`daily-run-service.ts`** — el camino de Órdenes pasa `period.id`. El de Procesos ya lo hacía;
  era el único de los dos que adivinaba.
- **`docs/adr/0016`** — la decisión, escrita una sola vez para las dos capas (esta y E1-03).

## Decisiones

- **El fallback se conserva.** Hay dos caminos que legítimamente calculan «la estructura» y no un
  período —el botón manual de Órdenes y la simulación— y ahí el período abierto es el
  comportamiento correcto y documentado, no un error.
- **NO se agregó el motivo de incompletitud que pedía la tarea.** `completo()` marca
  `completo: motivos.length === 0`, así que ese motivo dejaría *toda* corrida manual y *toda*
  simulación en «incompleto»: una regresión, y la propia tarea pide cero regresión. Si igual se
  quiere la señal, tiene que viajar por un campo propio (`contextoResueltoPor`), no por `motivos`.
  Queda anotado en el ADR como pregunta abierta.
- **No se tocó `reopen()`.** Prohibir dos períodos abiertos es un cambio de reglas del dominio
  (reabrir un mes para corregirlo mientras el actual sigue abierto puede ser deseable) y se sale
  del alcance de esta tarea. Queda como pregunta para el equipo en el ADR.

## Verificación

```
npm run typecheck                                            verde
npx eslint <los 3 archivos tocados + el test>                verde
npx vitest run tests/application/clasificacion-periodo-calculado.test.ts
  tests/application/unidad-gestion-resultados.test.ts        5/5 verdes
npx vitest run --exclude 'tests/http/**'                     1559 verdes, 4 skip, 0 rojos
npx vitest run tests/http --no-file-parallelism              20 archivos, 108 verdes
```
