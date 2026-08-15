-- ═══════════════════════════════════════════════════════════════════════════
-- CL-01 · BANDERA DE IMPORTE PRE-FIX IVA — marcar, no reescribir
-- ═══════════════════════════════════════════════════════════════════════════
--
-- QUÉ PASÓ
-- --------
-- Antes de la corrección CL-01, `buildLedgerDraft` prefería el TOTAL del
-- comprobante (con IVA) sobre el NETO. Para un Responsable Inscripto el IVA es
-- crédito fiscal y NO forma parte del costo de adquisición (cátedra, Clase 4),
-- así que cada línea así construida quedó inflada entre un 10,5 % y un 21 %
-- según la alícuota. Las líneas nuevas ya salen bien; las viejas no.
--
-- QUÉ HACE ESTA MIGRACIÓN
-- -----------------------
-- MARCA. No toca un solo importe: el recálculo quedó explícitamente diferido.
-- Agrega dos columnas y estampa las filas que ya existen:
--
--   "criterioImporteIva"   con qué criterio se resolvió el importe de la línea
--   "ivaIncluidoEstimado"  cuánto IVA quedó adentro del importe, si quedó
--
-- CÓMO SE IDENTIFICA UNA LÍNEA PRE-FIX  (el criterio, y por qué este)
-- -------------------------------------------------------------------
-- NO por fecha. Un corte por `createdAt` sería a la vez falso-positivo y
-- falso-negativo: la corrección se mergeó antes que esta migración, así que hay
-- filas recientes ya correctas que un corte temporal marcaría igual; y muchas
-- filas viejas NUNCA estuvieron infladas, porque su comprobante traía el neto
-- discriminado y el código viejo también terminaba tomando el neto, o porque la
-- empresa es monotributista y para ella el total SÍ es el costo.
--
-- Se usa la EVIDENCIA, que está guardada y es verificable fila por fila: cada
-- línea con `dataEntryId` apunta a su documento de origen, cuyo `reviewNote`
-- conserva el JSON del análisis (netAmount / taxAmount / totalAmount). Con eso
-- se compara el importe guardado contra lo que el documento dice:
--
--   CARGA_MANUAL             la línea no vino de un documento: la tipeó el
--                            costista. No hay nada que auditar.
--   TOTAL_CON_IVA            el total ES el costo correcto: o la empresa no es
--                            Responsable Inscripto (el IVA no se recupera), o el
--                            comprobante no discrimina nada (Factura C, ticket).
--   NETO_SIN_IVA             el importe coincide con el neto del comprobante.
--                            La línea está bien, sea de cuando sea.
--   ANTERIOR_A_LA_CORRECCION el importe coincide con el TOTAL habiendo un neto
--                            menor disponible en el mismo documento. Esa es la
--                            firma exacta del bug: está sobrevaluada, y por
--                            cuánto se guarda en "ivaIncluidoEstimado".
--   SIN_EVIDENCIA            no se puede afirmar nada: el documento de origen no
--                            está, su análisis no es legible, o el importe no
--                            coincide con ninguna de las dos lecturas (lo editó
--                            el costista a mano). Se informa como no verificable
--                            en vez de inventar un veredicto.
--
-- De acá en adelante el criterio lo escribe la aplicación al crear la línea, con
-- la misma nomenclatura (ver `ledger-builder.ts`).

ALTER TABLE "cost_ledger_entries"
  ADD COLUMN "criterioImporteIva"  TEXT,
  ADD COLUMN "ivaIncluidoEstimado" DECIMAL(18,4);

-- Clasificador de una línea contra su documento de origen. Función auxiliar y
-- efímera: se crea, se usa y se borra dentro de esta misma migración.
CREATE FUNCTION costear_criterio_importe_iva_backfill(
  review_note text,
  importe     numeric,
  condicion   text
) RETURNS jsonb AS $$
DECLARE
  ed            jsonb;
  neto          numeric;
  iva           numeric;
  total         numeric;
  neto_efectivo numeric;
