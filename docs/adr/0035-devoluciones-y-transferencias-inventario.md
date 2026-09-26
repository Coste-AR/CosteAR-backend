# ADR 0035 — Devoluciones y transferencias conservan el costo de origen

## Contexto

El issue #474 requiere que una devolución o transferencia no invente un costo nuevo. Además,
la política de devolución está marcada como configurable y una importación externa no puede
duplicar una imputación.

## Decisión

- `DEVOLUCION` y `TRANSFERENCIA` referencian una `SALIDA` mediante `movimientoOrigenId`.
- La cantidad acumulada de movimientos derivados no puede superar la cantidad de esa salida.
- `TRANSFERENCIA` conserva el costo unitario de la salida, acredita su orden y debita el mismo
  importe a una orden destino distinta, sin modificar el stock físico.
- La empresa declara `politicaDevolucionInventario`: `COSTO_SALIDA` es el default y
  `PPP_VIGENTE` la alternativa configurable.
- Una importación identificada por `identidadExterna` más `documentoHash` es idempotente por
  empresa. Ambos valores viajan juntos y la base impone su unicidad.

Esto aplica Constitución §2 (no inventar valores), §3 (la cantidad conserva su artículo y unidad),
§4 (política de empresa, no condición por cliente) y §5 (caminos negativos primero).

## Alternativas descartadas

- Recalcular la transferencia al PPP vigente: podría acreditar y debitar importes distintos.
- Guardar dos movimientos físicos para una transferencia: duplicaría un hecho que no cambia el
  saldo del depósito y permitiría que una mitad quedara sin la otra.
- Usar sólo el nombre visible del documento para deduplicar: nombres iguales son legítimos y el
  contenido puede cambiar.

## Consecuencias

Los movimientos siguen siendo append-only. El stock suma devoluciones y no cambia por
transferencias. La orden origen y la destino reciben exactamente el mismo importe con signo
opuesto, y cada hecho conserva el costo aplicado para su trazabilidad.
