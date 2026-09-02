# Bitácora — issue #195: producción diaria

## Supuestos tomados

- A-11 se apila sobre A-10 (PR #218), aunque el issue sólo nombre A-09. La
  postura requiere animales vivos al día de la producción y A-10 es la fuente
  que los deriva. Cuando A-10 entre en `dev`, el PR de A-11 se actualizará.
- La producción se guarda como unidades producidas por variante, con roturas y
  descartes como conteos separados. La postura usa las unidades producidas:
  rotura o descarte son huevos puestos, no una ausencia de puesta.
- Las variantes son texto del paquete de rubro, sin un enum ni cantidad fija.
- Una baja sin motivo sigue fuera del denominador de animales vivos, igual que
  A-10. Una producción con denominador de lote cero devuelve `null` y una
  inconsistencia explícita; no genera un porcentaje artificial.

## Fuera de alcance

- Stock, ventas, reparto de costos conjuntos y cambios al motor de costos.
