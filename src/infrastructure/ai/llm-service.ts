/**
 * Capa `LLMService` provider-agnóstica (issue #293 / F1-09).
 *
 * Una sola interfaz para generar JSON con Claude o Groq. La implementación de
 * Claude usa el **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`): `generateObject`
 * con schema Zod, prompt caching de Anthropic vía `providerOptions`, y
 * telemetría OpenTelemetry sin código extra.
 *
 * Reglas que se conservan del RAG:
 *  - `completeJSON` **nunca lanza**: ante cualquier error devuelve `null`.
 *  - Sin `ANTHROPIC_API_KEY` válida, `getLLMService` cae a Groq y lo registra
 *    una vez (degradación segura).
 *  - `transcribeAudio` (Whisper) no pasa por acá: sigue con el cliente Groq.
 */
import type { ZodType } from 'zod';
import { generateObject, generateText, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getEnv } from '../config/env.js';
import { GroqService } from './groq-service.js';

export type LlmUseCase = 'vault_query' | 'advisor' | 'context' | 'classifier';
export type LlmProvider = 'anthropic' | 'groq';

export interface CompleteJsonOptions<T> {
  /** Si se pasa, la respuesta se valida/estructura contra este schema. */
  schema?: ZodType<T>;
  /** Marca el system prompt como cacheable (prompt caching de Anthropic). */
  cacheSystem?: boolean;
  maxTokens?: number;
}

export interface LLMService {
  readonly isConfigured: boolean;
  /** Identificador del modelo que responde — se registra en `vault_query_log`. */
  readonly modelId: string;
  completeJSON<T = unknown>(
    system: string,
    user: string,
    opts?: CompleteJsonOptions<T>,
  ): Promise<T | null>;
}

/** Saca un objeto JSON de un texto que puede venir con fences ```json o prosa alrededor. */
export function extractJson<T>(text: string): T | null {
  const withoutFences = text.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  const candidate = start !== -1 && end > start ? withoutFences.slice(start, end + 1) : withoutFences;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

export class AnthropicLLMService implements LLMService {
  constructor(
    private readonly model: LanguageModel,
    readonly modelId: string = 'anthropic',
    readonly isConfigured: boolean = true,
  ) {}

  async completeJSON<T>(
    system: string,
    user: string,
    opts: CompleteJsonOptions<T> = {},
  ): Promise<T | null> {
    if (!this.isConfigured) return null;

    // AI SDK v7: el system va como parámetro aparte (no como mensaje). El prompt
    // caching de Anthropic se pide por `providerOptions`; cachear las
    // instrucciones estables y dejar el contexto recuperado sin cachear es la
    // forma correcta de usarlo en un RAG con tráfico.
    const common = {
      model: this.model,
      system,
      prompt: user,
      maxOutputTokens: opts.maxTokens,
      ...(opts.cacheSystem
        ? { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' as const } } } }
        : {}),
    };

    try {
      if (opts.schema) {
        const { object } = await generateObject({ ...common, schema: opts.schema });
        return object as T;
      }
      const { text } = await generateText(common);
      return extractJson<T>(text);
    } catch (err) {
      console.error(
        '[llm-anthropic] completeJSON falló:',
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }
}

export class GroqLLMService implements LLMService {
  readonly modelId = 'groq';

  constructor(private readonly groq: GroqService = new GroqService()) {}

  get isConfigured(): boolean {
    return this.groq.isConfigured;
  }

  async completeJSON<T>(
    system: string,
    user: string,
    opts: CompleteJsonOptions<T> = {},
  ): Promise<T | null> {
    // Groq ignora `cacheSystem`. Si vino un `schema`, se valida la respuesta.
    const raw = await this.groq.completeJSON<T>(system, user);
    if (raw == null) return null;
    if (opts.schema) {
      const parsed = opts.schema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    }
    return raw;
  }
}

let loggedAnthropicFallback = false;

/** Devuelve el `LLMService` que corresponde al caso de uso, según `env`. */
export function getLLMService(useCase: LlmUseCase): LLMService {
  const env = getEnv();
  const providerByUseCase: Record<LlmUseCase, LlmProvider> = {
    vault_query: env.LLM_PROVIDER_VAULT_QUERY,
    advisor: env.LLM_PROVIDER_ADVISOR,
    context: env.LLM_PROVIDER_CONTEXT,
    classifier: env.LLM_PROVIDER_CLASSIFIER,
  };
  let provider = providerByUseCase[useCase];

  const anthropicKey = env.ANTHROPIC_API_KEY;
  const anthropicConfigured =
    anthropicKey.length > 10 && anthropicKey !== 'anthropic_placeholder';

  if (provider === 'anthropic' && !anthropicConfigured) {
    if (!loggedAnthropicFallback) {
      console.warn(
        `[llm-service] ANTHROPIC_API_KEY no configurada — "${useCase}" usa Groq como fallback.`,
      );
      loggedAnthropicFallback = true;
    }
    provider = 'groq';
  }

  if (provider === 'groq') return new GroqLLMService();

  const anthropic = createAnthropic({ apiKey: anthropicKey });
  const modelId =
    useCase === 'context'
      ? env.LLM_MODEL_ANTHROPIC_CHEAP
      : env.LLM_MODEL_ANTHROPIC_DEFAULT;
  return new AnthropicLLMService(anthropic(modelId), modelId);
}

/** Sólo para tests: resetea el flag del warning de fallback. */
export function __resetLLMServiceState(): void {
  loggedAnthropicFallback = false;
}
