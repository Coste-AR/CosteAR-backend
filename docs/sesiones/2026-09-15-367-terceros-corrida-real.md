---
issue: 367
repo: CosteAR-backend
pr: 376
rama: fix/367-third-party-work
agente: codex
modelo: gpt-5
tanda: B2
inicio: 2026-09-15T16:00-03:00
fin: 2026-09-15T16:20-03:00
minutos: 20
tokens: no-informado
clears: 0
intentos_hasta_verde: 3
rojos_deliberados: 0
rebotes_de_guarda: 0
---

# 2026-09-15 — Los trabajos de terceros llegan al tablero

## Qué se hizo

`CalculationRunService` ahora incorpora los trabajos de terceros a la corrida
que persiste el resultado del tablero. Una prueba con Postgres carga el importe
por el servicio productivo y verifica que el costo real sube y el margen baja
exactamente por ese valor.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** una corrida con `periodId` usa ese período; una corrida manual
  usa el período abierto más reciente; si no existe período, cae al espejo de
  `CostStructure`.
- **Qué otra opción había:** leer siempre el espejo vigente de la estructura.
- **Por qué elegí esta:** el dato pertenece al período y una corrida histórica o
  diaria no puede cambiar porque el espejo vigente haya avanzado. El fallback
  conserva el comportamiento de estructuras anteriores al modelo de períodos.

- **Qué decidí:** registrar la amortización faltante como issue separado #375.
- **Qué otra opción había:** cablearla junto con trabajos de terceros en este PR.
- **Por qué elegí esta:** la amortización requiere reutilizar la derivación de
  activos y parámetros de `CostPeriodService`; mezclarla ampliaba #367 y podía
  duplicar una fórmula contable.

## Dónde el issue no alcanzaba

El issue decía leer `thirdPartyWork` «del período/estructura», pero no fijaba la
precedencia cuando ambos importes difieren. Se eligió período explícito, período
abierto y estructura, en ese orden.

## Qué quedó afuera

`assetDepreciation` también falta en la corrida real del tablero. Quedó
documentado en #375 para resolverlo sin tocar el motor auditado ni duplicar la
derivación de amortización.

## Con qué se verifica

```bash
npm run prisma:generate
npm run lint
npm run typecheck
npm test
npm run test:http
DATABASE_URL=<rol-app-local> MIGRATION_DATABASE_URL=<rol-dueno-local> npm run test:integration
```

Resultados finales: lint y typecheck en verde; 1.697 unitarios, 115 HTTP y 70
de integración pasaron. El CI del PR #376 también completó build, integración
y E2E en verde. El primer intento no ejecutó Vitest porque faltaba
`node_modules`; otro intento paralelo agotó los timeouts del runner y se repitió
en serie. La primera regresión con base detectó contaminación entre casos y se
aisló restaurando el dato mediante la misma mutación auditada.
