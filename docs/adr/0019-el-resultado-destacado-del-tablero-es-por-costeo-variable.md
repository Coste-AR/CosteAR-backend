# 0019 — El resultado destacado del tablero es el de costeo variable, no el de absorción

- **Fecha:** 2026-09-15
- **Estado:** Aceptada
- **Decide:** Giuliana (sesión de Claude)
- **Contexto de origen:** M0-03 del plan de análisis marginal v2 (`CosteAR-admin`)

## Contexto

El sexto indicador del tablero del dueño, `resultadoPeriodo`, se componía con `resultado.grossMargin`
— el margen bruto por **absorción**. El tablero se presenta como la vista de costeo variable del
negocio (el resto de sus indicadores lo son: contribución marginal, punto de equilibrio, costo
variable). Cuando producción ≠ venta, las dos cifras son distintas y nada en pantalla lo avisaba.

`AM4` (bóveda, nota CosteAR sobre el sistema): *"el costeo por absorción es una vista de salida
para cumplir la RT 17; el motor razona en costeo variable, y la derivación es unidireccional"*.

## Decisión

Se agrega **`resultadoPeriodoCosteoVariable`** y se **conserva** `resultadoPeriodo` (absorción)
íntegro — ninguno de los dos se esconde, la RT 17 exige que el de absorción exista. La cifra
**destacada** (la que va primero, con más jerarquía visual, en el trabajo de frontend que sigue a
este PR) es la de **costeo variable**; la de absorción va al lado.

Un tercer campo, **`diferenciaPorVariacionDeInventarios`**, expone la brecha entre las dos y una
frase en castellano que explica de qué lado está (si la producción superó a la venta o al revés)
— sin ese texto, la diferencia es un número sin contexto que invita a pensar que algo está mal.

### La fórmula no necesitó separar el costo variable de producción del de comercialización

El "qué construir" original describía la fórmula como
`ventas − cv de producción de lo vendido − cv de comercialización − fijos`. Como
`contribucionMarginalUnitaria = precio − cv` (donde `cv` ya es el costo variable total, sea cual
sea su composición), esa fórmula es algebraicamente idéntica a:

```
resultadoPeriodoCosteoVariable = contribucionMarginalUnitaria × unidadesVendidas − costosFijosDelPeriodo
```

Ambos términos ya existían (`contribucionMarginalPorCajon` de MX-01, `costosFijosDelPeriodo` de
MX-02) — **M0-03 no necesitó esperar a M0-02** (separar cv de producción vs. comercialización),
contra lo que sugería el orden del plan. La separación sí importa para poder *desglosar* el costo
variable en dos líneas — no para este resultado total.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Reemplazar `resultadoPeriodo` por el de costeo variable | Prohibido por la propia tarea y por RT 17: la vista de absorción tiene un uso regulatorio que no desaparece. |
| Calcular la diferencia recalculando el costo fijo unitario de absorción (`CF/producidas`) × la variación de inventario | Da el mismo número EN TEORÍA, pero por una vía distinta a la que el motor realmente usa (`unitFinishedGoodsCost`, que mezcla costo real y neto de desperdicio) — podría no coincidir centavo a centavo con `resultado.grossMargin`. Restar los dos resultados ya calculados es exacto por construcción y no reintroduce redondeo. |

## Consecuencias

**A favor**

- Ninguna cifra existente cambia de significado ni desaparece — cero regresión en el contrato.
- La diferencia es exacta por construcción (resta de dos números ya calculados), no una
  aproximación que podría no cerrar.

**En contra / lo que aceptamos pagar**

- `diferenciaPorVariacionDeInventarios` depende de que **las dos** fuentes (contribución marginal
  y `resultado.grossMargin`) estén completas — si cualquiera de las dos falta, la diferencia
  también sale incompleta, aunque técnicamente una de las dos sí se pudo calcular.

**Qué se rompe si alguien la revierte sin leer esto**

- Volver a destacar `resultadoPeriodo` (absorción) como la cifra principal reintroduce la
  confusión original: el tablero se presenta como costeo variable pero cierra con un número de
  absorción, y nadie lo distingue.

## Cómo se verifica que sigue vigente

`tests/http/owner-dashboard.test.ts`: con el fixture canónico del plan (`AM-01`, producción 1.000,
venta 800, cm 256, fijos 192.000) da `resultadoPeriodoCosteoVariable = 12.800` y
`diferenciaPorVariacionDeInventarios = 38.400` con explicación; con producción = venta, coinciden
y la diferencia da `0` sin explicación.
