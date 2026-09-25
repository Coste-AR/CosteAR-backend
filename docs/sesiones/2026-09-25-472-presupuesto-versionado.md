---
issue: 472
repo: CosteAR-backend
pr: pendiente
rama: feat/presupuestos-por-version
agente: codex
modelo: gpt-5
tanda: C1
inicio: 2026-09-25T16:57:48-03:00
fin: 2026-09-25T17:14:00-03:00
minutos: 17
tokens: no-informado
clears: 0
intentos_hasta_verde: 3
rojos_deliberados: 3
rebotes_de_guarda: 1
---

# 2026-09-25 — Presupuesto versionado por orden

## Qué se hizo

- Se agregó presupuesto BASE, ADICIONAL y REVISIÓN con renglones tipados, unidad
  y etapa explícitas.
- Se implementaron preparación, aprobación por otra persona, rechazo,
  revalidación y vencimiento.
- El precio contractual suma sólo base y adicionales aprobados; el fixture FX-OT
  da 2.250.000 de precio y 1.500.000 de costo previsto.
- Las mutaciones auditan en la misma transacción y las tablas nuevas tienen RLS.
- Se agregaron las seis rutas y su contrato OpenAPI.

## Recursos

- Tokens: no informado.
- Clears: 0.
- Intentos hasta verde: 3.
- Comandos: `npm run briefing`, `npm ci`, `npm run prisma:generate`,
  `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:http`,
  `npm run test:integration`, `npm run test:db`, `npm run openapi:generate`,
  `npm run check:openapi`, `npm run typecheck:openapi-consumer`,
  `npm run check:tests-base`, `npx prisma validate` y `npm run db:setup`.

## Caminos rojos deliberados

- Aprobar una base vencida sin revalidar.
- Reabrir una base aprobada para editarla.
- Preparar y aprobar con la misma persona.

La guarda RLS también frenó la primera corrida hasta declarar ambos modelos en
`RLS_MODELS`. Un timeout de carga ajeno en `admin-stats` pasó al repetir la suite
completa; no se modificó ese test.

## Decisiones tomadas sobre la marcha

- Se normalizaron los renglones y se dejó una única base por orden. ADR 0033;
  Constitución §3.
- Una revisión no entra al precio contractual hasta que se defina si reemplaza
  la base. ADR 0033; Constitución §2 y §9.
- Revalidar vuelve a borrador y exige repetir preparación/aprobación, para no
  saltear el doble control del issue. Constitución §5.

## Dónde el issue no alcanzaba

- No definía cómo una REVISIÓN aprobada reemplaza a la BASE.
- No definía edición de borradores; se omitió la ruta para garantizar la
  inmutabilidad pedida y mantener el alcance en las seis rutas enumeradas.
- No definía si `vigenteDesde + vigenciaDias` vence al inicio o al final del día;
  se compara por fecha UTC y vence cuando la fecha límite ya quedó atrás.

## Qué quedó afuera

- Informe presupuesto vs. real (#478).
- Una política de reemplazo de BASE por REVISIÓN.
- Edición de borradores, no incluida entre las rutas del issue.

## Verificación final

- Lint y typecheck: verdes.
- Unitarios: 2.026 verdes; 4 skips existentes.
- HTTP: 207 verdes.
- Integración: 93 verdes con rol sin `BYPASSRLS`.
- DB/seguridad: 67 verdes con sonda RLS y claves RSA efímeras.
- OpenAPI, consumidor tipado, guarda de tests con base y Prisma validate:
  verdes.
- Las 106 migraciones y 305 sentencias RLS quedaron aplicadas en la base local.
