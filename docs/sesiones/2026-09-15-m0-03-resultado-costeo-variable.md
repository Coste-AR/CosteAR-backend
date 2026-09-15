# Bitácora — M0-03: el tablero agrega el resultado por costeo variable

Backend de M0-03 (Ola B). El ajuste visual (cuál cifra queda destacada) es trabajo de
`CosteAR-frontend`, mismo patrón que MX-01/MX-02.

## El problema

`resultadoPeriodo` (el sexto indicador del tablero) se componía con `resultado.grossMargin` —
margen de **absorción**. El tablero se presenta como la vista de costeo variable del negocio, y
cuando producción ≠ venta las dos cifras son distintas sin que nada lo avise.

## Qué se hizo

`src/application/cost-structures/owner-dashboard-service.ts`:

- **`resultadoPeriodoCosteoVariable`** (nuevo) — `contribucionMarginalUnitaria × unidadesVendidas
  − costosFijosDelPeriodo`. Mismo criterio de completitud que `costosFijosDelPeriodo`/`costoPorCajon`
  (MX-02): sin corrida, sin unidad de gestión, sin producción o con clasificación incompleta, sale
  incompleto con el motivo correspondiente.
- **`resultadoPeriodo`** (absorción) — se conserva sin cambios de lógica; solo se extrajo a una
  variable local (`resultadoPeriodoField`) para reusarla en el cálculo de la diferencia sin
  duplicar la condición.
- **`diferenciaPorVariacionDeInventarios`** (nuevo) — resta directa entre las dos anteriores, con
  `explicacion: string | null` en castellano que dice de qué lado está la brecha (producción por
  encima o por debajo de la venta). `null` cuando coinciden (`|diferencia| < 0.01`) o cuando
  cualquiera de las dos fuentes está incompleta.
- **`owner-dashboard.schema.ts`** — los 2 campos nuevos entran al contrato Zod (sin esto,
  `fastify-type-provider-zod` los descarta en la respuesta — el mismo problema que tuvo MX-02).
- **ADR 0019** — cuál de los dos resultados queda destacado y por qué, y por qué la fórmula no
  necesitó esperar a M0-02.

## Decisiones

- **La fórmula no necesitó el split de M0-02.** `contribucionMarginalUnitaria × vendidas −
  costosFijosDelPeriodo` es algebraicamente idéntica a la fórmula que pedía el plan
  (`ventas − cv_producción_vendido − cv_comercialización − fijos`), y los dos términos ya existían
  de MX-01/MX-02. Esto **desbloquea M0-03 sin esperar M0-02** — el orden del mapa de tareas del
  plan sugería una dependencia que no era real para este resultado (sí importa para desglosar el
  costo variable en dos líneas, que es justamente lo que M0-02 hace y esto no necesita).
- **La diferencia se calcula restando los dos resultados ya calculados, no recalculando el costo
  fijo unitario de absorción por separado.** Es exacta por construcción — recalcularla por otra
  vía podría no coincidir centavo a centavo con lo que el motor realmente hace en
  `unitFinishedGoodsCost`. Documentado en el ADR.

## Fuera de alcance

- El ajuste visual del frontend (cuál cifra se destaca, cómo se muestra la explicación) — PR
  aparte de `CosteAR-frontend`.
- M0-02 (separar cv de producción vs. comercialización) sigue bloqueada por la falta del concepto
  "elemento" en `ComponenteAbsorcion` — eso lo trae M2-01, no esto.

## Verificación

```
npm run typecheck                                                verde
npx eslint <3 archivos tocados>                                  verde
npm run openapi:generate && npm run check:openapi                sincronizado desde el arranque
npx vitest run tests/http/owner-dashboard.test.ts --no-file-parallelism   11/11 verdes
npx vitest run --exclude 'tests/http/**'                         1561 verdes, 4 skip, 0 rojos
npx vitest run tests/http --no-file-parallelism                  20 archivos, 113 verdes
tests/integration/contribucion-marginal.test.ts                  2/2 verdes
```
