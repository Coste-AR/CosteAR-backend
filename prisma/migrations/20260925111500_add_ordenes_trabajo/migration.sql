CREATE TYPE "EstadoOrdenTrabajo" AS ENUM (
  'BORRADOR', 'COTIZADA', 'APROBADA', 'EN_PRODUCCION',
  'TERMINADA_TECNICA', 'PENDIENTE_CIERRE', 'CERRADA', 'CANCELADA'
);

CREATE TABLE "ordenes_trabajo" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "codigo" VARCHAR(80) NOT NULL,
  "descripcion" VARCHAR(500) NOT NULL,
  "cliente" VARCHAR(200) NOT NULL,
  "plantillaId" UUID,
  "estado" "EstadoOrdenTrabajo" NOT NULL DEFAULT 'BORRADOR',
  "fechaInicio" DATE,
  "fechaFinTecnica" TIMESTAMPTZ,
  "fechaCierre" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ordenes_trabajo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ordenes_trabajo_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "ordenes_trabajo_companyId_codigo_key" ON "ordenes_trabajo"("companyId", "codigo");
CREATE INDEX "ordenes_trabajo_userId_idx" ON "ordenes_trabajo"("userId");
CREATE INDEX "ordenes_trabajo_companyId_estado_idx" ON "ordenes_trabajo"("companyId", "estado");

ALTER TABLE "ordenes_trabajo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordenes_trabajo" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ordenes_trabajo"
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());
