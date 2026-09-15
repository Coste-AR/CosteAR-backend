# Anexo de diferencias — qué cambia de las fichas AUD-04a y AUD-05

Las fichas originales viven en `docs/auditorias/AUD-2026-09-14/03-backend.md` y **no se editan**
(regla de la skill: lo que resistió la verificación queda con su numeración original; las
diferencias se documentan aparte). Esto es ese aparte.

## `AUD-2026-09-14-04a` — La conversión entre unidades se modela como factor decimal

**Lo que sigue exactamente igual:** severidad (🔴 CRÍTICO), diagnóstico de causa raíz (`Decimal`
insuficiente para razones periódicas), camino de remediación propuesto (razón entera en vez de
multiplicador decimal, reusar el patrón de `UnidadMedida.factor`).

**Lo que se agrega:**
1. **El experimento controlado del PASO 1 confirma el diagnóstico sin ambigüedad** — no es una
   sola reproducción, es un experimento con control positivo (1/50, carga) y negativo (1/360,
   falla) sobre el mismo código en la misma sesión. Ver `01-paso1-experimento.md`.
2. **El "camino de remediación puntual" ya no es una hipótesis — es un hecho demostrado.** Con un
   factor exacto (1/50), el motor completo (cuadro de unidades, producción equivalente, CAUP,
   existencia final, arrastre entre períodos, cierre de 4 meses en secuencia) funciona de punta a
   punta sin ningún ajuste ni contaminación. `AUD-2026-09-14` solo había podido cargar M1 con un
   workaround; esta sesión cargó M1-M4 completos, limpios. Esto **no** prueba que arreglar `04a`
   (cambiar la representación del factor) vaya a andar solo — prueba que el resto del motor NO
   necesita tocarse para que ande, que es lo que decía el diagnóstico original.
3. **`04a` tiene ahora una segunda expresión, con menos tolerancia:** `AUD-2026-09-15-01`
   (`normalLossPct` en `Decimal(9,4)`) es la MISMA familia de defecto (columna `Decimal`
   insuficiente para una razón real del dominio) en un campo distinto, con un chequeo interno que
   tiene **cero tolerancia** en vez de la tolerancia insuficiente de `04b`. El camino de
   remediación de `04a` (razón entera / representación exacta) **no cubre este segundo caso** —
   son campos y validaciones distintos — pero el principio de fondo (no modelar razones del
   dominio real como `Decimal` de pocos decimales) aplica a los dos. Ver `02-paso2-fxavb.md`.

**Estado de las 9 filas "NO VERIFICADO" de la tabla de `AUD-2026-09-14-04a` §4:** siguen NO
VERIFICADAS para la cadena Granja→Fraccionadora específicamente (esta sesión no cargó esa
cadena, cargó `FX-AV-B`). Lo que sí cambia: ya no hace falta preguntarse si el motor en sí está
sano para esos 9 números — esta sesión lo confirma para una cadena análoga con factor exacto. Una
vez arreglado `04a`, cargar Granja→Fraccionadora con los valores reales (750, no 750,06) debería
dar exactamente las 9 cifras del fixture, sin sorpresas nuevas.

## `AUD-2026-09-14-05` — Un período cerrado resuelve su clasificación contra el valor vigente

**Lo que sigue exactamente igual:** severidad (🔴 CRÍTICO), mecanismo (`resolverComportamiento`
lee la fila `periodId: null` en vivo, sin ninguna foto congelada al cerrar).

**Lo que se agrega y AGRAVA el diagnóstico original:**

1. **El problema no es solo de clasificación — es de TODO el contenido de un período cerrado.**
   `AUD-2026-09-15-02` (PASO 3.C) prueba que ni siquiera hace falta la ruta de clasificación
   empresa-wide para cambiarle el pasado a un período cerrado: un `PUT` directo al cuadro de
   movimiento de un período `CLOSED` se acepta y persiste en silencio, sin pasar por ninguna
   reclasificación. **El camino de remediación que proponía la ficha original ("congelar la
   clasificación resuelta al cerrar") sigue siendo necesario, pero ya no alcanza**: hace falta
   además que el propio `UnitMovementService.save()` (o el nivel de servicio que corresponda)
   rechace escrituras sobre un período con `status: CLOSED`, no solo congelar qué clasificación
   usa el cálculo.
2. **El mecanismo de "resultado informado no se mueve" se confirma, a nivel de identidad de la
   corrida** (PASO 3.D): el `CalculationRun` que quedó congelado al cerrar (`corrida.id`) es
   idéntico antes y después de una reclasificación empresa-wide — coherente con lo que decía el
   fixture (`RESULTADO INFORMADO: NO SE MUEVE`). **La magnitud exacta en pesos que pedía el
   PASO 3.D (`cm $30.000→$27.333,33`, etc.) queda NO VERIFICADA** — no había, en esta sesión, una
   estructura a la escala del fixture con ventas configuradas. Es una limitación declarada, no una
   duda sobre el mecanismo.
3. **Nuevo hallazgo relacionado pero DISTINTO: la reapertura en cascada** (`AUD-2026-09-15-03`,
   PASO 3.B). Incluso si `AUD-05` se arreglara mañana (congelando la clasificación Y bloqueando la
   edición de un período cerrado), **el problema de que reabrir un período viejo deja a los
   posteriores con una existencia inicial vieja, en silencio, seguiría existiendo** — es un defecto
   de la mecánica general de apertura/cierre/arrastre, no de la capa de clasificación fijo/
   variable. Los dos hallazgos comparten síntoma ("un período cerrado no está tan cerrado como
   parece") pero tienen causas y remedios distintos: uno es "qué clasificación lee el cálculo",
   el otro es "qué pasa con el cuadro de unidades cuando el predecesor cambia".

**Resumen de la cadena de remediación necesaria para "un período cerrado esté realmente
protegido"** (no existía como lista única antes de esta sesión):
1. Congelar la clasificación resuelta al cerrar (ficha original de `AUD-05`).
2. Bloquear/controlar la escritura directa sobre el cuadro de movimiento de un período `CLOSED`
   (`AUD-2026-09-15-02`).
3. Re-ejecutar (o invalidar visiblemente) el arrastre hacia adelante cuando se reabre y edita un
   período que tiene sucesores ya cerrados (`AUD-2026-09-15-03`).

Ninguno de los tres, solo, cierra el problema completo.
