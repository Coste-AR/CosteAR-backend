-- Permiso para informar el grado de avance de la producción en proceso.
--
-- La oficina técnica NO es un rol nuevo. `EMPRESA_OPERATOR` ya es "personal de
-- la empresa cliente", que es exactamente lo que es la oficina técnica. Un
-- UserRole aparte obligaría a tocar auth, RLS, guards, invitaciones y el panel
-- admin para terminar con dos roles que en el 95% de las pantallas hacen lo
-- mismo.
--
-- Lo que hay que distinguir no es quién se loguea: es de dónde salió el dato.
-- Eso vive en `unit_movement_schedules.countSource`. Esta columna es solo la
-- otra mitad: a quién le habilitó el costista informarlo.
--
-- Default false: nadie lo tiene hasta que el costista lo otorgue explícitamente.
--
-- Migración ADITIVA e IDEMPOTENTE.

-- AlterTable
ALTER TABLE "operator_memberships"
    ADD COLUMN IF NOT EXISTS "canReportWipCount" BOOLEAN NOT NULL DEFAULT false;
