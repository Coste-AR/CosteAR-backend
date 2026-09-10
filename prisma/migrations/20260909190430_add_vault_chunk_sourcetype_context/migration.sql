-- Migración ADITIVA (DOM-06): solo CREATE TYPE + ALTER ADD COLUMN + backfill.
--
-- Escrita a mano a propósito. `scripts/migrate-dev.mjs` no la pudo generar
-- limpia: Prisma fusiona en un solo bloque `ALTER TABLE "vault_chunks"` los
-- `ADD COLUMN` nuevos y la deriva estructural que ya conocemos
-- (`ALTER COLUMN "contentTsv" DROP DEFAULT`, más los `DROP INDEX` de los
-- índices sobre columnas Unsupported). `filtrar-deriva.mjs` filtra por BLOQUE,
-- así que al sacar la deriva se llevaba también los `ADD COLUMN`. Acá quedan
-- solo las sentencias aditivas; la deriva de `contentTsv` y los índices HNSW/GIN
-- siguen viviendo únicamente en el SQL de sus migraciones originales, como antes.
-- (Seguimiento: issue para que `filtrar-deriva.mjs` filtre a nivel de sentencia.)

-- CreateEnum
CREATE TYPE "VaultSourceType" AS ENUM ('CATEDRA', 'PROCESOS', 'APRENDIZAJE');

-- AlterTable
ALTER TABLE "vault_chunks"
  ADD COLUMN "sourceType" "VaultSourceType",
  ADD COLUMN "contextualPrefix" TEXT;

-- Backfill del namespace por carpeta. Cubre tanto la estructura nueva
-- (conocimiento/<ns>/...) como la actual previa a F1-02.
UPDATE "vault_chunks" SET "sourceType" =
  CASE
    WHEN "sourceFile" LIKE 'conocimiento/catedra/%'    THEN 'CATEDRA'::"VaultSourceType"
    WHEN "sourceFile" LIKE 'conocimiento/procesos/%'   THEN 'PROCESOS'::"VaultSourceType"
    WHEN "sourceFile" LIKE 'conocimiento/aprendizaje/%' THEN 'APRENDIZAJE'::"VaultSourceType"
    WHEN "sourceFile" LIKE '001.1 - Clases%'           THEN 'CATEDRA'::"VaultSourceType"
    WHEN "sourceFile" LIKE 'costeo-procesos/%'         THEN 'PROCESOS'::"VaultSourceType"
    ELSE NULL
  END
WHERE "sourceType" IS NULL;
