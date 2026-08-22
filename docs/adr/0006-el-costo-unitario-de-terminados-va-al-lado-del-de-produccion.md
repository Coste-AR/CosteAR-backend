# 0006 — Exponer el costo unitario de terminados al lado del de producción, sin cambiar el segundo

- **Fecha:** 2026-08-20
- **Estado:** Aceptada
- **Decide:** Santiago
- **Contexto de origen:** issue #89, auditoría del motor de cálculo

## Contexto

El issue reporta que `detail.unitCost.unitProductionCost` no se mueve ni un centavo cuando se
carga producción en proceso, y propone arreglarlo cambiando el numerador: dividir el **costo de
productos terminados** en vez del **costo de producción del período**.

El síntoma es real y grave —un período donde parte del trabajo quedó a medio hacer daba
exactamente el mismo costo unitario que uno donde se terminó todo—, pero el arreglo propuesto
contradice a la cátedra. En la práctica resuelta de la clase 2 de Mirta, el estado de costos
tiene los dos renglones, en este orden:

```
  MP consumida + MOD devengada + CIP aplicados
= Costo de producción                       $2.306.000
  Costo unitario de producción              $2.306.000 ÷ 4.612 kg = $500/kg
+ EI producción en proceso                    $420.000
− EF producción en proceso                    $360.500
= Costo de productos terminados             $2.365.500
```

O sea: **`costo de producción ÷ unidades` es exactamente la definición de "costo unitario de
producción"**, y ese renglón va antes del ajuste por producción en proceso. Que no se mueva no
es el defecto: es la definición. El defecto es que el renglón siguiente —el costo de lo que
efectivamente salió terminado, que es el que hay que mirar para poner precio cuando no se
terminó todo— no existía en ningún lado del resultado. `cost-statement.ts` ya lo calculaba como
`finishedGoodsCost` y no lo usaba nadie.

Queda además fijada la semántica de `productionQuantity` (la "Cantidad producida" que el usuario
carga en la sección Venta): son las **unidades terminadas en el período**. De eso depende que el
divisor del renglón nuevo sea el correcto.

## Decisión

Se agrega `detail.unitCost.unitFinishedGoodsCost` = costo de productos terminados ÷ unidades
terminadas, **sin tocar** `unitProductionCost`, que se queda con la fórmula de la cátedra. Son
dos renglones distintos del estado de costos y el resultado muestra los dos.

En Costeo por Procesos los dos números coinciden a propósito: `finalUnitCost` es el costo
unitario total acumulado del último departamento, o sea el de las unidades terminadas y
transferidas, y ahí la producción en proceso ya entró por **producción equivalente**.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Cambiar el numerador de `unitProductionCost`, como pedía el issue | Contradice la práctica resuelta de la clase 2: el costo unitario de producción se calcula sobre el costo del período, antes del ajuste por proceso. Además cambiaría el número grande de la pantalla (`ResultTab.tsx:308`) en todo período con producción en proceso, sin que nadie lo haya pedido. |
| Renombrar `unitProductionCost` para que se entienda que no incluye el proceso | Arregla el nombre, no el problema: el número que falta seguiría faltando. |
| Dejarlo como está y mostrar el estado de costos completo en pantalla | El costo de productos terminados aparecería como total, nunca por unidad. El unitario es el número con el que se pone precio. |
| Agregar un campo nuevo de "unidades terminadas" distinto de `productionQuantity` | Innecesario una vez fijada la semántica: `productionQuantity` ya son las terminadas del período. Habría agregado schema, ruta, formulario y migración de datos para un dato que ya existe. |

## Consecuencias

**A favor**

- Cargar producción en proceso ahora mueve un costo unitario, que era el criterio 1 del issue.
- Ningún número existente cambia (criterio 2), así que la regresión de la matemática (DOM-05) es
  cero por construcción.
- `finishedGoodsCost` deja de ser un cálculo correcto que nadie usaba.

**En contra / lo que aceptamos pagar**

- Hay **dos** costos unitarios en el resultado, y dos números parecidos son una oportunidad de
  confundirlos. Mitigarlo es trabajo de la pantalla, no del motor: hay que etiquetarlos con las
  palabras del estado de costos, no con jerga.
- El renglón nuevo **todavía no se muestra en ningún lado**. Hasta que el frontend lo pinte, es
  un número calculado y no consumido — exactamente el patrón que el issue #98 quiere cazar.
- La decisión descansa en que `productionQuantity` son las unidades terminadas. Si esa semántica
  cambia, este ADR se revisa entero.

**Qué se rompe si alguien la revierte sin leer esto**

- Si alguien "unifica" los dos costos unitarios en uno, vuelve a perderse el efecto de la
  producción en proceso, o se rompe la fórmula de cátedra del otro. Son dos renglones, no dos
  versiones del mismo.

## Cómo se verifica que sigue vigente

```bash
npx vitest run tests/application/costo-unitario-produccion-en-proceso.test.ts
```

Cubre los tres criterios de reverificación del issue: con existencia en proceso el unitario de
terminados cambia; con las existencias en cero los dos unitarios coinciden; y el caso con
existencia inicial y final simultáneas contra una clave calculada a mano.
