---
issue: 473
repo: CosteAR-backend
pr: 491
rama: feat/inventario-ppp
agente: codex
modelo: gpt-5
tanda: C1
inicio: 2026-09-25T17:56:00-03:00
fin: 2026-09-25T18:18:31-03:00
minutos: 23
tokens: no-informado
clears: 0
intentos_hasta_verde: 4
rojos_deliberados: 3
rebotes_de_guarda: 1
---

# 2026-09-25 — Inventario de empresa a PPP

## Qué se hizo

- Se agregaron artículos con unidad explícita y movimientos de INGRESO, SALIDA
  y AJUSTE, ligados opcionalmente a depósito y obligatoriamente a orden para la
  salida.
- Se implementaron PPP MOVIL y PERIODO configurables por empresa, costo de
  adquisición con gastos de compra, bloqueo de stock negativo y saldos derivados.
- Se agregaron RLS, auditoría en la misma transacción, tres rutas y OpenAPI.
- FX-OT verifica 95.400 de chapa, 24.000 de perfiles, 160.000 de abertura y
  saldo de chapa de 70 unidades / 82.600 / PPP 1.180.

## Recursos

- Tokens: no informado. Clears: 0.
- Comandos: `npm run briefing`, `npm ci`, `npm run prisma:generate`,
  `npm run prisma:migrate inventario_ppp`, `npx prisma migrate deploy`,
  `npm run db:rls`, `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:http`, `npm run test:integration`, `npm run test:db`,
  `npm run openapi:generate`, `npm run check:openapi`,
  `npm run typecheck:openapi-consumer` y `npm run check:tests-base`.

## Caminos rojos deliberados

- Salida que deja stock negativo.
- Salida sin `ordenId`.
- Artículo de otra empresa.

## Decisiones tomadas sobre la marcha

- Los movimientos son un libro append-only separado del nivel físico legado de
  `Deposito`; ADR 0034, Constitución §2 y §3.
- PERIODO promedia ingresos del período ya existentes y no reescribe salidas;
  ADR 0034, Constitución §2.
- Los gastos de compra se prorratean por cantidad en el ingreso para conservar
  un costo unitario trazable.

## Dónde el issue no alcanzaba

- El valor 94.562,50 implica el neto de 85 unidades luego de la devolución de
  #474, aunque el texto lo llama «antes de la devolución». Se documentó el
  límite y no se anticipó el alcance siguiente.
- No definía si AJUSTE podía ser negativo; se implementó sólo ajuste positivo
  porque el contrato exige cantidad positiva y no autoriza borrar stock.

## Qué quedó afuera

- DEVOLUCIÓN y TRANSFERENCIA (#474).
- Material no medido por orden al pool fabril (#477).
- Importación de comprobantes externos.

## Verificación final

- Lint y typecheck verdes.
- Unitarios: 2.029 verdes; HTTP: 207 verdes.
- Integración: 94 verdes con rol sin `BYPASSRLS`.
- DB/seguridad: 67 verdes con sonda RLS y claves RSA efímeras.
- OpenAPI, consumidor tipado y guarda de tests con base: verdes.
