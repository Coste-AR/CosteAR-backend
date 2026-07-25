import { describe, it, expect, beforeEach, vi } from 'vitest';

const { groqFetchMock } = vi.hoisted(() => ({ groqFetchMock: vi.fn() }));

vi.mock('@/infrastructure/ai/groq-rate-limiter.js', () => ({
  groqFetch: groqFetchMock,
}));

vi.mock('@/infrastructure/config/env.js', () => ({
  getEnv: () => ({ GROQ_API_KEY: 'test-key-abcdefghij' }),
}));

import { GroqCostitaChat } from '@/infrastructure/ai/groq-costista-chat.js';

function ok(content: unknown) {
  const body = typeof content === 'string' ? content : JSON.stringify(content);
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: body } }] }),
    text: async () => body,
  };
}

function systemMessageOf(callIndex: number): string {
  const init = groqFetchMock.mock.calls[callIndex][1] as { body: string };
  const body = JSON.parse(init.body) as { messages: { role: string; content: unknown }[] };
  return (body.messages.find((m) => m.role === 'system')?.content as string) ?? '';
}

const PORTFOLIO = { companies: [], pendingCount: 0, activeAlerts: 0 };

beforeEach(() => {
  groqFetchMock.mockReset();
});

describe('GroqCostitaChat — VAULT_QUESTION', () => {
  it('el system prompt instruye distinguir preguntas de metodología de costeo', async () => {
    groqFetchMock.mockResolvedValueOnce(
      ok({ reply: '', actionType: 'VAULT_QUESTION', confidence: 100, proposedEntry: null, proposedAlert: null }),
    );

    const chat = new GroqCostitaChat();
    await chat.interpret('¿Qué es el ITCS?', PORTFOLIO);

    const sys = systemMessageOf(0);
    expect(sys).toContain('VAULT_QUESTION');
    expect(sys).toContain('METODOLOGÍA DE COSTEO');
  });

  it('cuando Groq devuelve VAULT_QUESTION, interpret() lo pasa sin modificar', async () => {
    groqFetchMock.mockResolvedValueOnce(
      ok({ reply: '', actionType: 'VAULT_QUESTION', confidence: 100, proposedEntry: null, proposedAlert: null }),
    );

    const chat = new GroqCostitaChat();
    const res = await chat.interpret('¿Cómo se calcula el PPP?', PORTFOLIO);

    expect(res?.actionType).toBe('VAULT_QUESTION');
    expect(res?.reply).toBe('');
  });

  it('preguntas de uso de la app siguen devolviendo INFO_ONLY (sin regresión)', async () => {
    groqFetchMock.mockResolvedValueOnce(
      ok({
        reply: 'Andá a la pestaña Clientes y hacé clic en Nueva Empresa.',
        actionType: 'INFO_ONLY',
        confidence: 100,
        proposedEntry: null,
        proposedAlert: null,
      }),
    );

    const chat = new GroqCostitaChat();
    const res = await chat.interpret('¿Cómo doy de alta una empresa?', PORTFOLIO);

    expect(res?.actionType).toBe('INFO_ONLY');
  });
});
