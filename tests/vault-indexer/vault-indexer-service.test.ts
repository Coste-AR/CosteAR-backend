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

  async countDistinctSourceFiles(): Promise<number> {
    return new Set([...this.chunks.values()].map((c) => c.sourceFile)).size;
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

  it('NO borra los chunks existentes si de golpe aparecen muchos menos archivos que los ya indexados (checkout parcial/roto)', async () => {
    // Simula un vault sano con 10 notas, ya indexado (por encima del piso de
    // la salvaguarda — con vaults chicos de pocas notas, un vaivén normal de
    // contenido no debe disparar el error).
    const NOTE_COUNT = 10;
    for (let i = 0; i < NOTE_COUNT; i++) {
      await writeFile(join(vaultPath, `nota-${i}.md`), `# Nota ${i}\n\nContenido ${i}.\n`, 'utf-8');
    }
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    const service = new VaultIndexerService(repo, embedder);

    await service.indexVault(vaultPath, 'commit-1');
    expect(repo.chunks.size).toBe(NOTE_COUNT); // 1 chunk por nota

    // Simula un checkout parcial/roto: de las 10 notas, solo quedan 2 en disco
    // (ej. un `git clone`/`git pull` que se cortó a mitad de camino en el
    // deploy, dejando el working tree incompleto pero no vacío). El directorio
    // SIGUE EXISTIENDO y SIGUE TENIENDO contenido, así que la salvaguarda de
    // "vault vacío" no dispara.
    for (let i = 2; i < NOTE_COUNT; i++) {
      await rm(join(vaultPath, `nota-${i}.md`));
    }

    // No debe indexar "exitosamente" borrando las 8 notas restantes como si
    // fueran eliminadas de verdad: eso destruiría 80% de la bóveda por un
    // problema de infraestructura, no una limpieza real de contenido.
    await expect(service.indexVault(vaultPath, 'commit-2')).rejects.toThrow(/checkout (parcial|incompleto)/i);
    expect(repo.chunks.size).toBe(NOTE_COUNT); // nada se borró
  });

  it('rechaza un segundo indexVault mientras el primero todavía está corriendo (evita competir por el rate limit)', async () => {
    await writeFile(join(vaultPath, 'a.md'), '# A\n\nContenido A.\n', 'utf-8');
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    // El embedder no resuelve hasta que el test lo libera explícitamente,
    // simulando una llamada a Voyage que todavía está en el aire.
    let releaseEmbed!: () => void;
    const embedGate = new Promise<void>((resolve) => { releaseEmbed = resolve; });
    const originalEmbed = embedder.embed.bind(embedder);
    embedder.embed = async (texts: string[]) => {
      await embedGate;
      return originalEmbed(texts);
    };
    const service = new VaultIndexerService(repo, embedder);

    const first = service.indexVault(vaultPath, 'commit-1'); // no await: queda "en vuelo"
    await expect(service.indexVault(vaultPath, 'commit-1')).rejects.toThrow(/ya hay una indexación en curso/i);

    releaseEmbed();
    await first; // deja terminar al primero, para no dejar handles colgando entre tests
  });

  it('permite un indexVault nuevo una vez que el anterior ya terminó (incluso si falló)', async () => {
    await writeFile(join(vaultPath, 'a.md'), '# A\n\nContenido A.\n', 'utf-8');
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    embedder.isConfigured = false; // fuerza que el primer intento falle rápido
    const service = new VaultIndexerService(repo, embedder);

    await expect(service.indexVault(vaultPath, 'commit-1')).rejects.toThrow('VOYAGE_API_KEY');

    embedder.isConfigured = true;
    const result = await service.indexVault(vaultPath, 'commit-2'); // no debe seguir "trabado"
    expect(result.chunksUpserted).toBe(1);
  });

  it('ignora el README.md de la raíz del vault (instrucciones del repo, no conocimiento)', async () => {
    await writeFile(
      join(vaultPath, 'README.md'),
      '# costear-knowledge-base\n\nInstrucciones para subir contenido...\n',
      'utf-8',
    );
    await writeFile(join(vaultPath, 'nota.md'), '# Nota real\n\nContenido de costeo.\n', 'utf-8');
    const repo = new FakeRepository();
    const embedder = new FakeEmbedder();
    const service = new VaultIndexerService(repo, embedder);

    const result = await service.indexVault(vaultPath, 'commit-1');

    expect(result.filesProcessed).toBe(1);
    expect([...repo.chunks.values()].every((c) => c.sourceFile !== 'README.md')).toBe(true);
  });
});
