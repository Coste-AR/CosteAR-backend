import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { MockLanguageModelV4 } from 'ai/test';

// `getEnv` valida el entorno completo (DATABASE_URL, etc.), que no está en el
// proceso de la suite rápida. Se controla acá para probar la selección de
// proveedor sin depender de un `.env`.
const envValues: Record<string, string | undefined> = {
  LLM_PROVIDER_VAULT_QUERY: 'anthropic',
  LLM_PROVIDER_ADVISOR: 'anthropic',
  LLM_PROVIDER_CONTEXT: 'anthropic',
  LLM_PROVIDER_CLASSIFIER: 'groq',
  LLM_MODEL_ANTHROPIC_DEFAULT: 'claude-sonnet-4-5',
  LLM_MODEL_ANTHROPIC_CHEAP: 'claude-haiku-4-5',
  ANTHROPIC_API_KEY: undefined,
};
vi.mock('@/infrastructure/config/env.js', () => ({
  getEnv: () => envValues,
  resetEnvCache: () => {},
}));

const {
  AnthropicLLMService,
  GroqLLMService,
  extractJson,
  __resetLLMServiceState,
  getLLMService,
} = await import('@/infrastructure/ai/llm-service.js');
type GroqService = import('@/infrastructure/ai/groq-service.js').GroqService;

function textModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: 'text', text }],
      warnings: [],
    }),
  });
}

function throwingModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error('modelo caído');
    },
  });
}

beforeEach(() => __resetLLMServiceState());

describe('extractJson', () => {
  it('parsea JSON con fences y prosa alrededor', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Claro, acá está: {"b":2} — listo')).toEqual({ b: 2 });
    expect(extractJson('no es json')).toBeNull();
  });
});

describe('AnthropicLLMService.completeJSON', () => {
  it('sin schema: devuelve el objeto parseado del texto del modelo', async () => {
    const svc = new AnthropicLLMService(textModel('{"answer":"hola","confidence":"HIGH"}'));
    const res = await svc.completeJSON('sys', 'user');
    expect(res).toEqual({ answer: 'hola', confidence: 'HIGH' });
  });

  it('nunca lanza: un modelo que tira error devuelve null', async () => {
    const svc = new AnthropicLLMService(throwingModel());
    const res = await svc.completeJSON('sys', 'user');
    expect(res).toBeNull();
  });

  it('no configurado devuelve null sin llamar al modelo', async () => {
    const model = textModel('{"x":1}');
    const spy = vi.spyOn(model, 'doGenerate');
    const svc = new AnthropicLLMService(model, 'test-model', false);
    expect(await svc.completeJSON('sys', 'user')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('cacheSystem pasa el providerOptions de cache de Anthropic', async () => {
    const model = textModel('{"ok":true}');
    const spy = vi.spyOn(model, 'doGenerate');
    const svc = new AnthropicLLMService(model);
    await svc.completeJSON('instrucciones estables', 'pregunta', { cacheSystem: true });

    const call = spy.mock.calls[0]![0] as { providerOptions?: unknown };
    expect(call.providerOptions).toMatchObject({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
  });

  it('sin cacheSystem no manda providerOptions', async () => {
    const model = textModel('{"ok":true}');
    const spy = vi.spyOn(model, 'doGenerate');
    await new AnthropicLLMService(model).completeJSON('sys', 'user');
    const call = spy.mock.calls[0]![0] as { providerOptions?: unknown };
    expect(call.providerOptions).toBeUndefined();
  });
});

describe('GroqLLMService.completeJSON', () => {
  const fakeGroq = { isConfigured: true, completeJSON: vi.fn() } as unknown as GroqService;

  beforeEach(() => vi.mocked(fakeGroq.completeJSON).mockReset());

  it('delega en GroqService y devuelve el objeto', async () => {
    vi.mocked(fakeGroq.completeJSON).mockResolvedValue({ answer: 'x' });
    const svc = new GroqLLMService(fakeGroq);
    expect(await svc.completeJSON('s', 'u')).toEqual({ answer: 'x' });
  });

  it('con schema: valida la respuesta y devuelve null si no cumple', async () => {
    const schema = z.object({ n: z.number() });
    vi.mocked(fakeGroq.completeJSON).mockResolvedValue({ n: 'no-es-numero' });
    const svc = new GroqLLMService(fakeGroq);
    expect(await svc.completeJSON('s', 'u', { schema })).toBeNull();

    vi.mocked(fakeGroq.completeJSON).mockResolvedValue({ n: 42 });
    expect(await svc.completeJSON('s', 'u', { schema })).toEqual({ n: 42 });
  });

  it('propaga null de Groq', async () => {
    vi.mocked(fakeGroq.completeJSON).mockResolvedValue(null);
    const svc = new GroqLLMService(fakeGroq);
    expect(await svc.completeJSON('s', 'u')).toBeNull();
  });
});

describe('getLLMService (selección por caso de uso)', () => {
  beforeEach(() => {
    envValues.LLM_PROVIDER_VAULT_QUERY = 'anthropic';
    envValues.ANTHROPIC_API_KEY = undefined;
    __resetLLMServiceState();
  });

  it('classifier usa Groq por default', () => {
    expect(getLLMService('classifier')).toBeInstanceOf(GroqLLMService);
  });

  it('vault_query cae a Groq cuando ANTHROPIC_API_KEY no está configurada', () => {
    expect(getLLMService('vault_query')).toBeInstanceOf(GroqLLMService);
  });

  it('vault_query usa Anthropic cuando hay key válida', () => {
    envValues.ANTHROPIC_API_KEY = 'sk-ant-clave-de-prueba-suficientemente-larga';
    expect(getLLMService('vault_query')).toBeInstanceOf(AnthropicLLMService);
  });
});
