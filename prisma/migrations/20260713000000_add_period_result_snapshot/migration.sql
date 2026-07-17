-- Períodos, Fase 4: el período cerrado guarda su RESULTADO, no solo sus insumos.
--
-- Hasta acá, cerrar un mes solo cambiaba el estado a CLOSED y dejaba guardada la
-- configuración (materia prima, mano de obra, CIF). Los NÚMEROS no quedaban en
-- ningún lado: para ver cómo cerró junio había que volver a correr el motor sobre
-- esos insumos. Eso hace que una mejora del motor pueda cambiar, sin que nadie se
-- entere, un mes ya cerrado y firmado. Un período cerrado es un hecho contable:
-- sus números se leen, no se recalculan.
--
-- Migración ADITIVA (regla R7): agrega columnas, no borra ni renombra ninguna.
-- Los períodos ya cerrados quedan con resultSnapshot = NULL; la comparación los
-- recalcula al vuelo y los marca como "recalculado" en vez de hacerlos pasar por
-- congelados.
ALTER TABLE "cost_periods" ADD COLUMN "resultSnapshot" JSONB;
ALTER TABLE "cost_periods" ADD COLUMN "resultEngineVersion" TEXT;
ALTER TABLE "cost_periods" ADD COLUMN "resultAt" TIMESTAMPTZ;
