---
issue: 422
repo: CosteAR-backend
pr: 432
rama: feat/422-capacidad-ociosa
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-23T15:32:00-03:00
fin: 2026-09-23T15:55:00-03:00
minutos: 23
tokens: no-informado
clears: 0
intentos_hasta_verde: 4
rojos_deliberados: 2
rebotes_de_guarda: 0
---

# 2026-09-23 — La capacidad ociosa sale completa y sin doble conteo

## Qué se hizo

- Se publicó `GET /companies/{companyId}/analisis/capacidad-ociosa` sobre la última corrida disponible, priorizando una validada.
- R22 informa la contribución marginal no obtenida; MOD reutiliza el `idleCapacity` existente y CIP expone presupuesto, volumen y el control de dos vías.
- Las tres vías se mantienen bloqueadas con un motivo accionable hasta que O1-02 provea una base estándar.
- El contrato quedó tipado y publicado en OpenAPI.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** calcular R22 solamente cuando `operationScaleUnit` declara `unidades_por_periodo`.
  **Qué otra opción había:** mezclar una escala anual con las unidades reales de una corrida mensual, o usar las horas de CIP como si fueran unidades.
  **Por qué elegí esta:** ambas alternativas rompen Constitución §3; sin magnitudes comparables se devuelve ausencia declarada según Constitución §2.
- **Qué decidí:** seleccionar primero la corrida validada más reciente y, si no hay una, la automática más reciente.
  **Qué otra opción había:** tomar siempre la última aunque una validada anterior sea la vigente.
  **Por qué elegí esta:** replica la semántica ya usada por los resultados vigentes y evita presentar una foto no revisada como preferente.
- **Qué decidí:** agregar una vista de lectura, sin recalcular ni modificar el motor.
  **Qué otra opción había:** incorporar la descomposición de tres vías al motor.
  **Por qué elegí esta:** el issue y el plan la dejan expresamente fuera hasta O1-02.

## Dónde el issue no alcanzaba

- No especificaba de dónde sale la capacidad normal en unidades para R22. Se usó la escala operativa solo cuando declara explícitamente que corresponde al período; cualquier otra unidad queda ausente con motivo.
- No indicaba qué corrida elegir cuando una empresa tiene varias estructuras. Se siguió la regla existente de priorizar una corrida validada y luego fecha de ejecución.

## Qué quedó afuera

- La descomposición CIP en tres vías: depende de O1-02 y de una base estándar para la producción real.
- La pantalla: corresponde a un issue de frontend separado.
- No se modificaron schema, migraciones ni fórmulas del motor auditado.

## Con qué se verifica

```bash
npm run lint                         # verde
npm run typecheck                    # verde
npm run test                         # 1.913 verdes, 4 omitidos
npm run test:http                    # 172 verdes
npm run test:integration             # 87 verdes
npm run test:db                      # 67 verdes
npm run check:openapi                # verde; 48 operaciones tipadas
npm run typecheck:openapi-consumer   # verde
npm run check:tests-base             # verde
```

La primera corrida HTTP en paralelo con unitarios y lint agotó el límite de 5 segundos en dos tests ajenos; corrida sola pasó 172/172. La primera corrida de base usó el rol restringido donde la suite `test:db` exige el dueño y la segunda no tenía claves JWT locales; con roles correctos y claves efímeras generadas en memoria pasó 67/67.
