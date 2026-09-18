# 0022 — Un tramo semifijo reemplaza el balde agregado solo si reconcilia su importe

- **Fecha:** 2026-09-15
- **Estado:** Aceptada
- **Contexto de origen:** issue #372, M1-02 del plan de análisis marginal v2

## Contexto

`ConceptoCosteo` clasifica por debajo de los baldes MP/MOD/CIP, pero el motor auditado todavía
entrega a la capa marginal un único importe agregado por elemento. El issue exige que separar un
CIP semifijo en 54.000 fijos y 36.000 variables deje de vaciar el tablero, sin tocar ese motor.

No hay una relación persistida entre cada `ConceptoCosteo` y los conceptos internos de
`IndirectCostConfig`. Afirmar cómo se reparte un balde con varios conceptos sería inventar una
correspondencia que hoy no existe, contrario a Constitución §2 y §9.

## Decisión

`TramoSemifijo` versiona la separación de un `ConceptoCosteo` marcado `SEMIFIJO`, con el método,
las observaciones de base y los derivados matemáticos que permiten auditarla.

La capa marginal usa esa separación para reemplazar el balde agregado únicamente cuando:

1. la cascada período → estructura → empresa resuelve **un solo** concepto semifijo para el
   elemento; y
2. `porcionFija + porcionVariable` coincide al centavo con el importe que el cálculo acaba de
   producir.

Si hay más de un concepto resuelto, falta separación o el importe cambió, no se prorratea ni se
escala: el resultado queda incompleto y explica qué hay que volver a separar. Es la aplicación de
Constitución §2 (ausencia declarada) y §5 (el camino rojo se prueba antes que el verde).

La vista previa y el guardado llaman la misma función pura. `PUNTOS_EXTREMOS` y `CORRELACION`
calculan la separación desde observaciones; `DISPERSION_GRAFICA` y `DECLARADO` conservan las
observaciones y requieren que la persona declare las porciones. Toda corrección crea una fila
nueva y marca la anterior como reemplazada: los importes históricos no se pisan (DOM-01).

## Alternativas descartadas

| Alternativa | Por qué no |
| --- | --- |
| Escalar automáticamente 54/36 cuando el importe del período cambia | Oculta que cambió el hecho observado y convierte una declaración histórica en una regla inventada. |
| Repartir el balde entre varios conceptos por proporción | `ConceptoCosteo` no guarda el importe de cada concepto; cualquier proporción sería arbitraria. |
| Conectar IDs de `IndirectCostConfig` en este PR | Cambia el contrato del motor auditado y amplía M1-02; requiere una tarea propia de identidad de conceptos. |
| Actualizar la misma fila al corregir una separación | Pierde la evidencia con la que se tomó una decisión anterior y viola DOM-01. |

## Consecuencias

- El fixture AM-01 puede producir `cm = 256` con el tramo 54.000/36.000 sin modificar
  `calculate.ts` ni el costeo por absorción.
- Una separación vieja nunca se aplica silenciosamente a un importe nuevo.
- El caso de varios conceptos permanece explícitamente incompleto hasta que el motor conserve su
  identidad o exista una asignación persistida por concepto.
- El frontend dispone de una API de cálculo previo y otra de guardado; su pantalla se implementa
  en el repo de frontend.

## Verificación

- `tests/domain/tramo-semifijo.test.ts`
- `tests/domain/contribucion-marginal.test.ts` (fixture AM-01)
- `tests/application/costo-real-neto.test.ts` (wiring real)
- `tests/http/concepto-costeo.test.ts` (422 y vista previa)
- `tests/integration/concepto-costeo.test.ts` (versionado y RLS)
