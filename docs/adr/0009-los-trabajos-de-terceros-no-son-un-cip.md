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

El dato tiene **columna propia** (`thirdPartyWork` en `cost_structures` y en `cost_periods`),
**endpoint propio** (`PUT /cost-structures/:id/third-party-work`) y viaja al motor como dato del
período, no dentro de `indirectCosts`. Se versiona append-only como sección propia y se espeja en
el período abierto, igual que los datos de venta.

> **Nota de revisión (21-08).** La primera versión de este ADR los guardaba dentro del JSON de
> costos indirectos, para evitar una migración. Se descartó: dejar el importe a un renglón de
> distancia de los conceptos de CIF **invita exactamente al error que este ADR previene**. La
> migración es aditiva y barata; la ambigüedad no.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Cargarlos como un `concept` más de CIF | Es la opción que parece más simple y es la equivocada. Un concepto de CIF **se reparte entre los centros** según su base y después **se diluye en las cuotas**. El costo total del período daría parecido, pero el costo de cada centro quedaría mal y la cuota de cada uno también — y eso se arrastra a todo lo que se costee con esas cuotas. La cátedra los separa por esta razón exacta. |
| Guardarlos en el JSON de `indirectCostConfig` | **Fue la primera decisión y se revirtió.** Evitaba la migración, pero dejaba el importe conviviendo con los conceptos de CIF: la ubicación sugiere que se prorratea, y tarde o temprano alguien lo suma ahí. El versionado tampoco era un argumento a favor, porque `updateSales` demuestra que una columna se puede versionar igual (`appendConfigVersion`). |
| Una tabla propia, como `desperdicio_registros` | Misma razón: hoy es **un importe**, no una lista de registros con naturaleza que decidir. Construir la tabla ahora es armar el andamiaje antes de saber si hace falta — el patrón que este mismo bloque de trabajo vino a corregir. |
| Sumarlos dentro de `indirectCostsApplied` | Escondería el renglón y rompería la definición del costo normal, que es MP + MOD + **CIP aplicados**. El estado dejaría de poder mostrar los trabajos de terceros por separado, que es justamente lo que la cátedra pide ver. |

## Consecuencias

**A favor**

- El estado de costos queda completo: ya tiene todos los renglones de la estructura canónica.
- El dato vive **donde corresponde**: fuera de la config de CIP, así que nadie lo confunde con un concepto a prorratear.
- Se versiona append-only y se espeja en el período, con el mismo patrón ya probado de los datos de venta.
- Una estructura que no manda nada afuera no cambia en nada: el default es 0.

**En contra / lo que aceptamos pagar**

- **Costó una migración y un endpoint más.** Es el precio de que el dato viva donde corresponde en
  vez de donde era más rápido.
- **No hay detalle**: es un importe único del período, sin proveedor ni comprobante. Si el cliente
  necesita abrirlo por proveedor, hay que rehacerlo como tabla — y ahí el precedente es
  `desperdicio_registros`.
- **Falta el campo en el formulario.** El backend lo acepta, lo guarda y lo calcula; la pantalla
  todavía no lo pide.

**Qué se rompe si alguien la revierte sin leer esto**

- Si alguien "simplifica" moviéndolos a `concepts` para no tener un campo aparte, los trabajos de
  terceros se reparten entre los centros y se diluyen en las cuotas. El costo total sigue pareciendo
  correcto y el de cada centro pasa a estar mal — un error que no se ve en el número grande.

## Sobre la migración

Está **escrita a mano** y es aditiva (DOM-06): dos `ADD COLUMN` con `DEFAULT 0`, así las filas que
ya existen quedan igual que antes.

No se generó con `prisma migrate diff` a propósito: el diff contra el historial arrastra **deriva
preexistente** que no tiene nada que ver con este cambio — los `DROP INDEX` de `vault_chunks`
(issue #72, romperían el RAG), un `DROP CONSTRAINT` de la FK de `cost_config_versions` y varios
`ALTER COLUMN ... DROP DEFAULT`. Aplicar eso de arrastre sería destructivo. Es el mismo criterio
—y la misma advertencia sobre el nombre de la carpeta en UTC— que la migración de reglas de alerta
del 19-08.

## Cómo se verifica que sigue vigente

```bash
npx vitest run tests/application/trabajos-de-terceros.test.ts
```

Fija que suman al costo real, que llegan al CPV, que **el costo normal y el CIP aplicado no se
mueven** (o sea que no se colaron al prorrateo), la clave a mano con todos los renglones juntos, y
que una estructura sin el campo se sigue leyendo.
