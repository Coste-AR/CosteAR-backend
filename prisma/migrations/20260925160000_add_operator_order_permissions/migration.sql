ALTER TABLE "operator_memberships"
  ADD COLUMN IF NOT EXISTS "permisos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "operator_ordenes_trabajo" (
  "membershipId" UUID NOT NULL,
  "ordenId" UUID NOT NULL,
  "grantedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operator_ordenes_trabajo_pkey" PRIMARY KEY ("membershipId", "ordenId"),
  CONSTRAINT "operator_ordenes_trabajo_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "operator_memberships"("id") ON DELETE CASCADE,
  CONSTRAINT "operator_ordenes_trabajo_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_trabajo"("id") ON DELETE CASCADE
);
CREATE INDEX "operator_ordenes_trabajo_ordenId_idx" ON "operator_ordenes_trabajo"("ordenId");
