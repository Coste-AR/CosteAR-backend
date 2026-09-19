---
issue: 373
repo: CosteAR-backend
pr: 382
rama: feat/373-zona-equilibrio
agente: codex
modelo: no-informado
tanda: B3
inicio: 2026-09-18T19:54:37-03:00
fin: 2026-09-18T20:07:32-03:00
minutos: 13
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 0
rebotes_de_guarda: 0
---

# 2026-09-18 — Zona de equilibrio integrada con las fórmulas nuevas

## Qué se hizo

- Rebase del PR #382 sobre `origin/dev` (`9da7b40`), con respaldo local `backup/pr382-20260918`.
- El conflicto de `punto-equilibrio.ts` conserva el formulario de M3-01 y la zona de M1-03. Los puntos, zonas y respuestas incompletas conservan `basadoEn` y `tramoValidez`.
- A-05 comprueba una zona finita cuando sólo falta clasificación, su persistencia y la igualdad entre simulador y cálculo. Si se quita el precio, sigue comprobando `incompleta: true`.

## Diagnóstico del enum

El log de [integration-tests de la versión anterior](https://github.com/Coste-AR/CosteAR-backend/actions/runs/35043885482/job/104629432697) muestra que `NO_DEFINIDO` se usa exclusivamente en `comportamiento-costo.test.ts`, en el test **rechaza un valor fuera de VARIABLE, FIJO y SEMIFIJO**. Ese archivo pasa 3/3; el `22P02` es la excepción que el test exige. El único fallo de esa corrida es A-05, cuya expectativa anterior pedía incompleta en lugar de zona.

No se agrega `NO_DEFINIDO` al enum: no es una clasificación del dominio ni un cambio nuevo de schema. Agregarlo haría fallar el test negativo y aceptaría un dato inválido. La clasificación pendiente sigue siendo `null`. No se filtra ningún error en el servicio.

## Decisiones y alcance

Se preserva el control negativo del enum y se verifica su resultado contra Postgres, en lugar de cambiar el dominio por un mensaje de log. No se cambian el motor auditado ni los fixtures numéricos.

## Dónde el issue no alcanzaba

El comentario confundía el error esperado del test negativo con un fallo de migración; se contrastó con el código y el log completo. El primer timestamp medido se usa como inicio; el tiempo anterior no se estimó.

## Qué quedó afuera

Pantalla frontend y reparto de importes agregados entre conceptos individuales, tal como declara el PR original. No se modifica infraestructura ni se promueve ninguna rama.

## Verificación

- `npm run prisma:generate`: aprobado; el schema no cambia.
- `npm run lint`, `npm run typecheck`: aprobados.
- `npm run test:integration -- tests/integration/contribucion-marginal.test.ts tests/integration/comportamiento-costo.test.ts`: 6/6.
- `npm run test:integration`: 23 archivos, 76/76; base local separada `costear_codex_20260918` en puerto 5433, rol `costear_app` sin BYPASSRLS y migraciones/RLS con rol dueño.
- `npm test -- --maxWorkers=2 --testTimeout=30000`: 204 archivos aprobados, uno omitido; 1785 tests aprobados y cuatro omisiones existentes. La corrida inicial con el límite de 5 segundos tuvo cuatro timeouts de arranque (`owner-dashboard`, `briefing-messages`, `admin-stats` y `vault-query-feedback`). No se cambian los tests ni el límite del repo: se usa un límite local de 30 segundos bajo carga de Playwright, y CI verifica la configuración original.
- `npm run test:http -- --maxWorkers=2 --testTimeout=30000`: 22 archivos, 126/126.
- `npm run check:openapi`: aprobado; los artefactos coinciden con las rutas.
- `npm run typecheck:openapi-consumer`, `npm run check:tests-base`: aprobados. Lint y typecheck completos repetidos al finalizar, ambos aprobados.
