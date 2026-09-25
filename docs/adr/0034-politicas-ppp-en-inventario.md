# ADR 0034 — Políticas de PPP en inventario

## Contexto

El issue #473 exige dos políticas configurables. `MOVIL` debe fijar el costo de
cada salida con el promedio vigente. `PERIODO` debe usar el promedio ponderado
de los ingresos imputados al período. La devolución queda fuera de alcance
hasta #474.

## Decisión

La empresa declara `politicaPpp`, con `MOVIL` como default provisorio y
`PERIODO` como alternativa. Cada movimiento conserva el costo unitario aplicado:
los hechos ya registrados no se reescriben.

- `MOVIL`: valor del saldo / cantidad del saldo al momento de la salida.
- `PERIODO`: valor de los ingresos del mismo `periodoImputado` / cantidades
  ingresadas en ese período, usando sólo hechos existentes al registrar.
- Flete y gastos de compra se prorratean en el costo unitario del ingreso.

Esto aplica Constitución §2 (no inventar datos ausentes), §3 (unidad explícita)
y §5 (caminos negativos primero).

## Alternativas descartadas

- Revaluar movimientos anteriores al cierre: rompería append-only y haría que
  una salida cambiara después de haber sido usada por una orden.
- Aplicar un único PPP móvil: ignoraría la política `PERIODO` pedida.
- Anticipar DEVOLUCIÓN para reproducir el neto 94.562,50: pertenece a #474.

## Consecuencias

Con compras de 100 × 1.000 y 60 × 1.300, `PERIODO` vale 1.112,50 por unidad.
Cuando #474 registre la devolución de 5 unidades al costo de salida, el consumo
neto de 85 unidades será 94.562,50. Hasta entonces este PR no inventa esa
devolución ni modifica movimientos ya guardados.
