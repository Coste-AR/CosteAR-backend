# ADR 0033 — Presupuesto versionado por orden

## Estado

Aceptado — 2026-09-25, issue #472.

## Contexto

La orden necesita conservar una base aprobada inmutable, adicionales separados y
un doble control entre preparación y aprobación. También necesita renglones con
unidad y etapa explícitas, sin modificar el motor de cálculo existente.

## Decisión

- `VersionPresupuesto` es una cabecera append-only en contenido: una versión
  aprobada no vuelve a borrador y no existe ruta de edición.
- Los actos de preparar, aprobar, rechazar y revalidar son transiciones auditadas
  en la misma transacción. Preparador y aprobador se estampan por ID y deben ser
  personas distintas.
- `RenglonPresupuesto` se normaliza para conservar unidad y etapa como claves
  verificables, en vez de guardar un JSON sin integridad referencial.
- La base es única por orden mediante índice parcial. Las demás versiones usan
  numeración correlativa por orden.
- El precio contractual suma únicamente BASE y ADICIONALES aprobados. Una
  REVISIÓN no reemplaza silenciosamente la base: esa política no está definida
  por el issue y deberá explicitarse antes de incorporarla al total.
- El vencimiento se evalúa al aprobar. Revalidar renueva la fecha y devuelve la
  versión a borrador para que vuelva a cumplir el doble control.

## Alternativas descartadas

- Guardar renglones como JSON: simplificaba la migración, pero perdía la unidad
  declarada y permitía asociar etapas ajenas.
- Actualizar la base aprobada: elimina el punto de comparación histórico.
- Contar revisiones aprobadas como ingreso: el issue sólo define base más
  adicionales y hacerlo inventaría la semántica de reemplazo.

## Consecuencias

La historia queda trazable y el contrato es determinista. A cambio, una futura
política de reemplazo por revisiones necesitará una decisión explícita y una
migración aditiva.

Constitución aplicada: §2 (no inventar valores), §3 (unidad con el valor), §5
(rojo antes que verde) y §9 (lo no escrito no se inventa).
