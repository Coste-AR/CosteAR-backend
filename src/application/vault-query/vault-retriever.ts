import type { VaultSourceType } from '@prisma/client';
import { VoyageService } from '../../infrastructure/ai/voyage-service.js';
import { VoyageReranker } from '../../infrastructure/ai/voyage-reranker.js';
import {
  PrismaVaultChunkRepository,
  type VaultSearchHit,
} from '../vault-indexer/vault-chunk-repository.js';
import { UnprocessableEntityError } from '../../domain/errors/domain-error.js';

/** Versión del retriever — se registra en `vault_query_log`. */
export const RETRIEVER_VERSION = 'v3-hybrid-rrf-rerank';

/** Cuántos candidatos pide cada rama antes de fusionar. */
const CANDIDATE_POOL = 20;

/** Constante de la Reciprocal Rank Fusion. 60 es el valor del paper original. */
const RRF_K = 60;

export interface RetrievedChunk {
  id: string;
  sourceFile: string;
  sourceTitle: string;
  headingPath: string | null;
  content: string;
  sourceType: VaultSourceType | null;
  /** Posición (1-based) en la rama vector, o `null` si no apareció ahí. */
  vectorRank: number | null;
  /** Posición (1-based) en la rama full-text, o `null` si no apareció ahí. */
  ftsRank: number | null;
  /** Distancia coseno del mejor match vector, o `null` si vino solo por full-text. */
  distance: number | null;
  rrfScore: number;
  /** Score de relevancia del reranker, o `null` si el rerank no corrió. */
  rerankScore: number | null;
}

export interface RetrieveOptions {
  /** Cantidad final de chunks a devolver. Default 5. */
  limit?: number;
  /** Acota a estos namespaces (`sourceType`). Default: todos. */
  namespaces?: VaultSourceType[];
}

/**
 * Recupera chunks de la bóveda combinando búsqueda semántica (pgvector) y
 * full-text en español (`contentTsv`), fusionadas con Reciprocal Rank Fusion.
 *
 * Reemplaza al `repo.searchChunks` + reintento de umbral que hacía antes
 * `VaultQueryService`. El full-text captura siglas y términos exactos de la
 * cátedra que el vector solo se pierde (era justo el caso del reintento LOW).
 */
export class VaultRetriever {
  constructor(
    private readonly embedder: VoyageService = new VoyageService(),
    private readonly repo: PrismaVaultChunkRepository = new PrismaVaultChunkRepository(),
    private readonly reranker: VoyageReranker = new VoyageReranker(),
  ) {}

  async retrieve(question: string, opts: RetrieveOptions = {}): Promise<RetrievedChunk[]> {
    const limit = opts.limit ?? 5;

    const embeddings = await this.embedder.embed([question], 'query');
    const queryVector = embeddings?.[0];
    if (!queryVector) {
      throw new UnprocessableEntityError('No se pudo generar el embedding para la consulta.');
    }

    const [vectorHits, ftsHits] = await Promise.all([
      this.repo.searchByVector(queryVector, CANDIDATE_POOL, opts.namespaces),
      this.repo.searchByFullText(question, CANDIDATE_POOL, opts.namespaces),
    ]);

    const fused = fuseRRF(vectorHits, ftsHits);
    if (fused.length === 0) return [];

    // Re-ranking sobre los candidatos del híbrido. Si no está configurado o
    // falla, se cae al orden por RRF (degradación segura).
    const reranked = await this.reranker.rerank(
      question,
      fused.map((c) => c.content),
      limit,
    );
    if (reranked) {
      return reranked.map(({ index, score }) => ({ ...fused[index]!, rerankScore: score }));
    }
    return fused.slice(0, limit);
  }
}

/**
 * Reciprocal Rank Fusion: cada documento suma `1 / (k + rank)` por cada lista
 * en la que aparece. No necesita que los scores de las dos ramas sean
 * comparables — solo su orden.
 */
export function fuseRRF(vectorHits: VaultSearchHit[], ftsHits: VaultSearchHit[]): RetrievedChunk[] {
  const byId = new Map<string, RetrievedChunk>();

  const ensure = (hit: VaultSearchHit): RetrievedChunk => {
    let entry = byId.get(hit.id);
    if (!entry) {
      entry = {
        id: hit.id,
        sourceFile: hit.sourceFile,
        sourceTitle: hit.sourceTitle,
        headingPath: hit.headingPath,
        content: hit.content,
        sourceType: hit.sourceType,
        vectorRank: null,
        ftsRank: null,
        distance: null,
        rrfScore: 0,
        rerankScore: null,
      };
      byId.set(hit.id, entry);
    }
    return entry;
  };

  vectorHits.forEach((hit, i) => {
    const entry = ensure(hit);
    entry.vectorRank = i + 1;
    entry.distance = hit.distance;
    entry.rrfScore += 1 / (RRF_K + i + 1);
  });

  ftsHits.forEach((hit, i) => {
    const entry = ensure(hit);
    entry.ftsRank = i + 1;
    entry.rrfScore += 1 / (RRF_K + i + 1);
  });

  return [...byId.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}
