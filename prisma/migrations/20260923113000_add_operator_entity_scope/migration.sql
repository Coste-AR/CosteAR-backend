-- Alcance explícito por lugar para cargadores. Las membresías nuevas nacen sin
-- filas (deny-by-default). Para no cortar el trabajo, las membresías existentes
-- reciben todas las entidades vigentes de su empresa en esta migración.
CREATE TABLE "operator_unidades_productivas" (
  "membershipId" UUID NOT NULL,
  "unidadProductivaId" UUID NOT NULL,
  "grantedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operator_unidades_productivas_pkey" PRIMARY KEY ("membershipId", "unidadProductivaId"),
  CONSTRAINT "operator_unidades_productivas_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "operator_memberships"("id") ON DELETE CASCADE,
  CONSTRAINT "operator_unidades_productivas_unidadProductivaId_fkey" FOREIGN KEY ("unidadProductivaId") REFERENCES "unidades_productivas"("id") ON DELETE CASCADE
);
CREATE INDEX "operator_unidades_productivas_unidadProductivaId_idx" ON "operator_unidades_productivas"("unidadProductivaId");

CREATE TABLE "operator_depositos" (
  "membershipId" UUID NOT NULL,
  "depositoId" UUID NOT NULL,
  "grantedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operator_depositos_pkey" PRIMARY KEY ("membershipId", "depositoId"),
  CONSTRAINT "operator_depositos_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "operator_memberships"("id") ON DELETE CASCADE,
  CONSTRAINT "operator_depositos_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "depositos"("id") ON DELETE CASCADE
);
CREATE INDEX "operator_depositos_depositoId_idx" ON "operator_depositos"("depositoId");

INSERT INTO "operator_unidades_productivas" ("membershipId", "unidadProductivaId")
SELECT om."id", up."id"
FROM "operator_memberships" om
JOIN "empresa_connections" ec ON ec."id" = om."connectionId"
JOIN "unidades_productivas" up ON up."companyId" = ec."companyId"
WHERE om."isActive" = true AND up."deletedAt" IS NULL;

INSERT INTO "operator_depositos" ("membershipId", "depositoId")
SELECT om."id", d."id"
FROM "operator_memberships" om
JOIN "empresa_connections" ec ON ec."id" = om."connectionId"
JOIN "depositos" d ON d."companyId" = ec."companyId"
WHERE om."isActive" = true AND d."deletedAt" IS NULL;
