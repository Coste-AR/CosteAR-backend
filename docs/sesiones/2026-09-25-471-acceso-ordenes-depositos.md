---
issue: 471
repo: CosteAR-backend
pr: 489
rama: feat/acceso-ordenes-depositos
agente: codex
modelo: gpt-5
tanda: C1
inicio: 2026-09-25T15:55:00-03:00
fin: 2026-09-25T16:22:00-03:00
minutos: 27
tokens: no-informado
clears: 0
intentos_hasta_verde: 4
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-25 — Acceso por función a órdenes y depósitos

## Qué se hizo

- Se agregó alcance explícito por orden y ocho permisos funcionales negados por
  defecto en cada membresía.
- Se extendió la pantalla/API de gestión existente para administrar entidades y
  permisos sin crear un circuito paralelo.
- Las rutas de órdenes y depósitos resuelven al dueño del tenant, conservan al
  operador como actor y devuelven 403 cuando falta entidad o capacidad.
- Precio contractual y campos `margen*` se omiten si falta
  `ordenes.ver_margen`; nunca se reemplazan por cero.
- Se reforzó RLS para que el rol de aplicación solo lea órdenes, depósitos y la
  conexión expresamente autorizados.

## Recursos

- Tiempo: 27 minutos.
- Tokens: no informado.
- Intentos hasta verde: 3.
- Comandos: `npm run briefing`, `npm ci`, `npm run prisma:generate`,
  `npm run db:setup`, `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:http`, `npm run test:integration`, `npm run test:db`,
  `npm run openapi:generate`, `npm run check:openapi`,
  `npm run typecheck:openapi-consumer`, `npm run check:tests-base` y
  `npx prisma validate`.

## Camino rojo deliberado

El test del paquete falló primero porque no existía ninguna matriz de acceso.
La primera prueba RLS también devolvió cero filas con permiso concedido: reveló
que la política de conexiones ocultaba la relación necesaria al propio
operador. Ambas fallas quedaron verdes después de implementar las dos capas.

## Decisiones tomadas sobre la marcha

- Se eligió entidad más capacidad, en vez de roles nuevos o booleanos por
  función. La decisión completa está en ADR 0032. Constitución §4 y §9.
- Las escrituras usan el `userId` dueño del tenant y auditan por separado al
  operador. Así el dato sigue perteneciendo a la empresa. Constitución §5.
- Los importes de presupuesto no se agregaron antes de #472/#478; el filtro HTTP
  ya es compatible con ellos y expresa ausencia real. Constitución §2 y §9.

## Dónde el issue no alcanzaba

- No definía el tipo de persistencia de los permisos; se usó un arreglo cerrado
  y validado contra el catálogo del paquete.
- Pedía ocultar precio y margen antes de que esos campos existan en el modelo;
  se implementó filtrado compatible sin inventar valores ni endpoints.
- No indicaba qué tenant debe escribir cuando actúa un operador; se conserva el
  dueño y se registra al actor por separado.

## Qué quedó afuera

- El informe de margen y sus importes, definidos por #478.
- Presupuestos y aprobación, definidos por #472.
- La pantalla frontend; el issue la declara fuera de alcance.

## Verificación final

- Lint y typecheck: verdes.
- Unitarios: 2.020 verdes; 4 skips existentes.
- HTTP: 206 verdes.
- Integración: 93 verdes con rol sin `BYPASSRLS`.
- DB/seguridad: 67 verdes con sonda RLS y claves RSA efímeras.
- OpenAPI, consumidor tipado, guarda de tests con base y Prisma validate:
  verdes.
- Las 105 migraciones y las 293 sentencias RLS se aplicaron desde una base
  vacía.
