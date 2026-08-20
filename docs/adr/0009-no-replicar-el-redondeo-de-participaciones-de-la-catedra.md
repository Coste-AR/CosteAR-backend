# 0009 — No replicar el redondeo de participaciones de la cátedra en el reparto de costos conjuntos

- **Fecha:** 2026-08-20
- **Estado:** Aceptada
- **Decide:** Lautaro (issue asignado por Santiago)
- **Contexto de origen:** issue #95, al anclar FX-P3 (CCEDA SA, Clase 23)

## Contexto

CosteAR promete **replicar la metodología de la cátedra al 100 %, con cero tolerancia a error de cálculo**. Al escribir el fixture FX-P3 apareció un punto donde las dos cosas no pueden ser ciertas a la vez.

En el reparto de costos conjuntos por VNR, la cátedra:

1. calcula la participación de cada línea (VNR ÷ Σ VNR),
2. **la redondea a 2 decimales**, porque el ejercicio se resuelve a mano,
3. y recién entonces multiplica por el costo conjunto.

CosteAR mantiene la fracción completa (`Money`, 28 dígitos) y multiplica sin redondear.

Medido sobre el punto de separación del Depto. 2 del caso CCEDA (Clase 23), costo conjunto $278.587:

| | Cátedra (0,8247 × total) | CosteAR (240.000/291.000 × total) | Δ |
|---|---|---|---|
| Manteca de cacao | $229.750 | $229.762,47 | **+$12,47** |
| Polvo de cacao | $48.836 | $48.824,53 | −$11,47 |
| Costo unitario manteca | $3.829,18/ton | $3.829,37/ton | +$0,19 |

En el punto de separación del Depto. 1 del mismo caso las dos rutas **sí** coinciden al centavo, porque ahí el redondeo de la participación no llega a mover el producto. O sea: la divergencia no es sistemática, aparece según los números.

El plan de implementación (§12) pide que los fixtures de conjuntos *"pasen al centavo contra los valores de la cátedra"*. Con este caso, eso es imposible de cumplir literalmente.

## Decisión

**El motor no redondea la participación antes de multiplicar.** Se mantiene la precisión completa.

Los fixtures de cátedra anclan, en este orden:

1. **las bases de reparto** (los VNR) — coinciden exacto;
2. **las participaciones** — coinciden con la clase a 2 decimales;
3. **el control Σ asignados = costo conjunto total** — cierra exacto por construcción;
4. y **los importes finales del motor**, con la diferencia contra la clase escrita al lado, no tapada.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| **Redondear la participación a 2 decimales, como la cátedra** | Introduce un error real de $12,47 sobre $278.587 a cambio de reproducir una limitación de lápiz y papel. Con un cliente real en producción, eso es plata mal repartida entre productos |
| **Anclar los fixtures a los números impresos de la clase** | El test quedaría rojo contra un motor correcto. Un fixture que exige un error no es una regresión cero, es una regresión |
| **Hacer el redondeo configurable ("modo cátedra")** | Dos motores que dan dos números distintos para el mismo caso, y alguien tiene que elegir cuál mostrarle al cliente. Mucho costo para un desvío de 0,0045 % |
| **No anclar FX-P3 y saltear el caso** | Es el único caso de cátedra con DOS puntos de separación en la misma corrida. Es justo lo que ningún otro fixture cubre |

## Consecuencias

**A favor**

- El reparto no pierde precisión, y el control Σ asignados = total cierra sin fuga.
- FX-P3 queda anclado, con la divergencia escrita en el propio test.

**En contra / lo que aceptamos pagar**

- **La promesa "al centavo contra la cátedra" no se cumple literalmente**, y hay que poder decirlo. Se cumple algo más defendible: *misma doctrina, misma participación, más precisión en la aritmética*.
- Un docente que compare contra su hoja va a ver $12,47 de diferencia. Necesita esta explicación a mano — por eso existe este ADR.
- Si mañana se decide priorizar la coincidencia literal, hay que cambiar el motor **y** el test. El test dice dónde.

**Qué se rompe si alguien la revierte sin leer esto**

- Redondear la participación cambia importes de reparto ya calculados en períodos cerrados. Con DOM-01 (append-only) y un cliente real, eso no es un refactor.

## Cómo se verifica que sigue vigente

```bash
npx vitest run tests/domain/joint-costs.test.ts
```

El bloque `FX-P3 · CCEDA SA` fija las dos mitades: el Depto. 1, donde coincide al centavo con la clase, y el Depto. 2, donde difiere $12,47 a propósito.
