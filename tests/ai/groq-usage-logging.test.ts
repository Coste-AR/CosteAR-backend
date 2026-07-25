import { describe, it, expect, beforeEach, vi } from 'vitest';

const { groqFetchMock } = vi.hoisted(() => ({ groqFetchMock: vi.fn() }));

vi.mock('@/infrastructure/ai/groq-rate-limiter.js', () => ({ groqFetch: groqFetchMock }));
vi.mock('@/infrastructure/config/env.js', () => ({
  getEnv: () => ({ GROQ_API_KEY: 'test-key-abcdefghij' }),
}));

import { GroqClient } from '@/infrastructure/ai/groq-client.js';

beforeEach(() => {
  groqFetchMock.mockReset();
});

describe('GroqClient — logging de uso de tokens', () => {
  it('completeJSON loguea prompt/completion/total tokens cuando la API los devuelve', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    groqFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 1200, completion_tokens: 80, total_tokens: 1280 },
      }),
      text: async () => '',
    });

    const client = new GroqClient();
    await client.completeJSON('system', 'user');

    expect(infoSpy).toHaveBeenCalledWith(
      '[groq] usage',
      expect.objectContaining({ promptTokens: 1200, completionTokens: 80, totalTokens: 1280 }),
    );
    infoSpy.mockRestore();
  });
});
