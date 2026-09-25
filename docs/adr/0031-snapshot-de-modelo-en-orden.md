# ADR 0031 — La orden guarda un snapshot del modelo

## Estado

Aceptado — 2026-09-25.

## Contexto

El issue #470 exige que una orden creada desde un modelo conserve sus etapas y
renglones base aunque el modelo cambie después. También reserva la definición
del presupuesto por renglón al #472, por lo que este cambio no puede anticipar
campos ni reglas de cálculo de ese dominio.

## Decisión

- Las etapas del modelo son filas relacionales ordenadas y se copian a
  `EtapaOrden` dentro de la misma transacción que crea la orden.
- Los renglones base viajan como un arreglo JSON opaco y se copian a
  `OrdenTrabajo.renglonesBase`. #472 definirá su estructura y validación sin
  obligar a este issue a inventarla.
- La plantilla del paquete es global y de solo lectura para el rol de la
  aplicación; las plantillas de empresa quedan aisladas por `userId` y RLS.
- Una orden sin `plantillaId` recibe las etapas por defecto declaradas por su
  `PaqueteRubro`; no hay condiciones por nombre de cliente.

## Alternativas descartadas

- **Leer siempre las etapas desde la plantilla:** una edición reescribiría el
  alcance histórico de órdenes ya creadas.
- **Diseñar ahora los renglones normalizados:** ampliaría el alcance de #470 y
  fijaría decisiones que pertenecen explícitamente a #472.
- **Guardar las etapas también como JSON:** dificultaría ordenar, consultar y
  distinguir entrega e instalación sin validación relacional.

## Consecuencias

La orden conserva una fotografía estable y auditable. Hay duplicación
intencional entre modelo y orden, y #472 deberá migrar o validar el contenido de
`renglonesBase` cuando defina su contrato. Se aplican Constitución §4 (el
paquete decide), §5 (rojo antes que verde) y §9 (no inventar la estructura
pendiente).
