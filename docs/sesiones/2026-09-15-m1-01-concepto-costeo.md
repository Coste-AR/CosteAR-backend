# Bitácora — M1-01: `ConceptoCosteo`, la clasificación baja de balde a concepto

Completa M1-01 (Ola B, plan de análisis marginal v2). Desbloquea M1-02 (`TramoSemifijo`) y M1-03
(zona de equilibrio con clasificación incompleta), que ya quedaron como issues (#372, #373)
esperando este merge.

## El problema

`ParametroCosteo.comportamientoVolumen` clasifica frente al volumen con tres claves fijas: MP,
MOD, CIP. Un CIP real mezcla energía (variable) con depreciación (fija) — con un solo balde por
CIP, hay que elegir una etiqueta para las dos. Siete reglas duras del corpus (R4, R5, R6, R7, R8,
R19, R25) necesitan información que el balde no tiene dónde guardar: la causa de la variabilidad,
el rango de actividad donde "fijo" vale, el horizonte del análisis, si el fijo es evitable.

## Qué se hizo

- **Modelo `ConceptoCosteo`** (`prisma/schema.prisma`): una fila por concepto, `clave` libre (no
  un catálogo cerrado como `ParametroCosteo`), con los cuatro campos que la v1 del plan no tenía:
  `causaVariabilidad`, `rangoActividadDesde/Hasta`, `horizonteErogableMeses`, `evitable`. Migración
  puramente aditiva, no crea filas.
- **RLS**: política en `rls.sql` + registro en `RLS_MODELS` (`prisma.ts`), mismo patrón que
  `ParametroCosteo`. Verificado contra Postgres real con dos inquilinos.
- **`src/domain/parametros/concepto-costeo.ts`** — `resolverConceptoCosteo`: cascada período →
  estructura → empresa, idéntica a `resolverComportamiento`. Diferencia real: sin filas para una
  clave, devuelve `null` — no hay catálogo de defaults al final, porque un concepto lo crea el
  cliente, nunca el sistema. `violaCausalidadDeVolumen`: R4/R8 como función pura.
- **`src/application/parametros/concepto-costeo-service.ts`** — CRUD completo (`crear`,
  `listar`, `actualizar`, `eliminar`), con la validación 422 enchufada en `crear` y en
  `actualizar` (probado que corta ANTES de escribir, issue #98).
- **Rutas HTTP** (`concepto-costeo.routes.ts`): `GET/POST /companies/:companyId/conceptos-costeo`,
  `PUT/DELETE .../conceptos-costeo/:id`.
- **ADR 0021** — por qué la clasificación baja a concepto, por qué los tres baldes se conservan
  como caso degenerado, y por qué esta tarea explícitamente NO conecta los conceptos al motor de
  cálculo (esa parte queda para cuando `M1-02`/`M1-03` u otra tarea posterior lo necesiten: el
  motor hoy no conserva identidad de concepto hasta `calculation-result-enrichment.ts`).

## El hallazgo: los criterios de aceptación 3 y 4 del issue no se pueden probar todavía

El issue original pedía verificar que `horizonteErogableMeses` afecte el punto de cierre y que
`evitable` afecte el numerador de fabricar-vs-comprar. Ninguna de las dos funciones existe
todavía — son `M3-03` y `M6-01`, tareas futuras de la Ola C. Documenté esto en el ADR en vez de
simular el criterio con un test que no prueba nada real: el modelo deja los campos disponibles,
pero afirmarlos "cumplidos" acá hubiera sido inventar una verificación.

## Decisiones

- **No se conecta `ConceptoCosteo` al motor de cálculo en este PR.** Es una decisión de alcance
  explícita (ver ADR 0021), no un olvido: el desglose por concepto de CIP no sobrevive la
  asignación de costos indirectos hasta `enrichCalculationResult` hoy, y cablearlo es un cambio de
  otro tamaño.
- **`clave` es texto libre en `snake_case`**, a diferencia del catálogo cerrado de
  `ParametroCosteo` — cada empresa desagrega sus propios conceptos.
- **Crear un concepto es siempre una declaración explícita**: a diferencia de `ParametroCosteo`
  (que tiene semillas propuestas por el sistema), `ConceptoCosteo` no tiene default — todo lo que
  existe lo creó una persona, así que `clasificadoPorUserId`/`clasificadoEn` se completan siempre.

## Verificación

```
npm run typecheck                                                verde
npm run lint                                                     verde
tests/domain/concepto-costeo.test.ts                             11/11 verdes
tests/application/concepto-costeo-service.test.ts                13/13 verdes
tests/http/concepto-costeo.test.ts                                7/7 verdes
tests/config/rls-coverage.test.ts                                  7/7 verdes
npx vitest run --exclude 'tests/http/**'                         1606 verdes, 4 skip, 0 rojos
npx vitest run tests/http --no-file-parallelism                   122 verdes (22 archivos)
test:integration tests/integration/concepto-costeo.test.ts         5/5 verdes (Postgres real: RLS
                                                                    cruzado entre dos inquilinos,
                                                                    cascada real, 422 real)
```
