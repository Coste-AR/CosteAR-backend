# 0021 — `ConceptoCosteo` clasifica por debajo de los tres baldes, sin reemplazarlos

- **Fecha:** 2026-09-15
- **Estado:** Aceptada
- **Decide:** Equipo (implementado por Claude Code, a pedido de Giuliana)
- **Contexto de origen:** M1-01 del plan de análisis marginal v2 (`CosteAR-admin/docs/plans/2026-09-07-analisis-marginal-v2.md`, §7.1), issue #370

## Contexto

`ParametroCosteo.comportamientoVolumen` clasifica el comportamiento frente al volumen con tres
claves fijas: `comportamiento_materia_prima`, `comportamiento_mano_obra_directa`,
`comportamiento_costos_indirectos`. Es un balde por elemento del motor (MP, MOD, CIP), y cada
balde es una sola etiqueta.

Un CIP real no es una sola cosa: mezcla energía (variable con el volumen), depreciación de
maquinaria (fija) y a veces un servicio contratado (fijo por contrato, no por causa de tiempo). Con
un solo balde por CIP, alguien tiene que elegir una etiqueta para las tres, y el número que sale es
un promedio de comportamientos distintos disfrazado de clasificación.

El corpus de la bóveda (R4, R5, R6, R7, R8, R19, R25) exige información que el balde no puede
cargar porque no tiene dónde:

- **R4** — la clasificación fijo/variable se define por **causalidad**, no por variabilidad
  observada. El balde no registra la causa, solo la etiqueta.
- **R5** — todo costo declarado fijo debe declarar el **rango de actividad** dentro del cual esa
  afirmación vale. El balde no tiene rango.
- **R6** — la amortización es fija si la causa es el tiempo, variable si la causa es la intensidad
  de uso. Sin campo de causa, esta regla no se puede codificar — solo se puede prohibir un caso
  (que es lo que hizo M0-01/ADR 0018 mientras tanto).
- **R7** — erogable/no erogable depende del horizonte del análisis. El balde no tiene horizonte.
- **R8** — ningún costo fijo entra al costo variable por una cuota de aplicación.
- **R19** — los fijos indirectos **evitables** van en fila propia del estado de resultados, antes
  de los inevitables. El balde no distingue evitable de inevitable.
- **R25** — en fabricar-vs-comprar, el numerador es el fijo evitable, no el total.

Ninguna de estas siete reglas se puede codificar mientras la unidad de clasificación sea "todo el
CIP de la empresa". Hace falta bajar un nivel: de balde a **concepto**.

## Decisión

Se crea `ConceptoCosteo`: una fila por concepto (`clave` libre, en `snake_case`, definida por el
cliente o el onboarding — no un catálogo fijo del código), con `elemento` (MP/MOD/CIP/VENTA) que
la ancla al balde que reemplaza para ese concepto puntual, y los cuatro campos nuevos que las siete
reglas de arriba necesitan: `causaVariabilidad`, `rangoActividadDesde/Hasta`,
`horizonteErogableMeses`, `evitable`.

La cascada de resolución es **exactamente la misma** que `ParametroCosteo`: período → estructura →
empresa, con `origen` expuesto en el resultado. La diferencia real es que `ConceptoCosteo` no tiene
un catálogo de defaults al final de la cascada — sin ninguna fila para una clave, la resolución
devuelve `null`, no un default inventado. Un concepto nace porque alguien lo creó, nunca porque el
sistema lo propuso.

**Los tres baldes se conservan como caso degenerado, no se reemplazan.** Una empresa que nunca
cargó ningún `ConceptoCosteo` sigue clasificando por balde, exactamente como hoy. La regla de
resolución (para cuando el resto del motor empiece a consumir esto) es: *si hay `ConceptoCosteo`
para ese elemento, mandan los conceptos; si no hay ninguno, manda el balde.* Es la misma relación
que existe hoy entre "un valor cargado" y "el default del catálogo" en `resolverParametro`, un
nivel más abajo.

**Validación dura, no opcional (R4/R8 hechos código):** un `ConceptoCosteo` con
`comportamientoVolumen = VARIABLE` y `causaVariabilidad` distinta de `'volumen'` es rechazado con
422. Es la misma regla que `ADR 0018` aplicó a la amortización dentro de `ParametroCosteo`, ahora
generalizada a cualquier concepto: la clasificación por causalidad deja de ser una convención que
alguien puede pasar por alto y pasa a ser una restricción que el sistema hace cumplir.

### Lo que esta tarea explícitamente NO hace

**`ConceptoCosteo` no está conectado al motor de cálculo.** Hoy se puede crear, clasificar,
resolver por cascada y borrar — y ningún número del tablero cambia por eso. Es una decisión de
alcance, no un olvido, por dos razones:

