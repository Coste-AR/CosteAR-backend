-- Una propuesta de semilla no es una decisión humana. Puede tener comportamiento
-- sin autor ni fecha mientras siga sin confirmar; al confirmarse, ambos pasan a
-- ser obligatorios. Así no se atribuye falsamente una propuesta al dueño.
ALTER TABLE "parametros_costeo"
  DROP CONSTRAINT "parametros_costeo_comportamiento_trazable_check";

ALTER TABLE "parametros_costeo"
  ADD CONSTRAINT "parametros_costeo_comportamiento_trazable_check"
  CHECK (
    ("comportamientoVolumen" IS NULL
      AND "clasificadoPorUserId" IS NULL
      AND "clasificadoEn" IS NULL)
    OR
    ("comportamientoVolumen" IS NOT NULL
      AND (
        ("confirmado" = false
          AND "clasificadoPorUserId" IS NULL
          AND "clasificadoEn" IS NULL)
        OR
        ("clasificadoPorUserId" IS NOT NULL
          AND "clasificadoEn" IS NOT NULL)
      ))
  );
