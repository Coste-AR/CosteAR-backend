/**
 * Cliente de embeddings de Voyage AI, usado para indexar la bóveda de
 * costeo. Voyage no ofrece chat (eso lo sigue resolviendo Groq) — esto es
 * exclusivamente para convertir texto a vectores.
 */
import { getEnv } from '../config/env.js';
import { voyageFetch } from './voyage-rate-limiter.js';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const EMBEDDING_MODEL = 'voyage-4-large';
export const EMBEDDING_DIMENSIONS = 1024;

interface VoyageEmbeddingsResponse {
  data: { embedding: number[]; index: number }[];
}

/** Interfaz mínima para poder inyectar un fake en tests. */
export interface Embedder {
  readonly isConfigured: boolean;
  embed(texts: string[], inputType?: 'document' | 'query'): Promise<number[][] | null>;
}

export class VoyageService implements Embedder {
  private readonly apiKey: string;

  constructor() {
    this.apiKey = getEnv().VOYAGE_API_KEY;
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 10 && this.apiKey !== 'voyage_placeholder';
  }

  /**
   * Devuelve un embedding por texto, en el mismo orden que `texts`.
   * Devuelve null solo ante error de transporte/config — nunca lanza.
   */
  async embed(texts: string[], inputType: 'document' | 'query' = 'document'): Promise<number[][] | null> {
    if (!this.isConfigured) return null;
    if (texts.length === 0) return [];

    try {
      const res = await voyageFetch(VOYAGE_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: texts,
          model: EMBEDDING_MODEL,
          input_type: inputType,
          output_dimension: EMBEDDING_DIMENSIONS,
        }),
      });
      if (!res.ok) {
        console.error('[voyage] Error de API:', await res.text());
        return null;
      }
      const data = (await res.json()) as VoyageEmbeddingsResponse;
      return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    } catch (err) {
      console.error('[voyage] Error inesperado:', err);
      return null;
    }
  }
}
