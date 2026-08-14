-- Condición de la empresa frente al IVA (CL-09).
--
-- QUÉ RESUELVE
-- El sistema no tenía ninguna noción estructurada de la condición fiscal de la
-- empresa. El único rastro del concepto era una línea del prompt de Groq
-- ("Asumí Responsable Inscripto por defecto") y un pedido de que la IA marcara
-- en `qualityNote` los indicios de lo contrario — texto libre que nadie leía y
-- que no cambiaba ninguna decisión de costeo.
--
-- La regla contable (cátedra, Clase 4 "Materia prima — costo de adquisición,
-- desperdicio y lote económico", línea 27): "IVA: solo aplica si la empresa es
-- responsable no inscripta o monotributista; si es responsable inscripta, el
-- IVA no forma parte del costo de adquisición". Es decir: para un Responsable
-- Inscripto el IVA es crédito fiscal y el costo es el NETO; para un
-- monotributista o un exento el IVA no se recupera y por lo tanto ES costo.
--
-- POR QUÉ EL DEFAULT ES 'RESPONSABLE_INSCRIPTO'
-- Porque es el supuesto exacto bajo el cual se calculó todo lo que ya está en
-- la base. El prompt asumía RI y `ledger-builder` costeaba sobre el neto sin
-- preguntarle a nadie. Backfillear cualquier otra condición sobre las empresas
-- existentes sería una REVALUACIÓN SILENCIOSA de datos vivos: los costos ya
-- calculados pasarían a estar computados con una regla distinta de la que los
-- produjo. Con este default, la rama que corre para toda fila preexistente es
-- byte por byte la misma que corría antes (ver DECISIONES.md, sección CL-09, y
-- tests/validaciones/ledger-condicion-iva.test.ts, que lo prueba contra un
-- oráculo con la implementación anterior).
--
-- La condición real de las empresas que NO son RI se detecta y se señaliza:
-- `condicionIvaRevisar` levanta una bandera accionable en la empresa cuando la
-- IA ve "Factura C", "Consumidor Final", "Monotributista" o "Responsable No
-- Inscripto" en un comprobante. Nadie queda mal costeado en silencio; queda
-- mal costeado con un cartel encima hasta que un humano confirme.
--
-- Migración ADITIVA e IDEMPOTENTE:
--   * el tipo se crea dentro de un bloque que traga `duplicate_object`;
--   * las columnas usan `ADD COLUMN IF NOT EXISTS`;
--   * no hay UPDATE de ninguna fila: el DEFAULT de Postgres completa las
--     existentes sin reescribir ninguna otra columna;
--   * no toca ninguna otra tabla.
-- Sobrevive dos corridas seguidas (`scripts/migrate-deploy.mjs` puede
-- re-aplicar una migración marcada como rolled-back).
--
-- RLS: no se agrega ninguna tabla, solo columnas a `companies` — que ya tiene
-- su política de tenant en `prisma/rls.sql`. Nada que hacer en `db:rls`.

-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "CondicionIva" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

-- AlterTable
ALTER TABLE "companies"
    ADD COLUMN IF NOT EXISTS "condicionIva"            "CondicionIva" NOT NULL DEFAULT 'RESPONSABLE_INSCRIPTO',
    ADD COLUMN IF NOT EXISTS "condicionIvaRevisar"     BOOLEAN        NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "condicionIvaRevisarNota" TEXT,
    ADD COLUMN IF NOT EXISTS "condicionIvaRevisarAt"   TIMESTAMP(3);
