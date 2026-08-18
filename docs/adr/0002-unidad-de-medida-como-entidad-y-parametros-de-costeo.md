# 0002 — Modelar la unidad de medida como entidad y los parámetros de costeo como clave-valor

- **Fecha:** 2026-08-18
- **Estado:** Aceptada
- **Decide:** Santiago
- **Contexto de origen:** Plan de implementación del vertical avícola, tarea S-02 (T-02)

## Contexto

El vertical avícola gestiona en **cajones de huevo**: 360 huevos, 12 maples. Todo el análisis del cliente —producción, punto de equilibrio, costo unitario— se homogeneiza en esa unidad.

El sistema no tenía dónde expresarla. Dos huecos distintos:

**1. La unidad de medida era un string de pantalla.** `unit: 'kg'` es una etiqueta que se imprime. Sin factor de conversión, el sistema no puede convertir maples a cajones ni comparar dos unidades de la misma familia.

**2. No había ningún lugar para las constantes de negocio.** Cuántos huevos entran en un cajón, cuántos meses dura el lote de ponedoras, a partir de qué porcentaje una merma deja de ser normal. Sin un lugar, cada una termina hardcodeada.

> Un número de negocio hardcodeado es un número que **nadie puede corregir sin un PR**, y que nadie sabe que está ahí hasta que da mal.

Con un cliente real en producción desde agosto de 2026, eso no es un problema de prolijidad: la vida útil del lote divide la amortización del plantel, y equivocarla mueve el costo unitario de todos los cajones del mes.

Y hay una restricción de fondo: **esto no puede ser solo para avicultura.** El plan de rubros escalables busca que sumar un rubro sea cargar filas, no abrir un PR.

## Decisión

**La unidad de medida pasa a ser una entidad con factor de conversión** (`UnidadMedida`), encadenada a una unidad base: cajón → maple → huevo, con `factor` en cada eslabón.

**Los parámetros de costeo se modelan como clave-valor por período** (`ParametroCosteo`), con resolución en cascada:

```
período → estructura → empresa → default del catálogo
```

El más específico gana, y **la resolución devuelve el origen**. Eso es lo que permite que la pantalla distinga "esto lo confirmó el cliente" de "esto lo puso el sistema porque no había nada".

Ningún default del catálogo se da por confirmado, ni siquiera los seguros: `confirmado` significa *lo dijo el cliente*, no *es razonable*.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| **Columnas fijas** para los seis campos del §7 (`huevos_por_cajon`, `vida_util_lote_meses`, …) | Es lo que pedía el plan al pie de la letra, y es lo que no escala: cada rubro nuevo pide una migración. Un frigorífico querría `rendimiento_de_res`, una panadería `merma_de_horneo`. Con clave-valor, ninguno de los dos toca el schema |
| **Dejar la unidad como string** y convertir en el código | Es el estado actual y es la causa del problema. La conversión queda repartida en cada lugar que la necesita, y ninguna es la fuente de verdad |
| **Un enum de unidades** en el schema | No sirve para multiempresa: las unidades de gestión son del negocio del cliente, no del sistema. Agregar "cajón" obligaría a un deploy |
| **Guardar el valor ya convertido** (todo en huevos) | Pierde la unidad en la que el cliente piensa. Él no dice "produje 169.920 huevos", dice "produje 472 cajones". Un informe en la unidad equivocada no se lee |

## Consecuencias

**A favor:**

- Las tareas S-03 (amortización del plantel) y S-04 (desperdicio) tienen de dónde leer sus umbrales sin hardcodear nada. Hay un test que falla si alguien escribe los 24 meses a mano.
- La ociosidad de G-04 puede expresarse en cajones equivalentes, porque existe el factor.
- Los datos abiertos del plan (D-01 vida útil, el costo del maple, el umbral de merma) entran al sistema **marcados como no confirmados** en vez de quedar como comentarios en un documento.

**En contra, y hay que decirlo:**

- **Clave-valor pierde tipado.** `valorNum` es un `Decimal` para todos: nada impide cargar `huevos_por_cajon = -3`. La validación tiene que vivir en la capa de aplicación, no en el schema. Es el precio de no pedir una migración por rubro.
- Una consulta que necesite cinco parámetros hace cinco lecturas o una lectura y un filtro en memoria. A esta escala no importa; si algún día importa, se cachea igual que `IndustryProfileService`.

## Notas de implementación

- Migración **aditiva** (DOM-06). Prisma había generado además una tanda de `DROP` por deriva **preexistente** del schema —incluidos los índices de `vault_chunks` que sostienen la búsqueda de la bóveda—. Se eliminaron a mano y quedó constancia en el encabezado de la migración. **Esa deriva sigue existiendo y hay que resolverla aparte.**
- Políticas RLS para las dos tablas (DOM-07), con `userId` denormalizado, mismo patrón que `cost_periods`.
- La capa de dominio (`src/domain/parametros/`) es pura: la cascada se resuelve sin tocar la base y por eso se puede testear sin Postgres.
