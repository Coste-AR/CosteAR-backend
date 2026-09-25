---
issue: 470
repo: CosteAR-backend
pr: 487
rama: feat/plantillas-etapas-orden
agente: codex
modelo: gpt-5
tanda: C1
inicio: 2026-09-25T12:08:00-03:00
fin: 2026-09-25T12:25:00-03:00
minutos: 17
tokens: no-informado
clears: 0
intentos_hasta_verde: 5
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-25 — Modelos y etapas de órdenes

## Qué se hizo

- Se agregaron `PlantillaOrden`, sus etapas ordenadas y el snapshot
  `EtapaOrden`, con migración aditiva y aislamiento RLS.
- La creación de una orden copia etapas y renglones base en la misma
  transacción; si no se elige modelo, usa las siete etapas del paquete.
- Se incorporó el modelo global «Módulo de 40 pies», con siete etapas y dos de
  entrega, además de las rutas de consulta de modelos y etapas visibles.
- Se regeneraron el contrato OpenAPI y su consumidor TypeScript.

## Recursos

- Tiempo: 17 minutos.
- Tokens: no informado.
- Intentos hasta verde: 5. El rojo deliberado produjo dos fallas funcionales;
  los otros rojos fueron de preparación local (`node_modules`, variables de
  PostgreSQL y claves RSA efímeras) y se corrigieron sin cambiar producto.
- Comandos: `npm run briefing`, `npm ci`, `npm run prisma:generate`,
  `npx prisma validate`, `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:http`, `npm run test:integration`, `npm run test:db`,
  `npm run openapi:generate`, `npm run check:openapi`,
  `npm run typecheck:openapi-consumer`, `npm run check:tests-base` y deploy
  completo de las 103 migraciones sobre una base vacía.

## Camino rojo deliberado

Antes de implementar se agregaron los casos de snapshot inmutable y plantilla
de otra empresa. Fallaron porque todavía no existían ni los modelos Prisma ni
los métodos del servicio. Luego quedaron verdes contra PostgreSQL con el rol de
aplicación sin `BYPASSRLS`.

## Decisiones tomadas sobre la marcha

- Los renglones base se conservan como JSON opaco hasta que #472 defina su
  contrato; normalizarlos ahora habría inventado campos fuera de alcance.
- Las etapas sí son relacionales, porque su clave, orden y condición de entrega
  ya están definidos y necesitan restricciones de unicidad.
- La plantilla global se siembra por migración y el rol de aplicación sólo
  puede leerla; las plantillas propias sí se aíslan y escriben por tenant.
- Se documentó el snapshot en ADR 0031. Constitución §4, §5 y §9.

## Dónde el issue no alcanzaba

- No definía la estructura interna de `renglonesBase`; se mantuvo opaca para no
  adelantar #472.
- No indicaba cómo identificar el modelo del paquete; se usó un UUID estable,
  compatible con el `plantillaId` ya publicado por #469.

## Qué quedó afuera

- Alta y edición de modelos por HTTP; el issue sólo pide listarlos.
- Estructura, validación y cálculo de renglones de presupuesto (#472).
- Cualquier cambio al motor de cálculo.

## Verificación final

- Lint y typecheck: verdes.
- Unitarios: 2.015 verdes; 4 skips existentes.
- HTTP: 204 verdes.
- Integración: 92 verdes con rol sin `BYPASSRLS`.
- DB/seguridad: 67 verdes con sonda RLS y claves RSA efímeras.
- OpenAPI, consumidor tipado, guarda de tests con base y Prisma validate:
  verdes.
- Las 103 migraciones y las políticas RLS se aplicaron desde cero; el modelo
  global produjo exactamente siete etapas.
