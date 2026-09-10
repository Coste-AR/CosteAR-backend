import { getEnv } from '../config/env.js';
import { voyageFetch } from './voyage-rate-limiter.js';

const RERANK_API_URL = 'https://api.voyageai.com/v1/rerank';
export const RERANK_MODEL = 'rerank-2.5';

interface VoyageRerankResponse {
  data: { index: number; relevance_score: number }[];
}

/**
 * Re-ranking con Voyage `rerank-2.5`. Toma los candidatos del retriever híbrido
 * y los reordena por relevancia real query↔documento. Es el mayor salto de
 * precisión por dólar del pipeline.
 *
 * `getEnv()` se resuelve perezosamente: el retriever que lo instancia puede
 * construirse en contextos sin el entorno completo cargado.
 */
export class VoyageReranker {
  private apiKey: string | null = null;

  private getApiKey(): string {
    if (this.apiKey === null) this.apiKey = getEnv().VOYAGE_API_KEY;
    return this.apiKey;
  }

  get isConfigured(): boolean {
    const key = this.getApiKey();
    return key.length > 10 && key !== 'voyage_placeholder';
  }

  /**
   * Devuelve `{ index, score }` de `documents` ordenados por relevancia (mejor
   * primero), truncados a `topK`. `index` apunta al array `documents` original.
   * `null` si el reranker no está configurado o falla — el caller cae al orden
   * que ya traía (degradación segura).
   */
  async rerank(
    query: string,
    documents: string[],
    topK: number,
  ): Promise<Array<{ index: number; score: number }> | null> {
    if (!this.isConfigured || documents.length === 0) return null;

    try {
      const res = await voyageFetch(RERANK_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.getApiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          documents,
          model: RERANK_MODEL,
          top_k: Math.min(topK, documents.length),
        }),
      });

      if (!res.ok) {
        console.error('[voyage-reranker] Error de API:', await res.text());
        return null;
      }

      const data = (await res.json()) as VoyageRerankResponse;
      return data.data
        .slice()
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .map((d) => ({ index: d.index, score: d.relevance_score }));
    } catch (err) {
      console.error('[voyage-reranker] Error inesperado:', err);
      return null;
    }
  }
}
