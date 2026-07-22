import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VaultIndexerService } from '@/application/vault-indexer/vault-indexer-service.js';
import type {
  VaultChunkRepository,
  UpsertChunkInput,
  VaultChunkIdentity,
} from '@/application/vault-indexer/vault-chunk-repository.js';
import type { Embedder } from '@/infrastructure/ai/voyage-service.js';

class FakeRepository implements VaultChunkRepository {
  chunks = new Map<string, UpsertChunkInput>();

  async listBySourceFile(sourceFile: string): Promise<VaultChunkIdentity[]> {
    return [...this.chunks.values()]
      .filter((c) => c.sourceFile === sourceFile)
      .map((c) => ({ chunkIndex: c.chunkIndex, contentHash: c.contentHash }));
  }

  async upsertChunk(input: UpsertChunkInput): Promise<void> {
    this.chunks.set(`${input.sourceFile}#${input.chunkIndex}`, input);
  }

  async deleteChunksBeyondIndex(sourceFile: string, keepUpTo: number): Promise<number> {
    let count = 0;
    for (const [key, chunk] of this.chunks) {
      if (chunk.sourceFile === sourceFile && chunk.chunkIndex > keepUpTo) {
        this.chunks.delete(key);
        count++;
      }
    }
    return count;
  }

  async deleteOrphanChunks(currentSourceFiles: string[]): Promise<number> {
    let count = 0;
    for (const [key, chunk] of this.chunks) {
      if (!currentSourceFiles.includes(chunk.sourceFile)) {
        this.chunks.delete(key);
        count++;
      }
    }
    return count;
  }
}

class FakeEmbedder implements Embedder {
  isConfigured = true;
  calls: string[][] = [];

  async embed(texts: string[]): Promise<number[][] | null> {
    this.calls.push(texts);
    return texts.map((_, i) => [i, i + 1, i + 2]);
  }
}

describe('VaultIndexerService', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'vault-test-'));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it('indexa una nota nueva, generando un chunk por sección', async () => {
    await writeFile(
      join(vaultPath, 'fifo.md'),
      '# Método FIFO\n\nIntro.\n\n## Cálculo\n\nEl costo se calcula así.\n',
      'utf-8',
    );
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    const service = new VaultIndexerService(repo, embedder);

    const result = await service.indexVault(vaultPath, 'commit-1');

    expect(result.filesProcessed).toBe(1);
    expect(result.chunksUpserted).toBe(2);
    expect(result.chunksSkippedUnchanged).toBe(0);
    expect(repo.chunks.size).toBe(2);
  });

  it('omite re-embedear chunks cuyo contenido no cambió', async () => {
    await writeFile(join(vaultPath, 'nota.md'), '# Nota\n\nContenido sin cambios.\n', 'utf-8');
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    const service = new VaultIndexerService(repo, embedder);

    await service.indexVault(vaultPath, 'commit-1');
    embedder.calls = [];
    const second = await service.indexVault(vaultPath, 'commit-2');

    expect(second.chunksUpserted).toBe(0);
    expect(second.chunksSkippedUnchanged).toBe(1);
    expect(embedder.calls).toEqual([]);
  });

  it('borra los chunks huérfanos de notas eliminadas', async () => {
    // Se mantiene una segunda nota en el vault a propósito: borrar la ÚLTIMA
    // nota dejaría el vault en cero archivos .md, que es exactamente el caso
    // que bloquea la salvaguarda de "vault vacío" de arriba (indistinguible
    // de un path mal configurado). Ese escenario ya lo cubre el test
    // "lanza error si el vault no tiene notas .md" — acá probamos borrado de
    // huérfanos cuando el vault sigue teniendo contenido válido.
    await writeFile(join(vaultPath, 'permanente.md'), '# Permanente\n\nEsta nota se queda.\n', 'utf-8');
    const filePath = join(vaultPath, 'temporal.md');
    await writeFile(filePath, '# Temporal\n\nEsto se va a borrar.\n', 'utf-8');
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    const service = new VaultIndexerService(repo, embedder);

    await service.indexVault(vaultPath, 'commit-1');
    expect(repo.chunks.size).toBe(2); // 1 chunk de permanente.md + 1 de temporal.md

    await rm(filePath);
    const result = await service.indexVault(vaultPath, 'commit-2');

    expect(result.chunksDeleted).toBe(1);
    expect(repo.chunks.size).toBe(1); // solo queda el chunk de permanente.md
  });

  it('cuenta los chunks borrados cuando una nota se achica', async () => {
    const filePath = join(vaultPath, 'nota.md');
    await writeFile(
      filePath,
      '# Nota\n\nIntro.\n\n## Sección A\n\nContenido A.\n\n## Sección B\n\nContenido B.\n',
      'utf-8',
    );
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    const service = new VaultIndexerService(repo, embedder);

    await service.indexVault(vaultPath, 'commit-1');
    expect(repo.chunks.size).toBe(3);

    await writeFile(filePath, '# Nota\n\nIntro.\n', 'utf-8');
    const result = await service.indexVault(vaultPath, 'commit-2');

    expect(repo.chunks.size).toBe(1);
    expect(result.chunksDeleted).toBe(2);
  });

  it('lanza error si Voyage no está configurado', async () => {
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    embedder.isConfigured = false;
    const service = new VaultIndexerService(repo, embedder);

    await expect(service.indexVault(vaultPath, 'commit-1')).rejects.toThrow('VOYAGE_API_KEY');
  });

  it('lanza error si el vault no tiene notas .md, sin borrar nada existente', async () => {
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    const service = new VaultIndexerService(repo, embedder);

    // vaultPath está vacío (mkdtemp recién creado, sin escribir ningún .md)
    await expect(service.indexVault(vaultPath, 'commit-1')).rejects.toThrow('No se encontraron notas');
    expect(repo.chunks.size).toBe(0); // no llamó a deleteOrphanChunks([]) de forma destructiva
  });
});
