# 0008 — La merma normal no se suma al costo: ya está adentro

- **Fecha:** 2026-08-21
- **Estado:** Aceptada
- **Decide:** Santiago
- **Contexto de origen:** issue #92 (hallazgo L3), auditoría del motor de cálculo

## Contexto

`desperdicio.ts` implementa la regla R5 de la clase 4 desde hace tiempo, con 181 líneas de tests
en verde, y **su único importador era su propio archivo de test**. La tabla `desperdicio_registros`
existe con `naturaleza` y `valorRecupero`. El motor no tenía dónde recibir el dato: `runCalculation`
nunca lo calculaba y `CalculationInput` no lo declaraba.

R5 dice:

> El desperdicio **normal** neto de recupero lo absorben las unidades buenas.
> El desperdicio **extraordinario** es pérdida del período — nunca costo.

Al cablearlo aparece la pregunta que decide todo: `imputarDesperdicios` devuelve un `alCosto`,
**¿ese número se suma al costo de producción?**

La respuesta es **no**, y equivocarse acá infla el costo unitario de todo el mes sin que se vea.
El costo de lo desperdiciado **ya está adentro** del costo de producción: la materia prima salió
del almacén y la ficha de stock la registró como consumo. Tres evidencias independientes:

1. **La cátedra trabaja la merma normal por cantidad BRUTA** (clase 4): se compran 400 g para usar
   380. El desperdicio ya está dentro de lo que se compró y se consumió.
2. **El motor de Procesos hace exactamente eso**: `normalLossAbsorbedAutomatically` — *«la pérdida
   normal la absorben las unidades buenas SIN cálculo adicional»*.
3. **El issue #45 del frontend lo confirma desde el otro lado**: informar pérdidas sin merma
   admitida *«reduce el costo»*, porque todo queda como extraordinario y sale del costo.

## Decisión

El desperdicio entra al estado de costos como **dos renglones que RESTAN**, después del costo real:

```
= COSTO REAL DE PRODUCCIÓN
− Recupero de desperdicio      (reduce el costo de materiales, clase 4)
− Merma extraordinaria         (pérdida del período, nunca costo)
= COSTO DE PRODUCCIÓN NETO DE DESPERDICIO
```

- La **merma normal no se suma ni se resta**: se informa como `desperdicio.alCosto` para que se
  vea cuánto absorbieron las unidades buenas, pero el costo no se toca.
- El **recupero** se resta como renglón propio y **no** se descuenta de `rawMaterialConsumed`, para
  no romper el chequeo de consistencia contra la ficha de stock: la ficha registra lo que salió del
  almacén, y el recupero no cambia esa cantidad.
- Un registro **sin naturaleza declarada** no entra al cálculo y se expone en `pendientes` con el
  motivo. Es la regla dura que el módulo ya tenía y se respeta tal cual.
- Las dos cifras se exponen **separadas**: una es costo del producto, la otra es pérdida de la
  empresa.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Sumar `alCosto` al costo de producción | **Doble conteo.** La merma normal ya está en la MP consumida. Sumarla otra vez infla el costo unitario de todo el período, y es invisible: sale como un costo unitario más alto, sin ningún error. Es exactamente el modo de fallar que venimos arreglando. |
| Restar el recupero de `rawMaterialConsumed` | Es donde conceptualmente pertenece (clase 4: «reducción del costo de materiales»), pero rompe `checkRawMaterialConsistency`: la ficha de stock seguiría informando el consumo bruto y el control marcaría una inconsistencia que no existe. Se resta como renglón propio, que da el mismo número sin apagar un detector. |
| Dejar la merma extraordinaria adentro y solo informarla | Contradice R5 de frente: *nunca* es costo. Y es el caso que más plata mueve, porque una mortandad o una rotura grande se cargaría entera al producto. |
| Tratar un registro sin naturaleza como normal | Es la decisión que el módulo se negaba a tomar, con razón escrita: el umbral que separa lo normal de lo extraordinario **no surge del comprobante**. Suponer "normal" manda una merma posiblemente extraordinaria al costo. |
| Leer los desperdicios de `desperdicio_registros` dentro del servicio | **No hay forma de cargar esos datos**: cero rutas, cero servicios, la tabla no se lee ni se escribe en ningún lado. Conectar la lectura hoy devolvería siempre una lista vacía — otra pieza construida y nunca enchufada, que es justamente lo que este issue denuncia. |

## Consecuencias

**A favor**

- La regla R5 pasa a estar aplicada y no solamente implementada.
- Un período con merma extraordinaria declarada deja de cargarle esa pérdida al producto.
- Las dos cifras separadas permiten que la pantalla muestre lo que el costista necesita decidir.
- Sin desperdicios declarados el cálculo da exactamente lo mismo que antes.

**En contra / lo que aceptamos pagar**

- **El dato todavía no puede entrar por ningún lado.** El motor lo recibe, pero no hay endpoint ni
  formulario que lo cargue, así que en producción el campo va a llegar vacío hasta que se construya
  esa parte. El issue queda abierto por eso.
- La merma normal se informa pero no mueve ningún número, y eso puede leerse como que "no hizo
  nada". Es correcto y es lo que la doctrina pide, pero la pantalla va a tener que explicarlo.
- Se agregan tres campos al resultado del estado de costos. Ya son varios renglones, y la pantalla
  todavía no muestra ninguno.

**Qué se rompe si alguien la revierte sin leer esto**

- Si alguien "completa" el cableado sumando `alCosto` al costo de producción, aparece un doble
  conteo silencioso: el costo unitario sube y no hay ningún error que lo delate.

## Cómo se verifica que sigue vigente

```bash
npx vitest run tests/application/desperdicio-en-el-motor.test.ts
```

Cubre que la merma normal **no** mueva el costo, que la extraordinaria salga, que el recupero
reste, que un registro sin naturaleza quede pendiente sin entrar, la mezcla de un mes real, y que
sin desperdicios declarados nada cambie.
