---
issue: 418
repo: Coste-AR/CosteAR-backend
pr: 420
rama: feat/418-alcance-cargadores
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-23T11:31:00-03:00
fin: 2026-09-23T11:55:00-03:00
minutos: 24
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 3
rebotes_de_guarda: 1
---

## Recursos

- Verificación: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:http`, `npm run test:integration`, `npm run test:db`, `npm run check:openapi`, `npm run typecheck:openapi-consumer` y `npm run check:tests-base`.
- Resultado: 1.905 unitarios, 86 integración/RLS y 67 de base en verde. HTTP: 165 pasaron y el flaky conocido `admin-stats` (#145) agotó 5 segundos; no se reintentó por indicación de `ESTADO.md`.
- La primera preparación de base usó el rol de aplicación para DDL y falló por permisos; se recuperó la marca local y se repitió con el rol dueño, conservando el rol sin `BYPASSRLS` para integración.

## Decisiones

- Se usaron dos tablas de unión con claves foráneas, una por tipo de entidad, en lugar de una referencia polimórfica sin integridad. Alternativa descartada: `entityType + entityId`, que permitiría referencias inexistentes. Constitución §3 y §4: el tipo viaja explícito y el paquete aporta sólo el vocabulario.
- Las membresías existentes reciben todas las entidades activas de su empresa durante la migración; las nuevas nacen vacías. Alternativa descartada: interpretar vacío como acceso total, porque contradice el criterio central. Constitución §2 y §9: ausencia declarada y sin inventar permisos.
- Los intentos denegados se escriben como `scope.denied`; los cambios de alcance se auditan en la misma transacción. Constitución §5: se escribieron primero los caminos rojos de vacío, entidad ajena y rol operador.
- Se extendió el CRUD existente de `empresa-portal` y se lo incorporó al generador OpenAPI, en lugar de crear rutas paralelas.

## Dónde el issue no alcanzaba

- `CorridaProduccion` no referencia hoy una `UnidadProductiva`, aunque la definición dice que cuelga de ella. No se inventó una relación de dominio fuera de alcance; sí quedaron protegidas las cargas que hoy tienen eje verificable: movimientos de depósito, eventos de lote y producción diaria.
- El checkout no tenía dependencias ni `.env`; se instalaron desde lockfile y se copió `.env.example` sólo para las suites locales.

## Qué quedó afuera

- Pantalla y consumo frontend: `Coste-AR/CosteAR-frontend#190`.
- Vincular `CorridaProduccion` a `UnidadProductiva`; requiere definición y migración propias.
