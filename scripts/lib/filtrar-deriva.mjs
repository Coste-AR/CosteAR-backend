/**
 * filtrar-deriva.mjs — la decisión, sin red y sin base.
 *
 * Separada de `migrate-dev.mjs` a propósito: la lógica que decide qué se filtra y qué
 * aborta se puede probar sin generar una migración ni levantar Postgres. Un chequeo que
 * solo se puede probar corriendo una migración real no protege nada.
 *
 * Hay DOS clases de deriva, y se tratan distinto:
 *
 *  1. ESTRUCTURAL (`DERIVA_ESTRUCTURAL`) — Prisma no puede modelar el objeto, y no va a
 *     poder. Son la columna generada `vault_chunks.contentTsv` y los dos índices sobre
 *     columnas `Unsupported`. Se filtran en silencio: es el precio permanente de usar
 *     pgvector y full-text desde Prisma.
 *
 *  2. CERRADA (`DERIVA_CERRADA`) — deriva que existía porque el schema no declaraba lo
 *     que la base ya tenía. Se cerró declarándolo (issue #72, Fase 3). Estos patrones
 *     NO se filtran: si alguno vuelve a aparecer, el script ABORTA.
 *
 *     Por qué abortar y no filtrar: filtrar en silencio es lo que dejó esta deriva viva
 *     durante meses. Si una de estas sentencias reaparece, significa que alguien volvió
 *     a separar el schema de la base — y eso hay que verlo, no taparlo.
 */

/** Deriva que Prisma nunca va a poder modelar. Se filtra. */
export const DERIVA_ESTRUCTURAL = [
  {
    pattern: /DROP INDEX "vault_chunks_embedding_idx"/s,
    reason: 'índice HNSW de embedding semántico (vault_chunks_embedding_idx)',
  },
  {
    pattern: /DROP INDEX "vault_chunks_content_tsv_idx"/s,
    reason: 'índice GIN full-text de la bóveda (vault_chunks_content_tsv_idx)',
  },
  {
    pattern: /ALTER TABLE "vault_chunks"[\s\S]*?"contentTsv"/s,
    reason: 'ALTER sobre la columna generada vault_chunks.contentTsv',
  },
];

/** Deriva cerrada en la Fase 3. Si reaparece, se aborta. */
export const DERIVA_CERRADA = [
  {
    pattern: /DROP INDEX "data_entries_uploadedBy_idx"/s,
    reason: 'DROP INDEX data_entries_uploadedBy_idx',
    cerradaCon: 'DataEntry.@@index([uploadedBy])',
  },
  {
    pattern:
      /ALTER TABLE "cost_config_versions" DROP CONSTRAINT "cost_config_versions_structureId_fkey"/s,
    reason: 'DROP CONSTRAINT cost_config_versions_structureId_fkey',
    cerradaCon: 'CostConfigVersion.structure @relation(...)',
  },
  {
    pattern: /ALTER TABLE "allocation_base_values"[\s\S]*?"id" DROP DEFAULT/s,
    reason: 'DROP DEFAULT en allocation_base_values.id',
    cerradaCon: 'AllocationBaseValue.id @default(dbgenerated("gen_random_uuid()"))',
  },
  {
    pattern: /ALTER TABLE "allocation_bases"[\s\S]*?"id" DROP DEFAULT/s,
    reason: 'DROP DEFAULT en allocation_bases.id',
    cerradaCon: 'AllocationBase.id @default(dbgenerated("gen_random_uuid()"))',
  },
  {
    pattern: /ALTER TABLE "cost_config_versions"[\s\S]*?"id" DROP DEFAULT/s,
    reason: 'DROP DEFAULT en cost_config_versions.id',
    cerradaCon: 'CostConfigVersion.id @default(dbgenerated("gen_random_uuid()"))',
  },
  {
    pattern: /ALTER TABLE "cost_periods"[\s\S]*?"id" DROP DEFAULT/s,
    reason: 'DROP DEFAULT en cost_periods.id',
    cerradaCon: 'CostPeriod.id @default(dbgenerated("gen_random_uuid()"))',
  },
  {
    pattern: /ALTER TABLE "cost_periods"[\s\S]*?"updatedAt" DROP DEFAULT/s,
    reason: 'DROP DEFAULT en cost_periods.updatedAt',
    cerradaCon: 'CostPeriod.updatedAt @default(now())',
  },
];

/**
 * Decide qué hacer con el SQL de una migración recién generada.
 *
 * @param {string} sql El contenido de migration.sql
 * @returns {{ sql: string, filtradas: string[], reabiertas: {reason: string, cerradaCon: string}[] }}
 *   `sql` es el SQL sin la deriva estructural. `filtradas` dice qué se sacó.
 *   `reabiertas` no vacío significa que hay que ABORTAR: deriva que debía estar cerrada.
 */
export function filtrarDeriva(sql) {
  const bloques = sql.split(/\n\n+/);
  const limpios = [];
  const filtradas = [];
  const reabiertas = [];

  for (const bloque of bloques) {
    const trimmed = bloque.trim();
    if (!trimmed) continue;

    const reabierta = DERIVA_CERRADA.find(({ pattern }) => pattern.test(trimmed));
    if (reabierta) {
      reabiertas.push({ reason: reabierta.reason, cerradaCon: reabierta.cerradaCon });
      continue;
    }

    const estructural = DERIVA_ESTRUCTURAL.find(({ pattern }) => pattern.test(trimmed));
    if (estructural) {
      filtradas.push(estructural.reason);
    } else {
      limpios.push(bloque);
    }
  }

  return { sql: limpios.join('\n\n'), filtradas, reabiertas };
}
