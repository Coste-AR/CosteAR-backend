---
issue: 426
repo: CosteAR-backend
pr: 437
rama: feat/426-mezcla-optima
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-23T19:37:15-03:00
fin: 2026-09-23T19:56:42-03:00
minutos: 20
tokens: no-informado
clears: 0
intentos_hasta_verde: 4
rojos_deliberados: 2
rebotes_de_guarda: 0
---

# 2026-09-23 — La mezcla se ordena por el recurso que realmente limita

## Qué se hizo

- Se agregaron `RecursoEscaso` y `ConsumoRecursoPorUnidad` con migración aditiva, unidad explícita y RLS por empresa.
- Se implementó la heurística de un recurso: ordena por contribución marginal por unidad del recurso y asigna hasta agotar disponibilidad o demanda.
- Se publicó `GET /companies/{companyId}/analisis/mezcla-optima` en OpenAPI. AM-06 entrega 140.000; sin cuello activo declara ausencia y con dos activos responde 422 accionable.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** persistir `demandaMaxima` junto al consumo por unidad. **Qué otra opción había:** calcular sin límite de demanda o recibirla por query. **Por qué elegí esta:** §8.10 exige asignar hasta agotar recurso o demanda y AM-06 depende de esos topes; sin persistirlos el resultado no es reproducible. Aplica Constitución §2 (no inventar disponibilidad) y §3 (unidad junto al valor).
- **Qué decidí:** devolver 200 con `ranking: []` y `motivoSinRanking` cuando no hay cuello activo. **Qué otra opción había:** responder 422 también en ausencia. **Por qué elegí esta:** el criterio del issue pide ausencia declarada, mientras reserva el 422 para dos o más restricciones. Aplica Constitución §2.
- **Qué decidí:** usar `SegmentoAnalisis` como producto del ranking. **Qué otra opción había:** crear otra entidad de producto sólo para esta heurística. **Por qué elegí esta:** el modelo de referencia vincula el consumo a `segmentoId`; reutilizarlo mantiene el cambio dentro de M8-01 y evita ampliar el dominio.

## Dónde el issue no alcanzaba

- §7.5 enumeraba tres campos para el consumo, pero §8.10 y AM-06 también requieren demanda máxima. Se agregó el campo mínimo que hace ejecutable esa fórmula.
- El contrato HTTP sólo nombraba `producto`, `cme` y `cm`; para que el resultado sea verificable se incluyeron además cantidad y recurso asignados, demanda, consumo y sus unidades.
- La primera preparación de la base usó por error el rol de aplicación para migrar y PostgreSQL la rechazó; se repitió con el rol dueño y luego las pruebas corrieron con el rol sin `BYPASSRLS`.
- La suite unitaria completa tuvo un timeout aislado en `admin-stats`; el archivo pasó 2/2 al ejecutarlo solo. No hubo falla ligada al cambio.

## Qué quedó afuera

- Programación lineal para dos o más recursos (`M9-01`), expresamente fuera de alcance.
- La pantalla frontend, asignada a un issue separado.
- CRUD HTTP de configuración de recursos y consumos: el issue sólo pidió los modelos y el endpoint de análisis.

## Con qué se verifica

```bash
npm run prisma:generate                         # verde
npm run lint                                    # verde
npm run typecheck                               # verde
npm run test                                    # 1.937 verdes, 4 omitidos; timeout aislado admin-stats
npx vitest run tests/http/admin-stats.test.ts   # 2/2 verde
npm run test:http                               # 186/186 verde
npm run test:integration                        # 87/87 verde, rol sin BYPASSRLS
npm run test:db                                 # 67/67 verde
npm run check:openapi                           # verde, 52 operaciones tipadas
npm run typecheck:openapi-consumer              # verde
npm run check:tests-base                        # verde
```
