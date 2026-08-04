-- Columnas de detalle del issue de Sentry en `system_alerts` (culprit,
-- errorType, errorValue, occurrenceCount, firstSeenAt, lastSeenAt, platform).
--
-- BUG: estas columnas están declaradas en schema.prisma desde
-- "feat(system): persistir campos de issue detallados de webhooks de Sentry"
-- (PR #32), pero nunca se generó su migración -- alguien las aplicó con
-- `prisma db push` en vez de `prisma migrate dev`, así que quedaron en la
-- base de desarrollo de esa persona pero en ningún lado más. `migrate deploy`
-- (lo que corre el Dockerfile en cada deploy) solo aplica migraciones
-- COMMITEADAS: sin este archivo, `system_alerts` nunca tuvo estas columnas en
-- Railway, y todo `GET /system-alerts` tiraba 500 (P2022 "column does not
-- exist") desde que se mergeó esa feature. Confirmado en los logs de Railway
-- del ambiente staging.
--
-- Migración ADITIVA e IDEMPOTENTE.

-- AlterTable
ALTER TABLE "system_alerts"
    ADD COLUMN IF NOT EXISTS "culprit"         TEXT,
    ADD COLUMN IF NOT EXISTS "errorType"       TEXT,
    ADD COLUMN IF NOT EXISTS "errorValue"      TEXT,
    ADD COLUMN IF NOT EXISTS "occurrenceCount" INTEGER,
    ADD COLUMN IF NOT EXISTS "firstSeenAt"     TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "lastSeenAt"      TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "platform"        TEXT;
