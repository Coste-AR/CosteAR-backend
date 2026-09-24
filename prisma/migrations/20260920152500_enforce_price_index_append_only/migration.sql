-- DOM-01: las versiones y sus coeficientes no se corrigen en sitio.
-- Reutiliza la función común creada por Trazabilidad Total v1.
CREATE TRIGGER price_index_series_versions_append_only
  BEFORE UPDATE OR DELETE ON "price_index_series_versions"
  FOR EACH ROW EXECUTE FUNCTION trg_append_only();

CREATE TRIGGER price_index_values_append_only
  BEFORE UPDATE OR DELETE ON "price_index_values"
  FOR EACH ROW EXECUTE FUNCTION trg_append_only();
