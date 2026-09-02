# Bitácora — issue #191: punto de equilibrio persistido

## Decisión y supuesto explícito

El punto de equilibrio se persiste dentro de `CalculationRun.results`, que ya
está asociado al período y conserva la foto de resultados trazables. No se
creó una tabla paralela ni se cambió el motor de absorción.

Un cambio de precio de venta y cualquier guardado de configuración de costo
disparan una nueva corrida cuando la estructura está completa. Se eligieron
esos disparadores porque modifican directamente la contribución marginal. La
reclasificación de comportamiento queda fuera de este issue: no tiene todavía
un flujo de guardado que pueda disparar la corrida sin ampliar A-04.

## Fuera de alcance

Alertas por movimiento del punto de equilibrio, endpoint de lectura, frontend,
motor de absorción y cambios al flujo de clasificación.

## Verificación

- `npm ci`
- `npm run prisma:generate`
- `npm run lint -- --max-warnings=0` — verde.
- `npm run typecheck` — verde.
- `npm test -- tests/domain/punto-equilibrio.test.ts --run --reporter=dot` — 2 verdes.
- `npm run test:integration -- tests/integration/contribucion-marginal.test.ts --reporter=dot` — 1 verde con RLS real.
