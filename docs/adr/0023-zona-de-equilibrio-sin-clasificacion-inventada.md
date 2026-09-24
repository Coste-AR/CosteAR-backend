# 0023 — La zona de equilibrio acota la clasificación sin inventarla

- **Fecha:** 2026-09-15
- **Estado:** Aceptada
- **Contexto de origen:** issue #373, M1-03 del plan de análisis marginal v2

## Contexto

Hasta ahora una contribución marginal incompleta dejaba el punto de equilibrio en blanco. Eso es
correcto cuando faltan ventas, precio o cierra mal el control de suma, pero pierde información
cuando el único dato pendiente es decidir si uno o más importes ya medidos son fijos o variables.

El motor auditado todavía conserva esos importes por componente agregado (MP, MOD, CIP y los
renglones adicionales), no la identidad ni el importe de cada `ConceptoCosteo`. Por eso no existe
base para repartir, por ejemplo, un CIP agregado entre varios conceptos cargados por el usuario.

## Decisión

`calcularPuntoEquilibrio` devuelve tres resultados distinguibles:

- `tipo: 'punto'` cuando la clasificación está completa, incluso si el punto no existe por
  contribución marginal no positiva;
- `tipo: 'zona'` cuando el único faltante es la clasificación fijo/variable de componentes con
  importe conocido;
- `incompleta: true` cuando la zona no se puede acotar (sin ventas, sin precio, con un semifijo no
  separado o con cualquier otro control pendiente).

La zona aplica R13 literalmente: todos los no clasificados como variables producen `qMin`, y todos
como fijos producen `qMax`. Los costos variables de producción conservan el divisor de unidades
producidas y los de venta, el de unidades vendidas.

`aporteAlAncho` se atribuye pasando los componentes, ordenados por clave, del extremo variable al
fijo. Cada aporte es la diferencia contra el paso anterior. El orden estable vuelve auditable el
número y hace que la suma de los aportes coincida exactamente con el ancho total.

La API conserva `unidadesEquilibrio: null` en una zona para que ningún consumidor viejo pueda
confundirla con un punto. `qMin`, `qMax` y cada `aporteAlAncho` se convierten juntos a la unidad de
gestión; `importe` sigue siendo el total monetario observado.

## Alternativas descartadas

| Alternativa | Por qué no |
| --- | --- |
| Elegir fijo o variable por defecto | Inventaría una decisión económica y volvería a mostrar precisión falsa. |
| Mostrar el subtotal conocido como punto | Oculta dinero no clasificado; es el error que R13 prohíbe. |
| Repartir el balde entre varios `ConceptoCosteo` | El motor no conserva sus importes individuales; cualquier proporción sería arbitraria. |
| Devolver zona aun con otro control pendiente | Mezclaría incertidumbre acotable con ausencia de datos que puede volver inválidos ambos extremos. |

## Consecuencias

- AM-07 informa `[709,09; 793,55]`, nombra CIP por 90.000 y contiene el punto verdadero 750.
- Una clasificación completa sigue dando `tipo: 'punto'` y 750 exacto.
- El tablero del dueño publica el intervalo como resultado completo, con `valor: null`; nunca
  reduce la zona a un único número.
- Desagregar un balde entre varios conceptos seguirá requiriendo que el motor preserve su identidad
  o que exista una asignación persistida y auditable; este ADR no inventa ese puente.

## Verificación

- `tests/domain/punto-equilibrio.test.ts`
- `tests/application/unidad-gestion-resultados.test.ts`
- `tests/http/owner-dashboard.test.ts`
