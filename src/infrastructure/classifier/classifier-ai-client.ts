import type { Env } from '../config/env.js';
import { getEnv } from '../config/env.js';
import type { ClassifierAiCallMetric, ClassifierCompletionClient } from '../ai/groq-classifier.js';
import { groqFetch } from '../ai/groq-rate-limiter.js';

type ClassifierEnv = Pick<
  Env,
  'CLASSIFIER_AI_PROVIDER' | 'CLASSIFIER_AI_MODEL' | 'CLASSIFIER_AI_API_KEY' | 'GROQ_API_KEY'
  | 'CLASSIFIER_AI_PRICING_JSON'
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
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function priceFor(env: ClassifierEnv, provider: string, model: string) {
  try {
    const table = JSON.parse(env.CLASSIFIER_AI_PRICING_JSON ?? '{}') as Record<string, Record<string, { input?: number; output?: number; currency?: string }>>;
    const price = table[provider]?.[model];
    return price && Number.isFinite(price.input) && Number.isFinite(price.output) && typeof price.currency === 'string' && price.currency.length > 0
      ? { input: price.input!, output: price.output!, currency: price.currency }
      : null;
  } catch {
    return null;
  }
}

class OpenAiCompatibleClassifierClient implements ClassifierCompletionClient {
  readonly model: string;
  private readonly apiKey: string;
  private readonly url: string;
  private readonly provider: ClassifierEnv['CLASSIFIER_AI_PROVIDER'];
  private readonly request: FetchLike;
  private readonly price: { input: number; output: number; currency: string } | null;

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
    this.price = priceFor(env, this.provider, this.model);
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 10
      && this.apiKey !== 'groq_placeholder'
      && !this.apiKey.includes('xxxxxxxx');
  }

  async postGroqRaw(body: Record<string, unknown>, onCall?: (call: ClassifierAiCallMetric) => void): Promise<string | null> {
    if (!this.isConfigured) return null;

    const requestBody: Record<string, unknown> = { ...body, model: this.model };
    if (this.provider === 'deepseek') {
      // DeepSeek no declara `seed` en su contrato OpenAI-compatible y activa
      // thinking por default. Layer 5 necesita JSON corto y determinista.
      delete requestBody.seed;
      requestBody.thinking = { type: 'disabled' };
    }

    const startedAt = performance.now();
    const emit = (inputTokens: number | null, outputTokens: number | null) => {
      const estimatedCost = inputTokens !== null && outputTokens !== null && this.price
        ? (inputTokens * this.price.input + outputTokens * this.price.output) / 1_000_000
        : null;
      onCall?.({
        provider: this.provider,
        model: this.model,
        inputTokens,
        outputTokens,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        estimatedCost,
        costCurrency: this.price?.currency ?? null,
      });
    };
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
        emit(null, null);
        console.error(`[classifier-ai:${this.provider}] Error de API:`, await response.text());
        return null;
      }
      const data = await response.json() as OpenAiResponse;
      const inputTokens = Number.isInteger(data.usage?.prompt_tokens) ? data.usage!.prompt_tokens! : null;
      const outputTokens = Number.isInteger(data.usage?.completion_tokens) ? data.usage!.completion_tokens! : null;
      emit(inputTokens, outputTokens);
      return data.choices?.[0]?.message?.content ?? '';
    } catch (error) {
      emit(null, null);
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
