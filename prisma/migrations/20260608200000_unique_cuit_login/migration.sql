-- Deduplicar filas con mismo CUIT antes de crear el índice único.
-- Conserva la fila con el id más bajo (primera creada); elimina las demás.
-- Si cuit es NULL en todas las filas duplicadas esto no aplica (NULLs no
-- violan unicidad en PostgreSQL).
DELETE FROM "users"
WHERE id NOT IN (
  SELECT MIN(id)
  FROM "users"
  WHERE cuit IS NOT NULL
  GROUP BY cuit
)
AND cuit IS NOT NULL;

-- Crear índice único. IF NOT EXISTS lo hace idempotente ante re-ejecuciones.
CREATE UNIQUE INDEX IF NOT EXISTS "users_cuit_key" ON "users"("cuit");
