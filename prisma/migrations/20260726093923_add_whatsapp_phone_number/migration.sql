-- Canal de WhatsApp: teléfono de la conexión empresa ↔ costista.
--
-- Por qué llega tarde: la columna estaba en `schema.prisma` (con `@unique`)
-- desde que se sumó el módulo de WhatsApp, pero NINGUNA migración la creaba.
-- `prisma migrate diff` la reportaba como drift y, sobre todo, una base creada
-- desde cero levantaba sin ella: el webhook de WhatsApp fallaba en runtime al
-- buscar la conexión por teléfono. Detectado en la verificación de B20 sobre
-- una base limpia.
--
-- Migración ADITIVA e IDEMPOTENTE: agrega la columna y su índice único, sin
-- tocar ni borrar nada existente, y sobrevive dos corridas
-- (`scripts/migrate-deploy.mjs` puede re-correr una migración marcada como
-- rolled-back). En las bases donde la columna ya se creó a mano, no hace nada.
--
-- RLS: `empresa_connections` ya tiene su política en `prisma/rls.sql`. Agregar
-- una columna no la altera.

-- AlterTable
ALTER TABLE "empresa_connections"
    ADD COLUMN IF NOT EXISTS "whatsappPhoneNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "empresa_connections_whatsappPhoneNumber_key"
    ON "empresa_connections"("whatsappPhoneNumber");
