# 0009 — Los trabajos de terceros no son un CIP: renglón propio, sin prorrateo

- **Fecha:** 2026-08-21
- **Estado:** Aceptada
- **Decide:** Santiago
- **Contexto de origen:** issue #90 (la parte que había quedado abierta), ADR 0007

## Contexto

El ADR 0007 incorporó la variación presupuesto al estado de costos y dejó **explícitamente
afuera** el otro renglón que faltaba: los trabajos de terceros. El motivo fue que no existían en
el modelo —ni campo, ni ruta, ni formulario— y meterlos ahí era agrandar el issue sin avisar.

Son procesos que se mandan a hacer afuera (un tratamiento térmico, un bordado, un flete de
proceso) y que forman parte del costo de producción. La estructura de la cátedra los ubica entre
el costo normal y el real:

```
= COSTO NORMAL DE PRODUCCIÓN DEL PERÍODO
+ Trabajos de terceros
± Variación presupuesto
= COSTO REAL DE PRODUCCIÓN
```

La clase 20 es explícita en el punto que importa: *«los trabajos de terceros **se registran por
separado de los CIP**»* (criterio del docente), y en el práctico se cargan enteros al costo de la
orden — *«Orden 125: $1.134.459 (incluye trabajos de terceros)»*.

La pregunta de diseño no es si suman —eso es evidente— sino **dónde vive el dato sin que el
sistema los trate como carga fabril**.

## Decisión

Los trabajos de terceros son un **importe del período que va derecho al estado de costos**, como
renglón propio. **No entran al prorrateo primario ni al secundario, no tienen cuota y no generan
variaciones.**

El dato se declara en `indirectCosts.thirdPartyWork`, con default 0. Vive en esa sección porque es
donde el costista los carga y porque ese JSON ya se persiste y se versiona con el resto — **no
porque sean carga fabril**. El motor los lee de ahí y los suma en el estado de costos, sin pasarlos
por ninguna de las dos pasadas del prorrateo.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Cargarlos como un `concept` más de CIF | Es la opción que parece más simple y es la equivocada. Un concepto de CIF **se reparte entre los centros** según su base y después **se diluye en las cuotas**. El costo total del período daría parecido, pero el costo de cada centro quedaría mal y la cuota de cada uno también — y eso se arrastra a todo lo que se costee con esas cuotas. La cátedra los separa por esta razón exacta. |
| Una columna nueva en `cost_periods` | Es lo más prolijo a largo plazo, pero exige migración. Con el JSON de `indirectCostConfig` —que ya se persiste, se versiona append-only y viaja a los períodos— el dato queda igual de guardado y de trazable, sin tocar el esquema. Si algún día los trabajos de terceros necesitan detalle por proveedor o comprobante, ahí sí conviene la tabla propia. |
| Una tabla propia, como `desperdicio_registros` | Misma razón: hoy es **un importe**, no una lista de registros con naturaleza que decidir. Construir la tabla ahora es armar el andamiaje antes de saber si hace falta — el patrón que este mismo bloque de trabajo vino a corregir. |
| Sumarlos dentro de `indirectCostsApplied` | Escondería el renglón y rompería la definición del costo normal, que es MP + MOD + **CIP aplicados**. El estado dejaría de poder mostrar los trabajos de terceros por separado, que es justamente lo que la cátedra pide ver. |

## Consecuencias

**A favor**

- El estado de costos queda completo: ya tiene todos los renglones de la estructura canónica.
- El dato entra por la ruta de Costos Indirectos que **ya existe**, sin migración ni endpoint nuevo.
- Una estructura que no manda nada afuera no cambia en nada: el default es 0.

**En contra / lo que aceptamos pagar**

- **El campo vive en la sección de Costos Indirectos y no lo es.** Es la incomodidad de esta
  decisión: alguien puede leer `indirectCosts.thirdPartyWork` y suponer que se prorratea. Está
  documentado en el schema y en el estado de costos, y hay un test que lo fija, pero la ubicación
  sigue sugiriendo algo que no es.
- **No hay detalle**: es un importe único del período, sin proveedor ni comprobante. Si el cliente
  necesita abrirlo, hay que rehacerlo como tabla.
- **Falta el campo en el formulario.** El backend lo acepta y lo calcula; la pantalla todavía no
  lo pide.

**Qué se rompe si alguien la revierte sin leer esto**

- Si alguien "simplifica" moviéndolos a `concepts` para no tener un campo aparte, los trabajos de
  terceros se reparten entre los centros y se diluyen en las cuotas. El costo total sigue pareciendo
  correcto y el de cada centro pasa a estar mal — un error que no se ve en el número grande.

## Cómo se verifica que sigue vigente

```bash
npx vitest run tests/application/trabajos-de-terceros.test.ts
```

Fija que suman al costo real, que llegan al CPV, que **el costo normal y el CIP aplicado no se
mueven** (o sea que no se colaron al prorrateo), la clave a mano con todos los renglones juntos, y
que una estructura sin el campo se sigue leyendo.
