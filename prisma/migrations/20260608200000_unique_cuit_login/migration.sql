-- AddUniqueConstraint: users.cuit
-- NULLs are allowed to repeat in PostgreSQL unique constraints, so existing
-- rows without a CUIT are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "users_cuit_key" ON "users"("cuit");
