import type { Env } from '../config/env.js';
import { getEnv } from '../config/env.js';
import type { ClassifierCompletionClient } from '../ai/groq-classifier.js';
import { groqFetch } from '../ai/groq-rate-limiter.js';

type ClassifierEnv = Pick<
  Env,
  'CLASSIFIER_AI_PROVIDER' | 'CLASSIFIER_AI_MODEL' | 'CLASSIFIER_AI_API_KEY' | 'GROQ_API_KEY'
>;

type FetchLike = (url: string, options: RequestInit) => Promise<Response>;

const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'openai/gpt-oss-120b',
  },
  deepseek: {
    url: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-flash',
  },
} as const;

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[];
}

class OpenAiCompatibleClassifierClient implements ClassifierCompletionClient {
  readonly model: string;
  private readonly apiKey: string;
  private readonly url: string;
  private readonly provider: ClassifierEnv['CLASSIFIER_AI_PROVIDER'];
  private readonly request: FetchLike;

  constructor(env: ClassifierEnv, request: FetchLike) {
    // El fallback mantiene compatibles consumidores/tests que inyectan un
    // `getEnv()` mínimo anterior a #386. En el arranque real parseEnv siempre
    // completa y valida esta variable.
    this.provider = env.CLASSIFIER_AI_PROVIDER ?? 'groq';
    const providerConfig = PROVIDERS[this.provider];
    this.url = providerConfig.url;
    this.model = env.CLASSIFIER_AI_MODEL ?? providerConfig.model;
    this.apiKey = env.CLASSIFIER_AI_API_KEY
      ?? (this.provider === 'groq' ? env.GROQ_API_KEY : '');
    this.request = request;
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 10
      && this.apiKey !== 'groq_placeholder'
      && !this.apiKey.includes('xxxxxxxx');
  }

  async postGroqRaw(body: Record<string, unknown>): Promise<string | null> {
    if (!this.isConfigured) return null;

    const requestBody: Record<string, unknown> = { ...body, model: this.model };
    if (this.provider === 'deepseek') {
      // DeepSeek no declara `seed` en su contrato OpenAI-compatible y activa
      // thinking por default. Layer 5 necesita JSON corto y determinista.
      delete requestBody.seed;
      requestBody.thinking = { type: 'disabled' };
    }

    try {
      const response = await this.request(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        console.error(`[classifier-ai:${this.provider}] Error de API:`, await response.text());
        return null;
      }
      const data = await response.json() as OpenAiResponse;
      return data.choices?.[0]?.message?.content ?? '';
    } catch (error) {
      console.error(`[classifier-ai:${this.provider}] Error inesperado:`, error);
      return null;
    }
  }
}

export function createClassifierAiClient(
  env: ClassifierEnv = getEnv(),
  request?: FetchLike,
): ClassifierCompletionClient {
  const provider = env.CLASSIFIER_AI_PROVIDER ?? 'groq';
  const transport = request
    ?? (provider === 'groq' ? groqFetch : (url, options) => fetch(url, options));
  return new OpenAiCompatibleClassifierClient(env, transport);
}
