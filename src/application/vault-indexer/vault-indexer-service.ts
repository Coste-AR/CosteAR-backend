import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { chunkMarkdown } from './markdown-chunker.js';
import { PrismaVaultChunkRepository, type VaultChunkRepository } from './vault-chunk-repository.js';
import { VoyageService, type Embedder } from '../../infrastructure/ai/voyage-service.js';

export interface IndexVaultResult {
  filesProcessed: number;
  chunksUpserted: number;
  chunksSkippedUnchanged: number;
  chunksDeleted: number;
  filesWithErrors: string[];
}

const IGNORED_DIRS = new Set(['.obsidian', '.trash', '.git']);

async function listMarkdownFiles(rootDir: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        result.push(join(dir, entry.name));
      }
    }
  }
  await walk(rootDir);
  return result;
}

export class VaultIndexerService {
  constructor(
    private readonly repo: VaultChunkRepository = new PrismaVaultChunkRepository(),
    private readonly embedder: Embedder = new VoyageService(),
  ) {}

  async indexVault(vaultPath: string, vaultCommit: string): Promise<IndexVaultResult> {
    if (!this.embedder.isConfigured) {
      throw new Error('VOYAGE_API_KEY no configurada: no se puede indexar sin embeddings.');
    }

    const absoluteFiles = await listMarkdownFiles(vaultPath);
    if (absoluteFiles.length === 0) {
      // Salvaguarda: deleteOrphanChunks([]) borraría TODA la tabla vault_chunks
      // (ver vault-chunk-repository.ts). Un vault vacío/mal configurado no debe
      // poder vaciar la bóveda indexada — tratamos "cero notas" como error de
      // configuración, no como "se borraron todas las notas".
      throw new Error(
        `No se encontraron notas .md en ${vaultPath}. Verificá el path — por seguridad no se borra nada de la bóveda indexada.`,
      );
    }
    const relativeFiles = absoluteFiles.map((f) => relative(vaultPath, f).replace(/\\/g, '/'));

    const result: IndexVaultResult = {
      filesProcessed: 0,
      chunksUpserted: 0,
      chunksSkippedUnchanged: 0,
      chunksDeleted: 0,
      filesWithErrors: [],
    };

    for (let i = 0; i < absoluteFiles.length; i++) {
      const absoluteFile = absoluteFiles[i]!;
      const sourceFile = relativeFiles[i]!;
      try {
        await this.indexFile(absoluteFile, sourceFile, vaultCommit, result);
        result.filesProcessed++;
      } catch (err) {
        console.error(`[vault-indexer] Error indexando ${sourceFile}:`, err);
        result.filesWithErrors.push(sourceFile);
      }
    }

    result.chunksDeleted += await this.repo.deleteOrphanChunks(relativeFiles);

    return result;
  }

  private async indexFile(
    absoluteFile: string,
    sourceFile: string,
    vaultCommit: string,
    result: IndexVaultResult,
  ): Promise<void> {
    const rawContent = await readFile(absoluteFile, 'utf-8');
    const chunks = chunkMarkdown(sourceFile, rawContent);
    const existing = await this.repo.listBySourceFile(sourceFile);
    const existingByIndex = new Map(existing.map((e) => [e.chunkIndex, e.contentHash]));

    const toEmbed = chunks.filter((c) => existingByIndex.get(c.chunkIndex) !== c.contentHash);
    result.chunksSkippedUnchanged += chunks.length - toEmbed.length;

    if (toEmbed.length > 0) {
      const embeddings = await this.embedder.embed(toEmbed.map((c) => c.content), 'document');
      if (!embeddings) {
        throw new Error(`Voyage no devolvió embeddings para ${sourceFile}`);
      }
      for (let i = 0; i < toEmbed.length; i++) {
        const chunk = toEmbed[i]!;
        await this.repo.upsertChunk({
          sourceFile,
          sourceTitle: chunk.sourceTitle,
          headingPath: chunk.headingPath,
          content: chunk.content,
          contentHash: chunk.contentHash,
          chunkIndex: chunk.chunkIndex,
          vaultCommit,
          embedding: embeddings[i]!,
        });
        result.chunksUpserted++;
      }
    }

    result.chunksDeleted += await this.repo.deleteChunksBeyondIndex(sourceFile, chunks.length - 1);
  }
}
