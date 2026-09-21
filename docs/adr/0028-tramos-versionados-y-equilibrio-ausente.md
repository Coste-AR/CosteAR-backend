# ADR 0028 — Tramos versionados y equilibrio ausente

## Estado

Aceptado — 2026-09-21.

## Contexto

Un punto de equilibrio aritmético puede superar la capacidad física del tramo que lo genera. Publicarlo como número con una advertencia permitiría que un consumidor ignore la advertencia y tome como alcanzable un volumen imposible. Además, corregir la capacidad no puede cambiar retrospectivamente la evidencia usada por un cálculo anterior.

## Decisión

- `TramoCosto` es una versión append-only asociada exactamente a un concepto o a un segmento. Una corrección retira la versión vigente y crea otra fila.
- El techo lo declara manualmente la cuenta dueña. Si hay `techoFisico`, `techoFuente` es obligatoria y se guardan actor y timestamp del servidor. No se deriva de `Deposito` ni de otra capacidad ajena.
- Cada cálculo persistido guarda los IDs de las versiones usadas y el resultado completo. Así una corrección posterior no altera la foto anterior.
- `REEMPLAZA` aplica `CF/cm` a toda la actividad. `ACUMULA` conserva la contribución de los escalones previos y resuelve únicamente las unidades adicionales.
- Un equilibrio fuera de `[desde, techo]` se devuelve como `null` con `motivoFueraDeTramo`; si otro tramo tiene equilibrio válido se publica por separado. No se publica el número imposible como resultado operativo.
- Sin tramos, o con un tramo sin techo declarado, el cálculo existente conserva su comportamiento y su rango físico queda abierto.

## Consecuencias

La API diferencia ausencia operativa de un cero y permite mostrar la función por tramos. Las filas históricas ocupan más espacio, a cambio de reproducibilidad y trazabilidad. Hasta la migración de roles de #401, «cuenta dueña» se verifica mediante la propiedad `Company.userId`; no se introduce un nombre de rol futuro en el enum vigente.

## Principios aplicados

- Constitución §2: ausencia declarada, nunca un valor inventado.
- Constitución §3: los valores viajan con rango y techo explícitos.
- Constitución §9: la fuente del techo sigue la decisión K escrita en #380.