BEGIN
  -- Monotributo / Exento: el IVA no se recupera, ES costo. El total es correcto
  -- y siempre lo fue; el bug de CL-01 no los afectaba.
  IF condicion IS DISTINCT FROM 'RESPONSABLE_INSCRIPTO' THEN
    RETURN jsonb_build_object('criterio', 'TOTAL_CON_IVA');
  END IF;

  BEGIN
    ed := (review_note::jsonb) -> 'extractedData';
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('criterio', 'SIN_EVIDENCIA');
  END;
  IF ed IS NULL OR jsonb_typeof(ed) <> 'object' THEN
    RETURN jsonb_build_object('criterio', 'SIN_EVIDENCIA');
  END IF;

  BEGIN
    neto  := NULLIF(ed ->> 'netAmount', '')::numeric;
    iva   := NULLIF(ed ->> 'taxAmount', '')::numeric;
    total := NULLIF(ed ->> 'totalAmount', '')::numeric;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('criterio', 'SIN_EVIDENCIA');
  END;

  -- El neto según la precedencia de CL-01: netAmount, y si no vino, total − IVA.
  neto_efectivo := neto;
  IF neto_efectivo IS NULL
     AND total IS NOT NULL AND iva IS NOT NULL AND iva > 0 AND iva < total THEN
    neto_efectivo := round(total - iva, 4);
  END IF;

  -- Sin neto y sin IVA discriminado, el total es lo único que hay y ES el costo.
  IF neto_efectivo IS NULL THEN
    IF total IS NOT NULL AND abs(importe - total) < 0.005 THEN
      RETURN jsonb_build_object('criterio', 'TOTAL_CON_IVA');
    END IF;
    RETURN jsonb_build_object('criterio', 'SIN_EVIDENCIA');
  END IF;

  -- El importe es el neto: la línea está bien.
  IF abs(importe - neto_efectivo) < 0.005 THEN
    RETURN jsonb_build_object('criterio', 'NETO_SIN_IVA');
  END IF;

  -- El importe es el total teniendo un neto MENOR disponible: firma del bug.
  IF total IS NOT NULL AND abs(importe - total) < 0.005 AND total > neto_efectivo THEN
    RETURN jsonb_build_object(
      'criterio', 'ANTERIOR_A_LA_CORRECCION',
      'iva',      round(total - neto_efectivo, 4)
    );
  END IF;

  -- No coincide con ninguna lectura del documento (importe editado a mano).
  RETURN jsonb_build_object('criterio', 'SIN_EVIDENCIA');
END;
$$ LANGUAGE plpgsql;

-- 1) Cargas manuales: sin documento de origen no hay nada que auditar.
UPDATE "cost_ledger_entries"
   SET "criterioImporteIva" = 'CARGA_MANUAL'
 WHERE "dataEntryId" IS NULL;

-- 2) Líneas nacidas de un documento: se clasifican contra su propia evidencia.
UPDATE "cost_ledger_entries" e
   SET "criterioImporteIva"  = clasificado.criterio,
       "ivaIncluidoEstimado" = clasificado.iva
  FROM (
    SELECT le.id,
           f.veredicto ->> 'criterio'       AS criterio,
           (f.veredicto ->> 'iva')::numeric AS iva
      FROM "cost_ledger_entries" le
      JOIN "data_entries" de ON de.id = le."dataEntryId"
      LEFT JOIN "companies" co ON co.id = le."companyId"
      CROSS JOIN LATERAL costear_criterio_importe_iva_backfill(
                   de."reviewNote",
                   le.amount,
                   co."condicionIva"::text
                 ) AS f(veredicto)
     WHERE le."dataEntryId" IS NOT NULL
  ) AS clasificado
 WHERE e.id = clasificado.id;

-- 3) Cualquier resto (documento borrado, join sin match): no verificable.
UPDATE "cost_ledger_entries"
   SET "criterioImporteIva" = 'SIN_EVIDENCIA'
 WHERE "criterioImporteIva" IS NULL;

DROP FUNCTION costear_criterio_importe_iva_backfill(text, numeric, text);

-- Las líneas marcadas son las que el costista tiene que poder filtrar rápido.
CREATE INDEX "cost_ledger_entries_criterioImporteIva_idx"
  ON "cost_ledger_entries" ("companyId", "criterioImporteIva");
