import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { VaultChunkRepository, UpsertChunkInput, VaultChunkIdentity } from '@/application/vault-indexer/vault-chunk-repository.js';
import type { Embedder } from '@/infrastructure/ai/voyage-service.js';

/**
 * Cubre la auto-reparación de checkouts de la bóveda con `.git` roto (clone
 * previo interrumpido, disco efímero de Railway reseteado a medias, etc.):
 * si el directorio TIENE `.git` pero `git pull` falla, el servicio borra el
 * checkout entero y clona de cero, en vez de seguir indexando lo poco que
 * haya quedado. Mockea `execSync` para no pegarle a GitHub de verdad.
 */

const { execSyncMock } = vi.hoisted(() => ({ execSyncMock: vi.fn() }));
vi.mock('node:child_process', () => ({ execSync: execSyncMock }));

class FakeRepository implements VaultChunkRepository {
  chunks = new Map<string, UpsertChunkInput>();
  async listBySourceFile(sourceFile: string): Promise<VaultChunkIdentity[]> {
    return [...this.chunks.values()]
      .filter((c) => c.sourceFile === sourceFile)
      .map((c) => ({ chunkIndex: c.chunkIndex, contentHash: c.contentHash }));
  }
  async countDistinctSourceFiles(): Promise<number> {
    return new Set([...this.chunks.values()].map((c) => c.sourceFile)).size;
  }
  async upsertChunk(input: UpsertChunkInput): Promise<void> {
    this.chunks.set(`${input.sourceFile}#${input.chunkIndex}`, input);
  }
  async deleteChunksBeyondIndex(sourceFile: string, keepUpTo: number): Promise<number> {
    let count = 0;
    for (const [key, chunk] of this.chunks) {
      if (chunk.sourceFile === sourceFile && chunk.chunkIndex > keepUpTo) { this.chunks.delete(key); count++; }
    }
    return count;
  }
  async deleteOrphanChunks(currentSourceFiles: string[]): Promise<number> {
    let count = 0;
    for (const [key, chunk] of this.chunks) {
      if (!currentSourceFiles.includes(chunk.sourceFile)) { this.chunks.delete(key); count++; }
    }
    return count;
  }
}

class FakeEmbedder implements Embedder {
  isConfigured = true;
  async embed(texts: string[]): Promise<number[][] | null> {
    return texts.map((_, i) => [i, i + 1, i + 2]);
  }
}

describe('VaultIndexerService — auto-reparación de checkout roto', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'vault-reclone-test-'));
    execSyncMock.mockReset();
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it('si el checkout tiene .git pero "git pull" falla, borra el directorio y clona de cero', async () => {
    // Simula un checkout roto: tiene .git (así que el servicio intenta pull),
    // pero el pull va a fallar (mock), y adentro queda contenido viejo/parcial
    // que NO debería sobrevivir al reclone.
    await mkdir(join(vaultPath, '.git'));
    await writeFile(join(vaultPath, 'vieja.md'), '# Vieja\n\nContenido de un checkout roto.\n', 'utf-8');

    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === 'git pull') throw new Error('fatal: not a git repository (or any parent up to mount point)');
      if (cmd.startsWith('git clone')) {
        // Un `git clone` real siempre crea el directorio destino (aunque el
        // repo remoto esté vacío). Como acá no hay red de verdad, el mock
        // recrea el directorio para simular ese efecto y nada más — por eso
        // termina vacío y dispara la salvaguarda de "vault vacío" más abajo.
        mkdirSync(vaultPath, { recursive: true });
        return Buffer.from('');
      }
      if (cmd === 'git rev-parse HEAD') return Buffer.from('abc123\n');
      return Buffer.from('');
    });

    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    const { VaultIndexerService } = await import('@/application/vault-indexer/vault-indexer-service.js');
    const service = new VaultIndexerService(repo, embedder);

    // El mock de `git clone` no escribe archivos de verdad (no hay red), así
    // que tras el reclone el directorio queda vacío — eso es justamente lo
    // que prueba que SÍ se borró: dispara la salvaguarda de "vault vacío" en
    // vez de seguir indexando "vieja.md".
    await expect(service.indexVault(vaultPath)).rejects.toThrow('No se encontraron notas');

    const pullCalls = execSyncMock.mock.calls.filter(([cmd]) => cmd === 'git pull');
    const cloneCalls = execSyncMock.mock.calls.filter(([cmd]) => typeof cmd === 'string' && cmd.startsWith('git clone'));
    expect(pullCalls).toHaveLength(1);
    expect(cloneCalls).toHaveLength(1); // reclonó después del pull fallido
  });

  it('si NO hay .git, no intenta pull ni clone — usa el contenido tal cual (compat con el resto de los tests)', async () => {
    await writeFile(join(vaultPath, 'nota.md'), '# Nota\n\nContenido real, sin git.\n', 'utf-8');

    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    const { VaultIndexerService } = await import('@/application/vault-indexer/vault-indexer-service.js');
    const service = new VaultIndexerService(repo, embedder);

    const result = await service.indexVault(vaultPath);

    expect(result.filesProcessed).toBe(1);
    // No debe intentar ni pull ni clone (no hay .git) — solo puede haber
    // llamado a `git rev-parse HEAD` para el commit, que falla gracefully.
    const pullOrCloneCalls = execSyncMock.mock.calls.filter(
      ([cmd]) => cmd === 'git pull' || (typeof cmd === 'string' && cmd.startsWith('git clone')),
    );
    expect(pullOrCloneCalls).toHaveLength(0);
  });
});
