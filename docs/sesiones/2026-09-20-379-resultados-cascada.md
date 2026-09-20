---
issue: 379
repo: CosteAR-backend
pr: 396
rama: feat/379-resultados-cascada
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-20T20:02-03:00
fin: 2026-09-20T20:14-03:00
minutos: 12
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-20 — Resultados variables sin prorratear los indirectos

## Qué se hizo

Se agregó una función pura para construir el estado de resultados variable como un árbol de N niveles. Cada línea o sector resta sus propios fijos directos; recién después de consolidar las raíces se restan los fijos indirectos evitables y, en una fila posterior, los inevitables.

AM-12 prueba 40.000 de contribución nivel 1, 12.000 de nivel 2, 8.000 de nivel 3 y resultado cero. También prueba que las columnas A/B/C de ambas filas indirectas sean `null`, que A no reciba una recomendación de cierre por su fijo inevitable y que la existencia final excluya comercialización.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** representar línea → sector → empresa como un árbol genérico por `padreId`.
  **Qué otra opción había:** fijar tres niveles o devolver sólo una tabla plana.
  **Por qué elegí esta:** el issue pide N niveles; el árbol resta cada fijo donde es directo y no obliga a cambiar el cálculo cuando aparezca otro nivel.
- **Qué decidí:** las filas indirectas llevan columnas tipadas con valor exclusivamente `null` y el importe sólo en `total`.
  **Qué otra opción había:** omitir las columnas o repetir cero.
  **Por qué elegí esta:** hace comprobable R17 y respeta Constitución §2: cero no significa ausencia.
- **Qué decidí:** recibir el costo variable de producción vendido y, por separado, el costo unitario de producción para la existencia final.
  **Qué otra opción había:** reconstruir ambos desde unidades producidas/vendidas sin stock inicial.
  **Por qué elegí esta:** el issue no define stock inicial; reconstruirlo habría inventado una política. El tipo impide incorporar comercialización al stock.

## Dónde el issue no alcanzaba

El issue no define endpoint, DTO persistido ni cómo se poblará la jerarquía antes de M4-01. Se implementó la capa pura que el backend puede consumir sin anticipar ese contrato. Tampoco define la política de stock inicial; por eso el costo de lo vendido llega explícito y sólo la existencia final se valúa en esta función.

## Qué quedó afuera

- Pantalla frontend y contrato HTTP: no estaban especificados y M4-01 todavía debe definir la segmentación consumible.
- Persistencia de segmentos: corresponde a M4-01.
- Suites HTTP/integración/DB: no hay ruta, query, RLS ni cambio de schema.

## Con qué se verifica

```bash
npx vitest run tests/domain/estado-resultados-variable.test.ts
# 3/3 verdes; antes de implementar falló por módulo inexistente.

npm run lint
# verde
npm run typecheck
# verde
npm run test -- --maxWorkers=1
# 1.835 verdes, 4 skipped existentes
npm run check:tests-base
# verde
npm run check:openapi
# verde, 22 operaciones
npm run typecheck:openapi-consumer
# verde
```

La primera general con dos workers tuvo un timeout en `owner-dashboard`. El archivo pasó aislado 12/12 y la general final pasó con un worker, sin cambiar límites ni tests.
