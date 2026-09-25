---
issue: 469
repo: CosteAR-backend
pr: 486
rama: feat/ordenes-trabajo
agente: codex
modelo: gpt-5
tanda: C1
inicio: 2026-09-25T11:04:00-03:00
fin: 2026-09-25T11:23:00-03:00
minutos: 19
tokens: no-informado
clears: 0
intentos_hasta_verde: 4
rojos_deliberados: 1
rebotes_de_guarda: 1
---

# 2026-09-25 — Órdenes de trabajo

## Qué se hizo

- Se agregó `OrdenTrabajo` como entidad multi-período, con código único por
  empresa, datos descriptivos, fechas técnicas y ocho estados explícitos.
- Se implementó el recorrido secuencial desde `BORRADOR` hasta
  `PENDIENTE_CIERRE`, la cancelación previa al cierre y el rechazo tipado de
  saltos inválidos. `CERRADA` queda reservada al cierre de #479.
- Cada alta y transición escribe `TraceAuditLog` dentro de la misma transacción.
- Se publicaron las cuatro rutas requeridas, con respuestas que incluyen la
  etiqueta visible del estado y contrato OpenAPI con `requestBody`.
- La migración es aditiva y la tabla quedó cubierta por RLS y por la guarda que
  sincroniza `rls.sql` con `RLS_MODELS`.

## Recursos

- Tiempo: 19 minutos.
- Tokens: no informado.
- Intentos hasta verde: 4. El rojo deliberado verificó que el servicio aún no
  existía; luego la integración encontró dos defectos del camino real (lecturas
  fuera del contexto RLS y conversión de fecha) antes de quedar verde. La matriz
  completa encontró la omisión inicial en `RLS_MODELS`.
- Comandos: `npm run briefing`, `npm ci`, `npm run prisma:generate`,
  `npm run db:setup`, `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:http`, `npm run test:integration`, `npm run test:db`,
  `npm run openapi:generate`, `npm run check:openapi`,
  `npm run typecheck:openapi-consumer`, `npm run check:tests-base` y
  `npx prisma validate`.

## Camino rojo deliberado

Se escribió primero el test de aplicación para código duplicado, aislamiento y
transiciones. Los cinco casos fallaron porque el servicio no existía. Después,
el fixture FX-OT recorrió el flujo completo contra PostgreSQL con un rol sin
`BYPASSRLS`.

## Decisiones tomadas sobre la marcha

- **Historial de transiciones:** se usó `TraceAuditLog`, que ya es append-only y
  registra actor, fecha, estado anterior, estado nuevo y motivo. Crear otra
  tabla habría duplicado el mecanismo de auditoría. Constitución §7.
- **Fecha de fin técnica:** se estampa con hora del servidor al entrar en
  `TERMINADA_TECNICA`; no se acepta una hora provista por el cliente. La
  alternativa era dejarla nula hasta otro flujo, contradiciendo el significado
  del estado.
- **Plantilla:** `plantillaId` queda como UUID nullable sin clave foránea porque
  el modelo pertenece a #470 y adelantarlo ampliaría el alcance. Cuando exista,
  la relación podrá agregarse de forma aditiva.
- **Aislamiento:** todas las lecturas del servicio pasan por `withTenant`, además
  del filtro por `userId`; el test real confirmó el 404 y la invisibilidad SQL.

## Dónde el issue no alcanzaba

- No definía si la fecha técnica debía recibirse o estamparse; se aplicó la
  regla del repo de timestamps del servidor.
- No definía una tabla separada para el historial; se reutilizó la bitácora
  canónica existente, que contiene exactamente los campos pedidos.
- No indicaba una relación posible para `plantillaId`; #470 todavía no existe.

## Qué quedó afuera

- Modelos y etapas (#470), permisos por función (#471), presupuesto,
  inventario y horas.
- La transición que produce `CERRADA`, reservada a #479.
- Cambios al motor de cálculo; los fixtures existentes quedaron intactos.

## Verificación final

- Lint y typecheck: verdes.
- Unitarios: 2.012 verdes; 4 skips existentes.
- HTTP: 202 verdes.
- Integración: 90 verdes con rol de aplicación sin `BYPASSRLS`.
- DB/seguridad: 67 verdes con claves RSA efímeras y sonda RLS.
- OpenAPI, consumidor tipado y guarda de tests con base: verdes.
