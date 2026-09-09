# Bitácora — issue #201: paquete avícola de postura

## Decisión y supuesto explícito

Las variantes se cargan como dos etiquetas provisionales (`variante_1` y
`variante_2`) y todas quedan con `confirmado: false`. El issue confirma que la
cantidad real está pendiente; no se presenta este contenido como dato de una
empresa.

El seed inserta el paquete global sólo si falta. Al aplicar parámetros de
semilla a una empresa, crea únicamente los ausentes: no actualiza filas
existentes, por lo que una decisión confirmada siempre prevalece.

## Fuera de alcance

No se agregó dominio, entidades, schema, RLS, vocabulario del clasificador ni
reglas ejecutables de alerta. Las reglas quedan como datos configurables del
paquete.

## Verificación

- Generación Prisma y typecheck — verdes.
- Tests focalizados de contenido, cascada y preservación de confirmados — verdes.
