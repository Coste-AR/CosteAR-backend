# Bitácora — M2-01: los gastos de no fabricación entran a la contribución marginal

Completa M2-01 (Ola B, plan de análisis marginal v2). Desbloquea M0-02 (dividir costo variable de
producción vs. comercialización), que necesitaba que existiera el concepto "elemento de venta"
en la contribución marginal.

## El problema

`CostElement.VENTA` existe en el schema hace tiempo (`prisma/schema.prisma:1215`) pero nunca
llegaba a `calcularContribucionMarginal`: el punto de equilibrio que muestra el tablero del dueño
es un equilibrio de **producción**, no de la **empresa** — le faltan enteros los gastos de
administración y de comercialización. Con el fixture canónico del plan, el PE sube de 475,52 a
750 unidades (**57,7 %**) al incorporarlos: es la medida de cuánto le mentía el número al dueño.

## Qué se hizo

- **Migración** (`20260915161658_gastos_no_fabricacion_periodo`) — `CostPeriod` suma
  `gastoVariableComercializacionPorUnidad` y `gastoFijoAdministracion` (`Decimal(18,4)`, default
  0). Aditiva, DOM-06. Solo en `CostPeriod`, sin mirror en `CostStructure` — ver ADR 0020.
- **`contribucion-marginal.ts`** — `ComponenteAbsorcion.comportamientoVolumenForzado?`: un
  componente puede llegar YA clasificado, saltando la cascada de `ParametroCosteo` por completo
  (ni necesita fila, y una fila real no lo puede pisar). Nuevas claves
  `gastosComercializacion`/`gastosAdministracion`.
- **`calculation-result-enrichment.ts`** — lee `gastoVariableComercializacionPorUnidad`/
  `gastoFijoAdministracion` **directamente del período resuelto** (mismo `periodId` que ya
  resuelve MX-04), no de un argumento que el llamador tenga que pasar — así ningún caller nuevo
  puede olvidarse de cablearlos (ver el hallazgo de abajo). Construye 2 componentes forzados:
  comercialización (VARIABLE, `gastoVariable × unidadesVendidas`) y administración (FIJO, directo).
- **`CostPeriodService.setGastosDeNoFabricacion`** + **`PUT /periods/:id/gastos-no-fabricacion`**
  — persistencia real, mismo patrón que `updateThirdPartyWork` (bitácora en la misma transacción,
  DOM-02; rechaza un período cerrado).
- **ADR 0020** — por qué solo en `CostPeriod`, por qué clasificación forzada en vez de cascada, y
  por qué no tocan `CalculationInput`/`calculate.ts`.

## El hallazgo: `thirdPartyWork` nunca llega al cálculo real

Al diseñar cómo iba a leer los gastos de no fabricación, encontré que **`CalculationRunService.calculate()`**
— el método que realmente alimenta el tablero del dueño vía `CalculationRun`/`enrichCalculationResult`
— **nunca lee `thirdPartyWork`** de la base, pese a que existe la columna y un endpoint para
cargarlo (#90). Es OTRO método (`CostStructureService.calculate()`, que persiste en una tabla
distinta y no llega al tablero) el que sí lo lee. Cargar trabajos de terceros desde el panel hoy
**no mueve ningún número que el dueño ve**.

Es un bug preexistente, no algo que esta sesión causó. **No lo arreglé** — está fuera del scope de
M2-01 (GR-02, "no ampliar el scope sin avisar") — lo dejé documentado en **issue #367** y en el
ADR 0020. Sí diseñé los 2 campos nuevos de M2-01 para que este mismo agujero no les pase: se leen
automáticamente dentro de `enrichCalculationResult`, no dependen de que un caller se acuerde.

## Decisiones

- **Clasificación forzada, no `propuesta`.** Ya se había decidido (ADR 0018) no usar el mecanismo
  `propuesta` de `parametros-costeo.ts` para M0-01 por falta de precedente de uso real. Para
  comercialización/administración hay una razón adicional: no hay ninguna ambigüedad que resolver
  con juicio humano (a diferencia de la amortización) — son fijo/variable por definición.
- **Sin dedicado split `costoVariableUnitarioProduccion`/`costoVariableUnitarioComercializacion`.**
  El plan lo pedía como parte de M2-01, pero construirlo ahora sería trabajo que M0-02 va a
  restructurar de todas formas (M0-02 es exactamente "separar el costo variable por elemento").
  Con M0-02 sin implementar, todo sigue dividiendo por vendidas (comportamiento actual, no una
  regresión nueva) — el split queda para cuando M0-02 se implemente.

## Fuera de alcance

- M0-02 (dividir cv de producción ÷producidas vs. comercialización ÷vendidas) — ahora SÍ
  desbloqueada (el concepto "elemento de venta" ya existe), queda para una tarea aparte.
- Issue #367 (`thirdPartyWork` desconectado) — documentado, no corregido.
- El control de suma de M0-01 (`totalEsperado`) no está en esta rama (M0-01 no mergeado aún) — al
  mergear los dos, hay que sumar `gastoFijoAdministracion + gastoVariable×vendidas` al
  `totalEsperado` para que siga reconciliando (verificado a mano contra el fixture del plan:
  350.000 + 80.000 = 430.000, coincide con el criterio de aceptación del plan).

## Verificación

```
npx prisma migrate deploy (via npm run prisma:migrate)          aplicada, aditiva
npm run typecheck                                               verde
npx eslint <8 archivos tocados>                                 verde
tests/domain/contribucion-marginal.test.ts (forzado)            6/6 verdes
tests/application/gastos-no-fabricacion.test.ts                 4/4 verdes (fixture AM-01: PE 300→682,35)
tests/application/gastos-no-fabricacion-service.test.ts         2/2 verdes
tests/http/gastos-no-fabricacion.test.ts                        2/2 verdes
tests/application/clasificacion-periodo-calculado.test.ts       3/3 verdes (assertion de MX-04 actualizada,
                                                                  ver nota abajo)
npx vitest run --exclude 'tests/http/**'                        1569 verdes, 4 skip, 0 rojos
npx vitest run tests/http --no-file-parallelism                 21 archivos, 113 verdes
tests/integration/contribucion-marginal.test.ts                 2/2 verdes (contra Postgres real,
                                                                  migración aplicada)
```

**Nota sobre `clasificacion-periodo-calculado.test.ts` (MX-04):** su aserción `not.toHaveBeenCalled()`
en "usa el período que se está calculando" asumía que con `periodId` explícito nunca se consulta
`costPeriod`. Ahora sí se consulta —por `id`, para leer los gastos de no fabricación— así que la
aserción se corrigió a verificar la FORMA del query (`where: { id }`, no `where: { status: 'OPEN' }`)
en vez de si se llama. El comportamiento que MX-04 protege (no adivinar el período abierto cuando
ya se sabe cuál es) sigue intacto y sigue probado.
