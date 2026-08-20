# 0008 — Correr el control de variaciones de cátedra sobre los números serializados, con tolerancia de un centavo

- **Fecha:** 2026-08-20
- **Estado:** Aceptada
- **Decide:** Lautaro (issue asignado por Santiago)
- **Contexto de origen:** issue #97, hallazgo L4 de la revisión de Costeo por Órdenes del 20-08-2026

## Contexto

La cátedra define un control sobre el análisis de variaciones de dos vías:

> variación presupuesto + variación volumen = −(sobre/sub-aplicación)

`calcVarianceAnalysis` lo enunciaba en su propio comentario desde el primer día — *"Regla de control"*, textual — y **el motor nunca lo corría**. Es el mismo patrón que `checkRawMaterialConsistency`, que también existía apagado y fue un defecto real cuando se lo encontró (ver ADR 0005 e issue #98).

El hallazgo se detectó midiendo el caso D02 de la auditoría de Órdenes, centro "Terminación":

```
var. presupuesto  −6.866,67
var. volumen     +14.533,33
suma              7.666,66
−(sobre/sub)      7.666,67   ← un centavo
```

**El centavo no es el hallazgo.** `Money` trabaja con 28 dígitos de precisión y la identidad cierra exacta ahí adentro; el desvío nace al serializar, porque los tres números se redondean a 2 decimales **por separado** y tres redondeos independientes no tienen por qué sumar cero. El hallazgo es que el motor no tenía la red puesta.

## Decisión

Se agrega `checkVarianceIdentity()` en `indirect-costs.ts` y `runCalculation` lo corre **centro por centro**, al lado del chequeo de materia prima, informando el resultado en `CalculationOutput.consistency`.

El control compara los valores **tal como se serializan** (`Money.toNumber()`, 2 decimales), con tolerancia explícita de **$0,01**. No bloquea el cálculo: informa.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| **Chequear los `Money` de precisión completa** | La identidad es una tautología algebraica de las tres fórmulas: daría verde **siempre, por construcción**. Sería un control decorativo, justo la clase de cosa que el ADR 0005 existe para cazar |
| **Sin tolerancia, exigir cero exacto** | Rompería en cualquier centro con cuotas de decimales periódicos —o sea, la mayoría— por un residuo que no es un error. Un aviso que salta siempre deja de leerse |
| **Redondear una variación para que las tres cierren** | Es maquillar el número que el costista lee para que cuadre un control. El dato pasaría a ser mentira por un centavo |
| **Tirar 422 y frenar el cálculo cuando falla** | Un costista al que le frenan el cálculo por una diferencia de redondeo no puede trabajar. Mismo criterio que el chequeo de materia prima: informa, no bloquea |
| **Bajar la precisión de `Money` a 2 decimales** | Rompería DOM-05 (regresión cero) en todo el motor para arreglar un síntoma de presentación |

## Consecuencias

**A favor**

- El control existe y corre en cada cálculo de Órdenes. Un desvío mayor a un centavo —que sí sería alguien tocando una de las tres fórmulas sin las otras dos— queda avisado y con el centro nombrado.
- La tolerancia está escrita en el código **con el motivo**, no elegida a ojo. Un test fija el borde: $0,01 pasa, $0,02 no.
- No cambia ningún número del motor. `fx3-dorado` y `r5-fixtures` (DOM-05) siguen idénticos.

**En contra / lo que aceptamos pagar**

- **Con tolerancia de un centavo, un error real de exactamente un centavo pasa desapercibido.** Es el precio de no gritar en cada centro con cuota periódica, y es el trueque correcto: un centavo sobre montos de seis cifras no cambia ninguna decisión; un aviso que salta siempre, sí — deja de leerse.
- Los centros **pendientes de cierre** tienen las tres variaciones en cero, así que la identidad cierra sola. Verde ahí NO significa "el cierre está verificado". Está documentado en el código y fijado con un test, para que nadie lea el verde como más de lo que es.
- `consistency` gana tres campos. Es aditivo y el objeto ya era opcional a propósito (las corridas viejas no lo tienen, y decir `true` sobre un cálculo que nunca se chequeó sería peor que no decir nada).

**Qué se rompe si alguien la revierte sin leer esto**

- El motor vuelve a no correr el control, y el próximo desajuste entre las tres fórmulas sale a producción con la suite en verde.
- Si además alguien "arregla" la tolerancia subiéndola, el test del borde ($0,02 no pasa) se pone rojo. Es a propósito.

## Cómo se verifica que sigue vigente

```bash
npx vitest run tests/domain/indirect-costs.test.ts tests/application/calculate.test.ts
```

El caso Terminación (`−6.866,67 / 14.533,33 / −7.666,67`) tiene que dar diferencia `−0,01` y `matches: true`; un peso de desvío tiene que dar `matches: false`.
