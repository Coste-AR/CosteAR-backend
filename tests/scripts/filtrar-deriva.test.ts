import { describe, it, expect } from 'vitest';

// @ts-expect-error — script .mjs sin tipos; se prueba la lógica, no su tipado.
import { filtrarDeriva } from '../../scripts/lib/filtrar-deriva.mjs';

/**
 * La decisión de qué sentencia se filtra y cuál aborta se prueba SIN base y SIN red.
 * El error del 21-08 fue un chequeo que solo se podía probar deployando; el de la Fase 4,
 * tests unitarios que le pegaban a Postgres. Acá no pasa ninguna de las dos cosas.
 */
describe('filtrarDeriva', () => {
  it('deja pasar intacta una migración normal', () => {
    const sql = [
      '-- CreateTable',
      'CREATE TABLE "producto" (\n    "id" UUID NOT NULL\n);',
      '',
      '-- CreateIndex',
      'CREATE INDEX "producto_id_idx" ON "producto"("id");',
    ].join('\n\n');

    const { sql: out, filtradas, reabiertas } = filtrarDeriva(sql);

    expect(filtradas).toEqual([]);
    expect(reabiertas).toEqual([]);
    expect(out).toContain('CREATE TABLE "producto"');
    expect(out).toContain('CREATE INDEX "producto_id_idx"');
  });

  describe('deriva estructural (Prisma no la modela): se filtra en silencio', () => {
    it('saca el DROP del índice HNSW de embeddings y conserva el resto', () => {
      const sql = [
        'CREATE TABLE "producto" (\n    "id" UUID NOT NULL\n);',
        'DROP INDEX "vault_chunks_embedding_idx";',
      ].join('\n\n');

      const { sql: out, filtradas, reabiertas } = filtrarDeriva(sql);

      expect(reabiertas).toEqual([]);
      expect(filtradas).toHaveLength(1);
      expect(out).not.toContain('vault_chunks_embedding_idx');
      expect(out).toContain('CREATE TABLE "producto"');
    });

    it('saca el DROP del índice GIN full-text', () => {
      const { filtradas, reabiertas } = filtrarDeriva('DROP INDEX "vault_chunks_content_tsv_idx";');

      expect(reabiertas).toEqual([]);
      expect(filtradas).toHaveLength(1);
    });

    it('saca el ALTER sobre la columna generada contentTsv', () => {
      const { filtradas, reabiertas } = filtrarDeriva(
        'ALTER TABLE "vault_chunks" ALTER COLUMN "contentTsv" DROP DEFAULT;',
      );

      expect(reabiertas).toEqual([]);
      expect(filtradas).toHaveLength(1);
    });
  });

  describe('deriva cerrada en la Fase 3: NO se filtra, se reporta para abortar', () => {
    const casos: [string, string][] = [
      ['el índice de uploadedBy', 'DROP INDEX "data_entries_uploadedBy_idx";'],
      [
        'la FK de cost_config_versions',
        'ALTER TABLE "cost_config_versions" DROP CONSTRAINT "cost_config_versions_structureId_fkey";',
      ],
      [
        'el default del id de allocation_bases',
        'ALTER TABLE "allocation_bases" ALTER COLUMN "id" DROP DEFAULT;',
      ],
      [
        'el default del id de allocation_base_values',
        'ALTER TABLE "allocation_base_values" ALTER COLUMN "id" DROP DEFAULT;',
      ],
      [
        'el default del id de cost_config_versions',
        'ALTER TABLE "cost_config_versions" ALTER COLUMN "id" DROP DEFAULT;',
      ],
      ['el default del id de cost_periods', 'ALTER TABLE "cost_periods" ALTER COLUMN "id" DROP DEFAULT;'],
      [
        'el default de updatedAt de cost_periods',
        'ALTER TABLE "cost_periods" ALTER COLUMN "updatedAt" DROP DEFAULT;',
      ],
    ];

    it.each(casos)('avisa que reapareció %s', (_nombre, sentencia) => {
      const { reabiertas, filtradas } = filtrarDeriva(sentencia);

      expect(filtradas).toEqual([]);
      expect(reabiertas).toHaveLength(1);
      // El aviso tiene que decir con qué se había cerrado, no solo que falló.
      expect(reabiertas[0].cerradaCon).toBeTruthy();
    });

    it('reporta todas las que reaparezcan, no solo la primera', () => {
      const sql = [
        'DROP INDEX "data_entries_uploadedBy_idx";',
        'ALTER TABLE "cost_periods" ALTER COLUMN "id" DROP DEFAULT;',
      ].join('\n\n');

      expect(filtrarDeriva(sql).reabiertas).toHaveLength(2);
    });

    it('las reporta aunque en la misma migración haya deriva estructural', () => {
      const sql = [
        'DROP INDEX "vault_chunks_embedding_idx";',
        'DROP INDEX "data_entries_uploadedBy_idx";',
      ].join('\n\n');

      const { filtradas, reabiertas } = filtrarDeriva(sql);

      expect(filtradas).toHaveLength(1);
      expect(reabiertas).toHaveLength(1);
    });
  });
});
