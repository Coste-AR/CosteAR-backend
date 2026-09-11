import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '@/infrastructure/database/prisma.js';
import {
  PrismaVaultChunkRepository,
  deriveSourceType,
  type UpsertChunkInput,
} from '@/application/vault-indexer/vault-chunk-repository.js';

const repo = new PrismaVaultChunkRepository();
const EMBEDDING = Array.from({ length: 1024 }, () => 0);

function baseInput(sourceFile: string): UpsertChunkInput {
  return {
    sourceFile,
    sourceTitle: 'Nota de prueba',
    headingPath: 'Sección',
    content: 'Contenido de prueba.',
    contentHash: randomUUID(),
    chunkIndex: 0,
    vaultCommit: 'abc123',
    embedding: EMBEDDING,
  };
}

const created: string[] = [];
afterEach(async () => {
  if (created.length) {
    await prisma.vaultChunk.deleteMany({ where: { sourceFile: { in: created } } });
    created.length = 0;
  }
});

describe('deriveSourceType', () => {
  it('deriva el namespace del primer segmento de la ruta', () => {
    expect(deriveSourceType('conocimiento/catedra/clase-1.md')).toBe('CATEDRA');
    expect(deriveSourceType('conocimiento/procesos/P1.md')).toBe('PROCESOS');
    expect(deriveSourceType('conocimiento/aprendizaje/2026-09.md')).toBe('APRENDIZAJE');
    expect(deriveSourceType('001.1 - Clases (Mirta)/7. Materias primas.md')).toBe('CATEDRA');
    expect(deriveSourceType('costeo-procesos/corpus-catedra/P2.md')).toBe('PROCESOS');
    expect(deriveSourceType('otra/carpeta/x.md')).toBeNull();
  });

  it('reconoce la estructura "001.1 - Teoría de Costos/" que reorganizó la bóveda el 09/09 (F1-02)', () => {
    expect(
      deriveSourceType('001.1 - Teoría de Costos/001.1.1 - Costos I/Clases/Mirta/7. Materias primas.md'),
    ).toBe('CATEDRA');
    expect(
      deriveSourceType('001.1 - Teoría de Costos/001.1.2 - Costos II/Material/Análisis Marginal (Yardín)/03 - El Punto de Equilibrio.md'),
    ).toBe('CATEDRA');
    expect(
      deriveSourceType('001.1 - Teoría de Costos/001.1.3 - Ruta de Aprendizaje (Costos I + II)/000 - MOC Ruta de Aprendizaje.md'),
    ).toBe('CATEDRA');
    // el separador de Windows y la forma NFD del acento (macOS) no deben cambiar el resultado
    expect(
      deriveSourceType('001.1 - Teoría de Costos\\001.1.1 - Costos I\\000 - MOC Costos I (CosteAR).md'),
    ).toBe('CATEDRA');
    expect(
      deriveSourceType('001.1 - Teoría de Costos/001.1.1 - Costos I/x.md'.normalize('NFD')),
    ).toBe('CATEDRA');
  });
});

describe('PrismaVaultChunkRepository.upsertChunk (integración, rol costear_app)', () => {
  it('persiste sourceType derivado y contextualPrefix, y el ON CONFLICT los actualiza', async () => {
    const sourceFile = `conocimiento/catedra/it-${randomUUID()}.md`;
    created.push(sourceFile);

    await repo.upsertChunk({ ...baseInput(sourceFile), contextualPrefix: 'Contexto inicial.' });

    let row = await prisma.vaultChunk.findFirst({ where: { sourceFile } });
    expect(row?.sourceType).toBe('CATEDRA'); // derivado de la carpeta
    expect(row?.contextualPrefix).toBe('Contexto inicial.');

    // Segundo upsert con el mismo (sourceFile, chunkIndex): actualiza ambos campos.
    await repo.upsertChunk({
      ...baseInput(sourceFile),
      contentHash: 'nuevo-hash',
      sourceType: 'APRENDIZAJE',
      contextualPrefix: 'Contexto reescrito.',
    });

    row = await prisma.vaultChunk.findFirst({ where: { sourceFile } });
    expect(row?.sourceType).toBe('APRENDIZAJE'); // el explícito pisa al derivado
    expect(row?.contextualPrefix).toBe('Contexto reescrito.');
    expect(row?.contentHash).toBe('nuevo-hash');
  });

  it('acepta sourceType null cuando la carpeta no matchea ninguna conocida', async () => {
    const sourceFile = `carpeta-desconocida/x-${randomUUID()}.md`;
    created.push(sourceFile);

    await repo.upsertChunk(baseInput(sourceFile));

    const row = await prisma.vaultChunk.findFirst({ where: { sourceFile } });
    expect(row?.sourceType).toBeNull();
    expect(row?.contextualPrefix).toBeNull();
  });
});
