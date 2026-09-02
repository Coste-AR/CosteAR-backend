-- Eventos físicos por lote (A-10). La población se deriva; no hay columna
-- materializada que alguien pueda editar manualmente.

CREATE TYPE "TipoEventoLote" AS ENUM ('ALTA', 'BAJA');
CREATE TYPE "MotivoBajaLote" AS ENUM ('MORTALIDAD', 'DESCARTE', 'CANIBALISMO', 'FAENA');

ALTER TABLE "lotes_productivos"
  ADD CONSTRAINT "lotes_productivos_companyId_id_key" UNIQUE ("companyId", "id");

CREATE TABLE "eventos_lote" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "loteId" UUID NOT NULL,
    "tipo" "TipoEventoLote" NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "motivo" "MotivoBajaLote",
    "fecha" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "eventos_lote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "eventos_lote_cantidad_positiva" CHECK ("cantidad" > 0),
    -- Las altas no tienen motivo. Una baja sin motivo puede venir de una
    -- importación histórica y queda pendiente, nunca se usa para derivar saldo.
    CONSTRAINT "eventos_lote_motivo_segun_tipo"
      CHECK (("tipo" = 'ALTA' AND "motivo" IS NULL) OR "tipo" = 'BAJA')
);

CREATE INDEX "eventos_lote_companyId_loteId_fecha_idx"
  ON "eventos_lote"("companyId", "loteId", "fecha");
CREATE INDEX "eventos_lote_loteId_idx" ON "eventos_lote"("loteId");

ALTER TABLE "eventos_lote"
  ADD CONSTRAINT "eventos_lote_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "eventos_lote"
  ADD CONSTRAINT "eventos_lote_companyId_loteId_fkey"
  FOREIGN KEY ("companyId", "loteId")
  REFERENCES "lotes_productivos"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
