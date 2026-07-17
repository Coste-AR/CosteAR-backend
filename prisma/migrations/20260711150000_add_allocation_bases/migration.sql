-- Bases de asignación (Parte 4). Migración ADITIVA (R7): solo CREATE TABLE e
-- INSERT del catálogo del sistema. No toca ni borra nada existente.

-- CreateTable
CREATE TABLE "allocation_bases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_base_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "baseId" UUID NOT NULL,
    "structureId" UUID NOT NULL,
    "centerId" TEXT NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "note" TEXT,
    "dataPointId" UUID,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ,

    CONSTRAINT "allocation_base_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allocation_bases_companyId_code_key" ON "allocation_bases"("companyId", "code");
CREATE INDEX "allocation_bases_companyId_idx" ON "allocation_bases"("companyId");
CREATE UNIQUE INDEX "allocation_base_values_baseId_structureId_centerId_key" ON "allocation_base_values"("baseId", "structureId", "centerId");
CREATE INDEX "allocation_base_values_structureId_idx" ON "allocation_base_values"("structureId");

-- AddForeignKey
ALTER TABLE "allocation_base_values" ADD CONSTRAINT "allocation_base_values_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "allocation_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Catálogo del sistema (criterio B — clase 12 de Mirta). Idempotente: solo
-- inserta las que aún no existen (por code, entre las del sistema).
INSERT INTO "allocation_bases" ("id", "companyId", "code", "name", "unit", "description", "isSystem")
SELECT gen_random_uuid(), NULL, v.code, v.name, v.unit, v.description, true
FROM (VALUES
  ('superficie_m2',        'Superficie en m²',              'm²',            'Alquiler de fábrica, calefacción, limpieza edilicia'),
  ('inversion_maquinaria', 'Inversión en maquinaria $',     '$',             'Amortización y seguro de la maquinaria'),
  ('inversion_muebles',    'Inversión en muebles y útiles $','$',            'Amortización de muebles y útiles'),
  ('hs_maquina',           'Horas máquina',                 'hs máquina',    'Aceite/lubricante, fuerza motriz, mantenimiento (si no hay depto.)'),
  ('hp_instalado',         'HP instalado',                  'HP',            'Fuerza motriz'),
  ('cantidad_focos',       'Cantidad de focos',             'focos',         'Iluminación'),
  ('nro_requisiciones',    'Número de requisiciones',       'requisiciones', 'Almacén de materiales'),
  ('hs_diseno',            'Horas de diseño/tecnología',    'hs',            'Honorarios de ingeniería'),
  ('pct_dedicacion',       '% de dedicación',               '%',             'Oficina técnica'),
  ('hs_hombre',            'Horas hombre',                  'hs hombre',     'Bases de mano de obra indirecta'),
  ('dotacion_personal',    'Dotación de personal',          'personas',      'Servicios sociales, comedor, vigilancia')
) AS v(code, name, unit, description)
WHERE NOT EXISTS (
  SELECT 1 FROM "allocation_bases" b WHERE b."companyId" IS NULL AND b."code" = v.code
);
