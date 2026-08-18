# 0003 — El subproducto de Categoría 2 queda sin resolver: `CostSection` no tiene sección de recupero

- **Fecha:** 2026-08-18
- **Estado:** Aceptada (documenta un hueco, no lo cierra)
- **Decide:** Santiago
- **Contexto de origen:** Plan del vertical avícola, tarea S-04 (T-04)

## Contexto

La tarea S-04 pedía explícitamente: *"Write an ADR on the Category-2 by-product gap. If not solved here, say so explicitly."* **No se resolvió acá.** Este ADR explica el hueco y por qué se deja abierto.

En una explotación de ponedoras, la **gallina de descarte** es un subproducto real: cuando la postura cae por debajo del 83-85 %, el ave se faena y se vende. Eso genera un ingreso que, doctrinariamente, es un **recupero** — no una venta del producto principal ni una merma.

El sistema ya sabe que no puede representarlo. En `industry-profile.ts` la ausencia de `gallina de descarte` en todas las listas de palabras clave es **deliberada y está documentada**: no se la clasifica porque no hay adónde mandarla.

La causa de fondo es estructural: **`CostSection` no tiene una sección de recupero.** Sus secciones son materia prima, mano de obra y costos indirectos. Un ingreso por subproducto no es ninguna de las tres.

## Decisión

**No se agrega la sección de recupero en esta tarea.** S-04 entrega el desperdicio con naturaleza declarada (normal / extraordinaria) y el recupero **de la merma normal**, que es lo que la regla R5 necesita para funcionar.

El subproducto de Categoría 2 —el ingreso por gallina de descarte— **queda fuera de alcance y sin representación en el modelo.**

## Por qué se deja abierto

| Motivo | Detalle |
|---|---|
| **Es un cambio de taxonomía, no un campo** | Agregar una sección a `CostSection` toca el clasificador, el prorrateo, el estado de costos y todas las pantallas. No entra dentro de una tarea de desperdicio |
| **Cambiaría números ya cerrados** | Un recupero que hoy no existe, mañana bajaría el costo de producción. Con períodos cerrados y un cliente real, eso hay que decidirlo aparte |
| **Falta el criterio del cliente** | No está definido si la venta de descarte se trata como recupero del costo del plantel, como ingreso secundario, o como valor residual del activo amortizable. Las tres son defendibles y dan resultados distintos |

Ese último punto conecta con S-03: `ActivoAmortizable.valorResidual` **ya podría absorber** la venta de descarte, tratándola como valor residual del plantel en vez de como recupero del período. Es la salida más barata y probablemente la correcta, pero **es una decisión de criterio contable que no toma el equipo técnico**.

## Alternativas consideradas

| Alternativa | Por qué no ahora |
| --- | --- |
| **Agregar `RECUPERO` a `CostSection`** | Es la solución completa, y la más cara: toca clasificador, prorrateo, estado de costos y UI. Merece su propia tarea |
| **Tratarlo como venta con margen negativo** | Ensucia el margen del producto principal con algo que no es el producto principal |
| **Meterlo en `valorResidual` del activo** | Es probablemente lo correcto, pero requiere que alguien decida el criterio contable. Queda propuesto, no aplicado |
| **Clasificarlo como merma con recupero** | Sería mentir sobre la naturaleza del hecho: la gallina de descarte no es una pérdida, es una venta planificada |

## Qué queda pendiente, concretamente

1. Definir con el cliente el criterio: ¿valor residual del plantel, recupero del período, o ingreso secundario?
2. Según eso, o alcanza con cargar `valorResidual` en el activo (barato) o hay que extender `CostSection` (caro).
3. Recién cuando exista el destino, agregar `gallina de descarte` a las palabras clave del perfil AVICULTURA. **Antes no**: clasificar hacia un lugar que no existe es peor que no clasificar.
