# Bitácora — issue #197: corrida de producción

Se usa promedio ponderado porque es la valuación que ya emplea el motor de
costeo por procesos. La alternativa solicitada por el cliente (precio máximo
para cubrirse) queda como pregunta abierta: no se incorporó una decisión nueva.

Los consumos guardan una valuación PPP por unidad y un `depositoId` opcional
reservado para enlazar A-12 cuando ese PR entre en `dev`; no se duplica la
lógica de stock. `costoPorKilo` sólo existe como resultado de leer consumos y
kilos reales. Una corrida sin consumos devuelve `null` e `incompleta: true`.

Fuera de alcance: costo transferido, desvío teórico/real y cambios al motor.
