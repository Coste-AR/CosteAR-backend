# 0007 — La variación presupuesto va al costo del producto; la volumen, al resultado del período

- **Fecha:** 2026-08-20
- **Estado:** Aceptada
- **Decide:** Santiago
- **Contexto de origen:** issue #90, auditoría del motor de cálculo

## Contexto

`cost-statement.ts` iba del costo de producción directo al ajuste por producción en proceso, y
trataba ese número como si fuera el costo real. No lo era. La estructura de la cátedra tiene dos
renglones en el medio:

```
  MP consumida + MOD devengada + CIP aplicados
= COSTO NORMAL DE PRODUCCIÓN DEL PERÍODO
+ Trabajos de terceros (si corresponde)
± Variación presupuesto  (+ pérdida / − ahorro)
= COSTO REAL DE PRODUCCIÓN
```

La clase 28 lo dice con todas las letras: *«normal = MP + MO + CIF aplicados; real = normal +
variación presupuesto»*. Sin ese renglón el estado nunca llega al costo real, y el costo de
productos terminados y el CPV arrastran la diferencia hasta el estado de resultados.

El dato ya estaba calculado: `calcVarianceAnalysis` devuelve `budgetVariance` por centro desde
que existe el motor, y se usaba en la detección de anomalías y en el árbol de trazabilidad. Lo
único que faltaba era incorporarlo al estado de costos.

Este ADR existe sobre todo por el **otro** lado de la decisión: hay una segunda variación, y
mandarla al lugar equivocado es un error clásico que la cátedra marca como *«el punto que más se
olvida»* (clase 26).

## Decisión

- La variación **PRESUPUESTO** entra al estado de costos, entre el costo normal y el real. Es
  costo del producto: lo que costó de más —o de menos— hacer lo que efectivamente se hizo.
- La variación **VOLUMEN** se queda afuera. Va al estado de resultados como pérdida del período,
  porque es capacidad ociosa: una pérdida de la empresa, no un costo del producto. **Que hoy no
  esté en el estado de costos es correcto y no hay que "arreglarlo".**
- El signo se suma tal cual: `budgetVariance = actualCip − budgetAtActual`, así que positivo
  encarece y negativo abarata, sin invertir nada.
- Un centro **pendiente de cierre** aporta cero, porque su variación es cero: sin CIP real no hay
  contra qué comparar. Un período sin cerrar da costo real igual al normal, que es lo correcto.
- **Los trabajos de terceros quedan fuera de este cambio.** Ver abajo.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Sumar la variación presupuesto dentro de `indirectCostsApplied` | Escondería el renglón: el estado mostraría un CIP aplicado que no es el aplicado, y se perdería la distinción entre costo normal y real, que es justamente lo que la cátedra quiere ver separado. |
| Reemplazar `productionCost` por el real y no exponer el normal | Rompe a todos los consumidores actuales y borra un renglón que el estado de costos tiene que mostrar. Se agregan campos nuevos y `productionCost` sigue siendo el normal. |
| Mandar también la variación volumen al costo | Es el error que la cátedra marca como el más frecuente. Cargarle la capacidad ociosa al producto infla el costo unitario y esconde la pérdida por no usar la capacidad instalada, que es justamente la información que el costista necesita ver aparte. |
| Incluir los trabajos de terceros ahora | **No existe en el modelo**: no hay campo, ni ruta, ni formulario. Es una entrada nueva de punta a punta, no una cuenta mal hecha. Meterlo acá era agrandar el issue sin avisar. Queda como gap declarado (`part of #90`). |
| Prorratear la variación presupuesto entre las órdenes, como en el examen de la clase 26 | El motor calcula a nivel PERÍODO, no por orden. El prorrateo por orden es correcto pero pertenece al costeo por órdenes específicas, que hoy no está modelado así. A nivel período, el total es el mismo. |

## Consecuencias

**A favor**

- El estado de costos cumple la estructura que dice implementar, y queda listo para el estado de
  resultados, que es el próximo trabajo planificado.
- La distinción normal/real queda explícita en el resultado (`productionCost`, `budgetVariance`,
  `realProductionCost`), no implícita en un solo número.
- `budgetVariance` deja de ser un dato que se calculaba y no llegaba al costo.

**En contra / lo que aceptamos pagar**

- ⚠️ **El CPV de los períodos con variación presupuesto distinta de cero CAMBIA**, y con él el
  margen bruto. En el caso Dorado son $21.500 más de costo. Es el arreglo, no un efecto
  secundario: antes ese dinero no llegaba al costo del producto. Pero significa que un período
  recalculado no va a dar igual que el mismo período calculado antes de este cambio.
- El renglón de **trabajos de terceros sigue faltando**, así que la estructura todavía no está
  completa. Queda declarado como pendiente en el issue.
- Los dos campos nuevos son opcionales en el tipo de salida. Un cálculo viejo no los tiene, y eso
  es deliberado: decir `budgetVariance: 0` sobre una corrida que nunca la consideró sería afirmar
  que no hubo variación, cuando lo que pasa es que no se midió.

**Qué se rompe si alguien la revierte sin leer esto**

- Si alguien "completa" el estado de costos sumando también la variación volumen, la capacidad
  ociosa pasa a costear el producto: el costo unitario se infla y la pérdida por no usar la
  capacidad instalada desaparece de la vista. Son dos variaciones con dos destinos, no dos
  versiones del mismo número.

## Cómo se verifica que sigue vigente

```bash
npx vitest run tests/application/estado-de-costos-variacion-presupuesto.test.ts
```

Cubre los cuatro criterios de reverificación del issue, los dos signos de la variación, el caso
Dorado end-to-end, que la variación volumen siga afuera, y que un centro pendiente de cierre
aporte cero en vez de una variación fantasma.
