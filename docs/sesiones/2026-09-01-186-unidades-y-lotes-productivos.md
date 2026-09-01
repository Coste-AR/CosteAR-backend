# Bitácora — issue #186: unidades y lotes productivos

## Decisión de modelo

Se agregaron `UnidadProductiva` y `LoteProductivo` como entidades de operación
genérica. Cada una tiene UUID global, empresa, `userId` denormalizado y RLS.
La etiqueta visible de cada tipo queda fuera de estas tablas: corresponde al
paquete de rubro posterior.

## Suposición explícita: ubicación del lote

Se asumió que un lote puede trasladarse. `unidadProductivaId` representa su
ubicación actual y es opcional para permitir un estado transitorio. No se creó
un historial de traslados ni eventos: eso excede A-09. Una FK compuesta por
empresa y unidad impide asociar el lote a datos de otra empresa.

## Alcance

No se agregaron hechos de producción, bajas, depósitos ni corridas, y no se
modificó el motor de cálculo.

## Verificación

- `npm ci --force`
- `npm run prisma:generate`
- `npm run lint`
- `npm run typecheck`
- `npm test -- --reporter=dot --silent`
- `npm run test:integration` con base desechable y rol de aplicación sin
  `BYPASSRLS` (12 tests verdes)
- El barrido sobre los archivos nuevos no encontró los términos de rubro
  restringidos por el issue.
