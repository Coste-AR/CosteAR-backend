# Bitácora — issue #199: ventas por canal y variante

## Decisión y supuesto explícito

Cada venta queda asociada a una estructura porque una misma empresa puede
costear más de un producto en el mismo período. El promedio se consulta contra
el período de esa estructura y se calcula ponderando importe y cantidad.

El issue no definía una unidad única de salida. Se eligió exigir `unidadId` en
la consulta de promedio: las cantidades se convierten con el `factor` de
`UnidadMedida` y se rechazan unidades de bases incompatibles. Así no se mezcla
un promedio de magnitudes distintas ni se reimplementa la conversión.

## Fuera de alcance

No se persiste un promedio, no se calculan margen ni resultado, ni se modifican
el motor de cálculo, el tablero o stock.

## Verificación

- `npm ci`, generación Prisma, lint y typecheck — verdes.
- Integración focalizada con rol de aplicación y RLS: 3 pruebas verdes.
- El primer arranque de integración no ejecutó pruebas por una carrera externa
  al reaplicar RLS (`tuple concurrently updated`); se repitió una vez y pasó.
