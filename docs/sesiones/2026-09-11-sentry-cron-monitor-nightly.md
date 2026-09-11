# Bitácora — Sentry Cron Monitor en `nightly-learning`

## Qué se hizo

`worker.on('failed')` solo avisaba si el job de `nightly-learning` **tiraba** un error. Si el
proceso nunca arrancaba (el repetible de BullMQ se pierde, el proceso worker no levanta, Redis no
responde antes de encolar), nadie se enteraba hasta notar a ojo que hacía días que no había
señales nuevas.

- **`src/infrastructure/workers/nightly-learning.worker.ts`**: la corrida de
  `service.runNightlyPipeline()` queda envuelta en `Sentry.withMonitor('nightly-learning', …, config)`.
  Manda check-ins `in_progress` / `ok` / `error` — Sentry crea el monitor solo en el primer
  check-in (upsert), no hace falta configurarlo a mano en el dashboard.
- **`src/infrastructure/workers/repeatable-jobs.ts`**: `NIGHTLY_CRON` y `TIMEZONE` pasan de
  privados a exportados, para que el worker reuse el mismo patrón de cron que ya dispara el job en
  vez de tener una segunda copia del `'0 2 * * *'` que se pueda desalinear con el tiempo — es
  literalmente el bug que este archivo dice, en su propio comentario, haber existido para evitar.

## Decisiones

- **`checkinMargin: 10`, `maxRuntime: 10`**: 10 minutos de margen antes de arrancar (Redis/proceso
  pueden tardar un poco en levantar apenas dispara el cron) y 10 minutos de techo — mismo valor que
  `lockDuration` del worker, ya pensado para el volumen de `daily_signals` que puede procesar.
- **Sin test nuevo del worker**: siguiendo el patrón existente, ningún `*.worker.ts` de este repo
  tiene test directo (`daily-run.worker.ts`, `macro-sync.worker.ts` tampoco) — construir un
  `Worker` de BullMQ necesita una conexión real/mockeada pesada para poco beneficio; la lógica de
  negocio (`NightlyLearningService`) ya está testeada aparte.

## Fuera de alcance

Requiere `SENTRY_DSN` configurado en el ambiente para mandar los check-ins — ya es una env var
opcional existente (`env.ts`), sin secreto nuevo que crear. Si no está seteada, `Sentry.init` no
corre y `withMonitor` es un no-op silencioso (mismo comportamiento que hoy con `captureException`).

## Verificación

```
npm run typecheck                                                    # verde
npx eslint src/infrastructure/workers/{nightly-learning.worker,repeatable-jobs}.ts   # verde
npx vitest run tests/application/repeatable-jobs.test.ts             # 9/9 verdes
```
