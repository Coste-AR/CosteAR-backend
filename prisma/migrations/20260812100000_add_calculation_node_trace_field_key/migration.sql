-- Clave de traza en los nodos del árbol de derivación (T-11).
--
-- QUÉ RESUELVE
-- El motor ya emitía una `traceFieldKey` determinística por nodo —la misma
-- convención que usa el lado de escritura para nombrar cada dato cargado—, pero
-- se usaba y se tiraba dentro de la misma corrida: servía para enlazar la hoja
-- con su `DataPoint` y después no se persistía. Consecuencia: el árbol que sale
-- por `GET /calculation-runs/:id/tree` no tiene forma de decir QUÉ número es
-- cada nodo, y la única manera que le queda a una pantalla de encontrar el nodo
-- de un valor es comparar su etiqueta. Casar por etiqueta se rompe en silencio
-- el día que alguien renombra un título: sin error, sin test en rojo, con el
-- drill-down apagado.
--
-- Con la clave persistida, el informe de costos de producción de Procesos puede
-- pedir "el nodo del costo unitario acumulado de ESTE departamento en ESTE
-- período" y obtenerlo o no obtenerlo, pero nunca obtener el equivocado.
--
-- Migración ADITIVA e IDEMPOTENTE:
--   * una sola columna, anulable, sin default y sin backfill;
--   * las corridas viejas quedan con NULL, que es la verdad: se calcularon
--     antes de que la clave se guardara, y sus nodos siguen leyéndose igual;
--   * no toca ninguna otra tabla.
--
-- RLS: no se agrega ninguna tabla. `calculation_nodes` ya tiene su política de
-- tenant en `prisma/rls.sql`. Nada que hacer en `db:rls`.

-- AlterTable
ALTER TABLE "calculation_nodes"
    ADD COLUMN IF NOT EXISTS "traceFieldKey" TEXT;
