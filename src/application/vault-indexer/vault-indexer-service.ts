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
const BATCH_SIZE = 20;

async function listMarkdownFiles(rootDir: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // El README.md de la raíz del repo son instrucciones para el equipo
        // (cómo subir contenido), no conocimiento de costeo — no se indexa.
        if (dir === rootDir && entry.name.toLowerCase() === 'readme.md') continue;
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

    const toEmbedQueue: { sourceFile: string; chunk: ReturnType<typeof chunkMarkdown>[number] }[] = [];
    const maxChunksPerFile = new Map<string, number>();

    // Fase 1: Identificar qué chunks cambiaron
    for (let i = 0; i < absoluteFiles.length; i++) {
      const absoluteFile = absoluteFiles[i]!;
      const sourceFile = relativeFiles[i]!;
      try {
        const rawContent = await readFile(absoluteFile, 'utf-8');
        const chunks = chunkMarkdown(sourceFile, rawContent);
        maxChunksPerFile.set(sourceFile, chunks.length);

        const existing = await this.repo.listBySourceFile(sourceFile);
        const existingByIndex = new Map(existing.map((e) => [e.chunkIndex, e.contentHash]));

        const toEmbed = chunks.filter((c) => existingByIndex.get(c.chunkIndex) !== c.contentHash);
        result.chunksSkippedUnchanged += chunks.length - toEmbed.length;

        for (const chunk of toEmbed) {
          toEmbedQueue.push({ sourceFile, chunk });
        }
        result.filesProcessed++;
      } catch (err) {
        console.error(`[vault-indexer] Error leyendo ${sourceFile}:`, err);
        result.filesWithErrors.push(sourceFile);
      }
    }

    // Fase 2: Embeddear en batches
    for (let i = 0; i < toEmbedQueue.length; i += BATCH_SIZE) {
      const batch = toEmbedQueue.slice(i, i + BATCH_SIZE);
      const embeddings = await this.embedder.embed(batch.map((item) => item.chunk.content), 'document');
      
      if (!embeddings) {
        throw new Error('Voyage no devolvió embeddings para un lote de chunks');
      }

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j]!;
        await this.repo.upsertChunk({
          sourceFile: item.sourceFile,
          sourceTitle: item.chunk.sourceTitle,
          headingPath: item.chunk.headingPath,
          content: item.chunk.content,
          contentHash: item.chunk.contentHash,
          chunkIndex: item.chunk.chunkIndex,
          vaultCommit,
          embedding: embeddings[j]!,
        });
        result.chunksUpserted++;
      }
    }

    // Fase 3: Limpiar chunks viejos
    for (const [sourceFile, totalChunks] of maxChunksPerFile.entries()) {
      result.chunksDeleted += await this.repo.deleteChunksBeyondIndex(sourceFile, totalChunks - 1);
    }
    result.chunksDeleted += await this.repo.deleteOrphanChunks(relativeFiles);

    return result;
  }
}
