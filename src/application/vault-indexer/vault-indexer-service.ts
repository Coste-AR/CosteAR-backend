import { readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';
import { chunkMarkdown } from './markdown-chunker.js';
import { PrismaVaultChunkRepository, type VaultChunkRepository } from './vault-chunk-repository.js';
import { VoyageService, type Embedder } from '../../infrastructure/ai/voyage-service.js';

export interface IndexVaultResult {
  filesProcessed: number;
  chunksUpserted: number;
  chunksSkippedUnchanged: number;
  chunksDeleted: number;
  filesWithErrors: string[];
  /** Diagnóstico: dónde miró y qué encontró, para depurar sin acceso a los logs del server. */
  debug: {
    vaultPath: string;
    hadGitFolder: boolean;
    vaultCommit: string;
    totalFilesFound: number;
  };
}

const IGNORED_DIRS = new Set(['.obsidian', '.trash', '.git']);
const BATCH_SIZE = 20;

// Módulo-nivel a propósito: hay varios disparadores de indexVault que corren
// en el mismo proceso (botón manual del admin, cron nocturno, aprobar una
// propuesta) y todos comparten el mismo cupo de rate limit de Voyage (3
// req/min sin billing). Si dos corridas se superponen, ninguna de las dos
// termina nunca — cada una le come el cupo a la otra. Un flag por instancia
// no alcanza porque cada caller crea su propio `new VaultIndexerService()`.
let indexingInProgress = false;

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

  async indexVault(vaultPath: string, options: { forceClone?: boolean } = {}): Promise<IndexVaultResult> {
    if (indexingInProgress) {
      throw new Error(
        'Ya hay una indexación en curso (disparada por otro botón, otra pestaña, o el cron nocturno). ' +
          'Esperá a que termine antes de reintentar — correr dos al mismo tiempo compite por el mismo ' +
          'límite de tasa de Voyage y hace que ninguna de las dos termine nunca.',
      );
    }
    indexingInProgress = true;

    try {
      return await this.doIndexVault(vaultPath, options.forceClone ?? false);
    } finally {
      indexingInProgress = false;
    }
  }

  private async doIndexVault(vaultPath: string, forceClone: boolean): Promise<IndexVaultResult> {
    if (!this.embedder.isConfigured) {
      throw new Error('VOYAGE_API_KEY no configurada: no se puede indexar sin embeddings.');
    }

    const cloneUrl = 'https://github.com/Coste-AR/costear-knowledge-base.git';
    const hadGitFolder = existsSync(join(vaultPath, '.git')); // estado ANTES de tocar nada, para diagnóstico

    if (forceClone && existsSync(vaultPath)) {
      // Botón explícito de "forzar re-clone completo": el checkout existente
      // puede no tener .git en absoluto (no viene de un clone previo interrumpido,
      // sino de un directorio creado por otro medio — exactamente lo que dejó la
      // bóveda de staging pegada en 1 archivo suelto sin ninguna señal de "roto"
      // que las salvaguardas automáticas puedan detectar solas). A diferencia del
      // resto de esta función, esto es una acción PEDIDA explícitamente por un
      // admin, no una heurística automática — por eso puede ser más agresiva.
      console.warn(`[vault-indexer] forceClone=true: borrando ${vaultPath} y reclonando de cero...`);
      await rm(vaultPath, { recursive: true, force: true });
    }

    if (!existsSync(vaultPath)) {
      console.log(`[vault-indexer] Bóveda no encontrada en ${vaultPath}. Clonando de GitHub...`);
      execSync(`git clone ${cloneUrl} "${vaultPath}"`, { stdio: 'inherit' });
    } else if (hadGitFolder) {
      try {
        console.log(`[vault-indexer] Actualizando bóveda en ${vaultPath}...`);
        execSync('git pull', { cwd: vaultPath, stdio: 'inherit' });
      } catch (err) {
        // Hay un .git pero el pull falla: checkout corrupto o divergido (clone
        // previo interrumpido a mitad de camino, disco efímero de Railway
        // reseteado entre deploys, etc.). Seguir con lo que haya en disco es
        // EXACTAMENTE lo que deja la bóveda pegada en un puñado de archivos
        // viejos sin que nadie se entere — se borra el checkout entero y se
        // clona de cero en vez de usarlo a ciegas.
        console.warn(`[vault-indexer] git pull falló en ${vaultPath} (checkout roto). Reclonando de cero...`);
        await rm(vaultPath, { recursive: true, force: true });
        execSync(`git clone ${cloneUrl} "${vaultPath}"`, { stdio: 'inherit' });
      }
    } else {
      // El directorio existe pero no es un checkout git (típico en tests, o si
      // el vault se provee por otro medio) — se usa el contenido tal cual está.
      console.log(`[vault-indexer] ${vaultPath} no tiene .git — se usa el contenido tal cual está.`);
    }

    let vaultCommit = 'unknown';
    try {
      vaultCommit = execSync('git rev-parse HEAD', { cwd: vaultPath, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch (e) {
      console.warn('[vault-indexer] No se pudo obtener el commit actual del vault.');
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

    // Salvaguarda contra checkout parcial/roto: si el número de notas que
    // encontramos ahora cayó drásticamente contra lo que YA está indexado,
    // no es "el equipo borró contenido" — es un clone/pull incompleto (disco
    // lleno, corte de red a mitad del `git clone`, deploy interrumpido). Sin
    // esto, la Fase 3 de abajo trataría cada nota "faltante" como huérfana y
    // borraría la bóveda entera por un problema de infraestructura, no de
    // contenido real.
    const alreadyIndexed = await this.repo.countDistinctSourceFiles();
    if (alreadyIndexed > 5 && relativeFiles.length < alreadyIndexed * 0.5) {
      throw new Error(
        `Se encontraron solo ${relativeFiles.length} notas en ${vaultPath}, pero la bóveda indexada tiene ` +
          `${alreadyIndexed} archivos distintos. Parece un checkout parcial o incompleto del vault (git clone/pull ` +
          `cortado a mitad de camino), no una limpieza real de contenido — por seguridad no se borra nada. ` +
          `Verificá el checkout en ${vaultPath} y reintentá.`,
      );
    }

    const result: IndexVaultResult = {
      filesProcessed: 0,
      chunksUpserted: 0,
      chunksSkippedUnchanged: 0,
      chunksDeleted: 0,
      filesWithErrors: [],
      debug: { vaultPath, hadGitFolder, vaultCommit, totalFilesFound: absoluteFiles.length },
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
