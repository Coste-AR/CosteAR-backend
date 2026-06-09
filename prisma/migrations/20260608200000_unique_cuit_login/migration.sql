-- Deduplicar filas con mismo CUIT antes de crear el índice único.
-- Usa ROW_NUMBER() para identificar duplicados (UUID no soporta MIN()).
-- Conserva la primera fila por orden de createdAt; elimina las demás.
DELETE FROM "users"
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY cuit ORDER BY "createdAt" ASC) AS rn
    FROM "users"
    WHERE cuit IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Crear índice único. IF NOT EXISTS lo hace idempotente ante re-ejecuciones.
CREATE UNIQUE INDEX IF NOT EXISTS "users_cuit_key" ON "users"("cuit");
