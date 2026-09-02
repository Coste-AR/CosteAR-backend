# Bitácora — issue #185: comportamiento de costo

## Decisión de modelo

Se agregó `comportamientoVolumen` a `ParametroCosteo`, en lugar de alterar los
JSON de configuración de `CostStructure` o el motor. La clasificación necesita
el mismo alcance que una decisión de negocio: empresa, estructura y período.
`ParametroCosteo` ya resuelve esa cascada y ya está cubierto por RLS.

El alcance por rubro no existe como columna de `ParametroCosteo`. Se asumió que
A-04 producirá propuestas por rubro y que esta tabla persistirá solamente la
decisión explícita que las confirma en el alcance correspondiente. Por eso no
se agregó ningún default por rubro ni se clasificaron filas existentes.

## Trazabilidad y compatibilidad

`clasificadoPorUserId` y `clasificadoEn` son opcionales para conservar las
filas históricas, pero una restricción de PostgreSQL exige que ambos existan
siempre que exista `comportamientoVolumen`. `FIJO` se documenta como no variable
con el volumen; no como importe que nunca cambia.

La migración no agrega default y no toca el motor de absorción. Una clasificación
nueva es una capa de decisión sobre importes ya calculados, no una reescritura
de esos importes.

## Verificación

- `npm ci --force`
- `npm run prisma:generate`
- `npm run lint`
- `npm run typecheck`
- `npm test -- --reporter=dot --silent`
- `npm run test:integration` con una base desechable y rol de aplicación sin
  `BYPASSRLS` (12 tests verdes); el caso dirigido A-03 terminó 3/3.
