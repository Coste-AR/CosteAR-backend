ALTER TABLE "ordenes_trabajo"
  ADD COLUMN "renglonesBase" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "plantillas_orden" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID,
  "userId" UUID,
  "nombre" VARCHAR(160) NOT NULL,
  "renglonesBase" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plantillas_orden_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plantillas_orden_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "etapas_plantilla_orden" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plantillaId" UUID NOT NULL,
  "userId" UUID,
  "clave" VARCHAR(80) NOT NULL,
  "nombre" VARCHAR(160) NOT NULL,
  "orden" INTEGER NOT NULL,
  "esEntrega" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "etapas_plantilla_orden_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "etapas_plantilla_orden_plantillaId_fkey" FOREIGN KEY ("plantillaId")
    REFERENCES "plantillas_orden"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "etapas_orden" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ordenId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "clave" VARCHAR(80) NOT NULL,
  "nombre" VARCHAR(160) NOT NULL,
  "orden" INTEGER NOT NULL,
  "esEntrega" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "etapas_orden_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "etapas_orden_ordenId_fkey" FOREIGN KEY ("ordenId")
    REFERENCES "ordenes_trabajo"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_plantillaId_fkey"
  FOREIGN KEY ("plantillaId") REFERENCES "plantillas_orden"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX "plantillas_orden_userId_idx" ON "plantillas_orden"("userId");
CREATE INDEX "plantillas_orden_companyId_idx" ON "plantillas_orden"("companyId");
CREATE UNIQUE INDEX "etapas_plantilla_orden_plantillaId_clave_key" ON "etapas_plantilla_orden"("plantillaId", "clave");
CREATE UNIQUE INDEX "etapas_plantilla_orden_plantillaId_orden_key" ON "etapas_plantilla_orden"("plantillaId", "orden");
CREATE INDEX "etapas_plantilla_orden_userId_idx" ON "etapas_plantilla_orden"("userId");
CREATE UNIQUE INDEX "etapas_orden_ordenId_clave_key" ON "etapas_orden"("ordenId", "clave");
CREATE UNIQUE INDEX "etapas_orden_ordenId_orden_key" ON "etapas_orden"("ordenId", "orden");
CREATE INDEX "etapas_orden_userId_idx" ON "etapas_orden"("userId");

INSERT INTO "plantillas_orden" ("id", "companyId", "userId", "nombre", "renglonesBase")
VALUES ('40000000-0000-4000-8000-000000000001', NULL, NULL, 'Módulo de 40 pies', '[]');

INSERT INTO "etapas_plantilla_orden" ("plantillaId", "userId", "clave", "nombre", "orden", "esEntrega") VALUES
  ('40000000-0000-4000-8000-000000000001', NULL, 'metalurgica', 'Metalúrgica', 1, false),
  ('40000000-0000-4000-8000-000000000001', NULL, 'aislacion_paneleria', 'Aislación y panelería', 2, false),
  ('40000000-0000-4000-8000-000000000001', NULL, 'aberturas', 'Aberturas', 3, false),
  ('40000000-0000-4000-8000-000000000001', NULL, 'instalaciones', 'Instalaciones eléctricas y sanitarias', 4, false),
  ('40000000-0000-4000-8000-000000000001', NULL, 'terminaciones', 'Terminaciones', 5, false),
  ('40000000-0000-4000-8000-000000000001', NULL, 'transporte_logistica', 'Transporte y logística', 6, true),
  ('40000000-0000-4000-8000-000000000001', NULL, 'montaje_destino', 'Montaje e instalación en destino', 7, true);
