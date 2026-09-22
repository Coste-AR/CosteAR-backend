-- Renombrar conserva todas las filas y hace que cualquier valor fuera del enum
-- falle en PostgreSQL en vez de quedar nulo o ser omitido.
ALTER TYPE "UserRole" RENAME VALUE 'COSTISTA' TO 'EMPRESA_ADMIN';
ALTER TYPE "UserRole" RENAME VALUE 'ADMIN' TO 'SUPER_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'EMPRESARIO';