1. **El motor no conserva identidad de concepto hasta el final.** `calculation-result-enrichment.ts`
   recibe importes ya agregados por elemento (`indirectCostsApplied`, un solo número). Para que un
   concepto "mande sobre el balde" en la contribución marginal, la asignación de costos indirectos
   (`indirect-costs.ts`) tendría que exponer el desglose por concepto hasta ese punto, y hoy no lo
   hace. Cablear eso es un cambio de otro tamaño, no una extensión de M1-01.
2. **`M1-02` (`TramoSemifijo`) y `M1-03` (zona de equilibrio con clasificación incompleta)** — las
   dos siguientes tareas de la Ola B — dependen de que el modelo de `ConceptoCosteo` ya exista,
   pero construyen sobre él, no lo consumen desde el motor de cálculo actual. Intentar las dos
   cosas en el mismo PR (modelo + wiring del motor) habría sido ampliar el scope de M1-01 sin
   avisar (regla GR-02 de `CLAUDE.md`).

Los criterios de aceptación 3 y 4 del issue original (`horizonteErogableMeses` afectando el punto
de cierre; `evitable` afectando el numerador de fabricar-vs-comprar) **no se verifican en este
PR**: son responsabilidad de `M3-03` y `M6-01` respectivamente, que sí van a leer `ConceptoCosteo`
para esas fórmulas puntuales. Este PR entrega el modelo, la cascada y la validación; deja el rango
de actividad y la evitabilidad disponibles para cuando esas tareas los necesiten.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Agregar los campos nuevos (`causaVariabilidad`, `evitable`, etc.) directamente a `ParametroCosteo` | `ParametroCosteo` resuelve por clave fija de un catálogo cerrado (tres claves de comportamiento). Agregarle campos no resuelve el problema real, que es que el CIP necesita **más de una fila** por empresa — seguiría habiendo una sola etiqueta para todo el CIP. |
| Reemplazar los tres baldes por completo, migrando `ParametroCosteo.comportamientoVolumen` a `ConceptoCosteo` | Rompe la compatibilidad hacia atrás explícita del plan ("una empresa sin ningún `ConceptoCosteo` resuelve exactamente como hoy") y obliga a migrar datos de producción del único cliente real en el mismo PR que introduce el modelo. Innecesariamente arriesgado para una tarea que ya es XL. |
| Conectar `ConceptoCosteo` al motor de cálculo en este mismo PR (que los conceptos ya manden sobre los baldes en la contribución marginal) | Requiere que `indirect-costs.ts` exponga el desglose por concepto hasta `calculation-result-enrichment.ts`, un cambio de arquitectura del motor que no es parte de "crear el modelo". Se deja para una tarea futura, una vez que M1-02/M1-03 (que si consumen el modelo) estén encaminadas y se entienda mejor qué forma necesita ese desglose. |

## Consecuencias

**A favor**

- R4, R5, R6, R7, R8, R19 y R25 ahora tienen un campo del modelo donde vivir; hoy solo R6/R8
  tenían un parche puntual (ADR 0018).
- Cero riesgo para el cliente en producción: la migración no crea filas, y nada que lea
  `ParametroCosteo` hoy cambia de comportamiento.
- `M1-02` y `M1-03` pueden empezar apenas este PR mergee.

**En contra / lo que aceptamos pagar**

- `ConceptoCosteo` existe y no hace nada todavía — es infraestructura sin consumidor hasta que
  alguna tarea futura conecte el motor. Riesgo real: que quede así más de lo planeado y se vuelva
  un modelo fantasma.
- Dos sistemas de clasificación conviven (balde y concepto) con una regla de precedencia que hoy
  no está codificada en ningún lugar del motor — solo declarada acá y en el plan.

**Qué se rompe si alguien la revierte sin leer esto**

- Si alguien reemplaza los tres baldes por `ConceptoCosteo` sin resolver primero el desglose por
  concepto en `indirect-costs.ts`, la contribución marginal pierde la capacidad de clasificar el
  CIP agregado — quedaría sin ningún nivel de clasificación posible para las empresas que todavía
  no desagregaron.
- Si alguien quita la validación 422 de `causaVariabilidad`, vuelve a ser posible repetir el error
  de la amortización (`AM17`) en cualquier concepto nuevo, no solo en la clave vieja que
  `ADR 0018` protegía.

## Cómo se verifica que sigue vigente

- `tests/domain/concepto-costeo.test.ts` — la cascada resuelve período → estructura → empresa, y
  sin filas devuelve `null` (no un default inventado).
- `tests/application/concepto-costeo-service.test.ts` — el 422 de R4/R8 corta ANTES de escribir
  (protege contra el patrón del issue #98: una validación construida y nunca enchufada).
- `tests/integration/concepto-costeo.test.ts` — contra Postgres real: la empresa B no ve ni puede
  tocar los conceptos de la empresa A (RLS), y una empresa sin ningún `ConceptoCosteo` no rompe
  nada.
- `tests/config/rls-coverage.test.ts` — `ConceptoCosteo` sigue en `RLS_MODELS` (`prisma.ts`) y en
  `prisma/rls.sql` a la vez; si alguno de los dos se desincroniza, este test se pone en rojo.
