-- La bandeja conserva el contexto visible de la regla aun si su configuración cambia.
ALTER TABLE "alerts"
  ADD COLUMN "severidad" "SeveridadAlerta",
  ADD COLUMN "indicador" TEXT,
  ADD COLUMN "indicadorEtiqueta" TEXT,
  ADD COLUMN "unidadValor" TEXT,
  ADD COLUMN "unidadUmbral" TEXT,
  ADD COLUMN "motivoNoEvaluada" TEXT;
