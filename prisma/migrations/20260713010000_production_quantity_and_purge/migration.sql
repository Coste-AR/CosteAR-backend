-- Dos cosas que salieron de la Fase 4 (las dos ADITIVAS, regla R7).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. UNIDADES PRODUCIDAS ≠ UNIDADES VENDIDAS
--
-- El motor solo tenía `salesQuantity`, y la usa para facturar (precio × cantidad):
-- conceptualmente son unidades VENDIDAS. Pero el formulario la rotulaba "cantidad
-- producida" y el costo unitario dividía por ahí. Si se producen 1.000 y se venden
-- 800, el costo por unidad sale dividido por 800: inflado.
--
-- Columna nueva y OPCIONAL: si no está cargada, el sistema se cae a las vendidas
-- (exactamente lo que hacía antes). Cero regresión para lo ya cargado.
ALTER TABLE "cost_structures" ADD COLUMN "productionQuantity" DECIMAL(18,4);
ALTER TABLE "cost_periods"    ADD COLUMN "productionQuantity" DECIMAL(18,4);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BORRADO ADMINISTRATIVO (purga)
--
-- El trigger append-only (R1) bloquea UPDATE y DELETE sobre las tablas de
-- histórico. Eso está bien: un registro contable no se reescribe. Pero bloqueaba
-- TAMBIÉN el DELETE en cascada, así que una estructura (o una empresa) no se podía
-- borrar NUNCA: reventaba con P0001. La app lo esquivaba con borrado lógico, así
-- que la bomba estaba armada pero no detonada.
--
-- Solución: el UPDATE queda prohibido SIEMPRE (esa es la garantía de fondo: una
-- versión histórica jamás se puede reescribir). El DELETE se permite solo dentro de
-- una transacción de PURGA explícita, que la aplicación marca con:
--
--     SET LOCAL app.purge_mode = 'on';
--
-- `SET LOCAL` muere con la transacción, así que el permiso no se filtra a ninguna
-- otra consulta. Un DELETE suelto, o uno en cascada sin querer, sigue reventando.
CREATE OR REPLACE FUNCTION trg_append_only() RETURNS TRIGGER AS $$
BEGIN
  -- Reescribir una versión histórica NUNCA se permite, pase lo que pase.
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'append-only: UPDATE no se permite nunca (tabla %). Un registro histórico no se reescribe: se agrega uno nuevo.', TG_TABLE_NAME;
  END IF;

  -- El DELETE solo dentro de una purga administrativa explícita y auditada.
  IF current_setting('app.purge_mode', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'append-only: DELETE no se permite (tabla %). Para borrar de verdad hay que usar la purga administrativa, que deja rastro.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
