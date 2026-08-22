-- Procedencia del grado de avance: de dónde salió el dato.
--
-- La cátedra lo dice tres veces (clases 34, 36 y 40): "el grado de avance lo
-- determina la oficina técnica al cierre de cada período, por departamento y por
-- elemento — el área de costos lo recibe y aplica, NO LO ESTIMA".
--
-- El sistema no puede prohibirle al costista que lo cargue si la planta no
-- responde (sería inusable), pero sí puede dejar constancia de quién lo informó.
-- Un informe apoyado en un recuento de planta y otro apoyado en una estimación
-- de costos no valen lo mismo.
--
-- Va SOLO el tipo en esta migración: las columnas que lo usan llegan en la
-- siguiente. Separado a propósito — es el mismo criterio que se usó con
-- CUSTOM_DAYS, y deja cada archivo con una sola cosa adentro.

-- CreateEnum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CountSource') THEN
        CREATE TYPE "CountSource" AS ENUM (
            'TECHNICAL_OFFICE',
            'COSTIST_ESTIMATE',
            'CARRIED_OVER',
            'NOT_COUNTED'
        );
    END IF;
END $$;
