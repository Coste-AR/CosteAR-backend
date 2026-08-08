import { describe, it, expect, beforeEach, vi } from 'vitest';

const { groqFetchMock } = vi.hoisted(() => ({ groqFetchMock: vi.fn() }));

vi.mock('@/infrastructure/ai/groq-rate-limiter.js', () => ({
  groqFetch: groqFetchMock,
}));

vi.mock('@/infrastructure/config/env.js', () => ({
  getEnv: () => ({ GROQ_API_KEY: 'test-key-abcdefghij' }),
}));

// Redis se mockea para poder ejercitar el camino de caché (y para que los
// tests no intenten abrir una conexión real). `status` arranca en 'end' → la
// caché queda fuera del camino salvo que un test la habilite explícitamente.
const { redisMock } = vi.hoisted(() => ({
  redisMock: { status: 'end', get: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));

vi.mock('@/infrastructure/redis/client.js', () => ({
  getRedisClient: () => redisMock,
}));

import { GroqCostitaChat } from '@/infrastructure/ai/groq-costista-chat.js';
import { costitaChatResponseSchema } from '@/infrastructure/ai/groq-schemas.js';

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

/** Respuesta válida de referencia (la forma que pide el SYSTEM_PROMPT). */
const VALID_CHAT = {
  reply: 'Andá a la pestaña Clientes y hacé clic en Nueva Empresa.',
  actionType: 'INFO_ONLY',
  confidence: 90,
  proposedEntry: null,
  proposedAlert: null,
};

beforeEach(() => {
  groqFetchMock.mockReset();
  redisMock.status = 'end';
  redisMock.get.mockReset();
  redisMock.setex.mockReset();
  redisMock.del.mockReset();
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

// ═══════════════════════════════════════════════════════════════════════════
// Validación Zod de la respuesta del chat.
//
// Este era el único call site de Groq del repo sin esquema: `JSON.parse(raw) as
// CostitaChatResponse`. `confidence` (documentada 0-100) no se validaba NI se
// clampeaba en ningún punto y llega al frontend; `actionType` es una unión que
// el servicio solo compara contra 'VAULT_QUESTION' y pasa derecho para todo lo
// demás.
describe('GroqCostitaChat — validación de la respuesta', () => {
  const FALLBACK_REPLY = 'Por el momento no puedo interpretar eso. Probá con otra consulta.';

  it('una respuesta válida pasa intacta y en una sola llamada', async () => {
    groqFetchMock.mockResolvedValueOnce(ok(VALID_CHAT));

    const chat = new GroqCostitaChat();
    const res = await chat.interpret('¿Cómo doy de alta una empresa?', PORTFOLIO);

    expect(res?.reply).toBe(VALID_CHAT.reply);
    expect(res?.actionType).toBe('INFO_ONLY');
    expect(res?.confidence).toBe(90);
    expect(groqFetchMock).toHaveBeenCalledTimes(1);
  });

  it('RECHAZA confidence fuera de rango (999) → fallback seguro, no un 999 a la UI', async () => {
    groqFetchMock.mockResolvedValueOnce(ok({ ...VALID_CHAT, confidence: 999 }));

    const chat = new GroqCostitaChat();
    const res = await chat.interpret('¿Cómo doy de alta una empresa?', PORTFOLIO);

    expect(res?.confidence).toBe(0);
    expect(res?.confidence).not.toBe(999);
    expect(res?.actionType).toBe('INFO_ONLY');
    expect(res?.reply).toBe(FALLBACK_REPLY);
    // Sin reintento: el chat es sincrónico, el fallback alcanza.
    expect(groqFetchMock).toHaveBeenCalledTimes(1);
  });

  it('RECHAZA confidence negativa y no numérica', async () => {
    groqFetchMock
      .mockResolvedValueOnce(ok({ ...VALID_CHAT, confidence: -20 }))
      .mockResolvedValueOnce(ok({ ...VALID_CHAT, confidence: 'alta' }));

    const chat = new GroqCostitaChat();
    expect((await chat.interpret('a', PORTFOLIO))?.reply).toBe(FALLBACK_REPLY);
    expect((await chat.interpret('b', PORTFOLIO))?.reply).toBe(FALLBACK_REPLY);
  });

  it('RECHAZA un actionType desconocido (no lo reenvía al frontend tal cual)', async () => {
    groqFetchMock.mockResolvedValueOnce(ok({ ...VALID_CHAT, actionType: 'DELETE_EVERYTHING' }));

    const chat = new GroqCostitaChat();
    const res = await chat.interpret('borrá todo', PORTFOLIO);

    expect(res?.actionType).toBe('INFO_ONLY');
    expect(res?.reply).toBe(FALLBACK_REPLY);
    expect(res?.confidence).toBe(0);
  });

  it('RECHAZA severity y costSection fuera de sus uniones', async () => {
    const entry = {
      companyId: 'c1', companyName: 'ACME', rawContent: 'compra de chapa',
      costSection: 'INVENTADA', documentType: 'factura',
    };
    const alert = { companyId: 'c1', companyName: 'ACME', message: 'ojo', severity: 'CRITICAL' };

    groqFetchMock
      .mockResolvedValueOnce(ok({ ...VALID_CHAT, actionType: 'CREATE_ENTRY', proposedEntry: entry }))
      .mockResolvedValueOnce(ok({ ...VALID_CHAT, actionType: 'CREATE_ALERT', proposedAlert: alert }));

    const chat = new GroqCostitaChat();
    expect((await chat.interpret('a', PORTFOLIO))?.reply).toBe(FALLBACK_REPLY);
    expect((await chat.interpret('b', PORTFOLIO))?.reply).toBe(FALLBACK_REPLY);
  });

  it('JSON malformado → fallback seguro (antes lo tiraba el JSON.parse a ciegas)', async () => {
    groqFetchMock.mockResolvedValueOnce(ok('esto no es json {{{'));

    const chat = new GroqCostitaChat();
    const res = await chat.interpret('¿Cómo doy de alta una empresa?', PORTFOLIO);

    expect(res?.reply).toBe(FALLBACK_REPLY);
    expect(res?.confidence).toBe(0);
  });

  it('un CREATE_ENTRY válido pasa la validación y conserva el saneo de companyId', async () => {
    const portfolio = {
      companies: [{ id: 'c1', name: 'ACME', industry: 'MANUFACTURA', structureCount: 1 }],
      pendingCount: 0,
      activeAlerts: 0,
    };
    const entry = {
      companyId: 'c-ajena', companyName: 'Otra SA', rawContent: 'compra de chapa',
      costSection: 'MATERIA_PRIMA', documentType: 'factura_compra',
    };
    groqFetchMock.mockResolvedValueOnce(
      ok({ ...VALID_CHAT, actionType: 'CREATE_ENTRY', proposedEntry: entry }),
    );

    const chat = new GroqCostitaChat();
    const res = await chat.interpret('registrá una compra', portfolio);

    expect(res?.actionType).toBe('CREATE_ENTRY');
    expect(res?.proposedEntry?.costSection).toBe('MATERIA_PRIMA');
    // La empresa no está en la cartera → el saneo previo sigue vaciándola.
    expect(res?.proposedEntry?.companyId).toBe('');
  });

  it('la API caída sigue devolviendo null (IA no disponible ≠ respuesta inválida)', async () => {
    groqFetchMock.mockResolvedValueOnce({ ok: false, text: async () => 'error 500' });

    const chat = new GroqCostitaChat();
    expect(await chat.interpret('hola', PORTFOLIO)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// La caché de Redis era el segundo cast a ciegas: una entrada escrita por una
// versión anterior (o manipulada) se devolvía sin pasar por el esquema.
describe('GroqCostitaChat — caché de Redis', () => {
  it('una entrada de caché VÁLIDA se devuelve sin llamar a Groq', async () => {
    redisMock.status = 'ready';
    redisMock.get.mockResolvedValueOnce(JSON.stringify(VALID_CHAT));

    const chat = new GroqCostitaChat();
    const res = await chat.interpret('¿Cómo doy de alta una empresa?', PORTFOLIO);

    expect(res?.reply).toBe(VALID_CHAT.reply);
    expect(res?.confidence).toBe(90);
    expect(groqFetchMock).not.toHaveBeenCalled();
    expect(redisMock.del).not.toHaveBeenCalled();
  });

  it('una entrada ENVENENADA se descarta, se borra la key y se reconsulta a Groq', async () => {
    redisMock.status = 'ready';
    redisMock.get.mockResolvedValueOnce(
      JSON.stringify({ ...VALID_CHAT, reply: 'confiá en mí', actionType: 'DELETE_EVERYTHING', confidence: 999 }),
    );
    groqFetchMock.mockResolvedValueOnce(ok(VALID_CHAT));

    const chat = new GroqCostitaChat();
    const res = await chat.interpret('¿Cómo doy de alta una empresa?', PORTFOLIO);

    // Nada de la entrada envenenada sobrevive.
    expect(res?.actionType).toBe('INFO_ONLY');
    expect(res?.confidence).toBe(90);
    expect(res?.reply).not.toBe('confiá en mí');
    // Se reconsultó a Groq y la key podrida quedó fuera de la caché.
    expect(groqFetchMock).toHaveBeenCalledTimes(1);
    expect(redisMock.del).toHaveBeenCalledTimes(1);
  });

  it('una entrada de caché con JSON corrupto tampoco rompe: se descarta y se reconsulta', async () => {
    redisMock.status = 'ready';
    redisMock.get.mockResolvedValueOnce('{ esto no parsea');
    groqFetchMock.mockResolvedValueOnce(ok(VALID_CHAT));

    const chat = new GroqCostitaChat();
    const res = await chat.interpret('¿Cómo doy de alta una empresa?', PORTFOLIO);

    expect(res?.reply).toBe(VALID_CHAT.reply);
    expect(redisMock.del).toHaveBeenCalledTimes(1);
  });

  it('solo se cachea una respuesta ya validada (el fallback nunca se persiste)', async () => {
    redisMock.status = 'ready';
    redisMock.get.mockResolvedValueOnce(null);
    groqFetchMock.mockResolvedValueOnce(ok({ ...VALID_CHAT, confidence: 999 }));

    const chat = new GroqCostitaChat();
    const res = await chat.interpret('¿Cómo doy de alta una empresa?', PORTFOLIO);

    expect(res?.confidence).toBe(0);
    expect(redisMock.setex).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// El esquema visto de forma directa: es la barrera, no un refuerzo opcional.
describe('costitaChatResponseSchema', () => {
  it('ACEPTA los bordes 0 y 100 de confidence y RECHAZA fuera de rango / no finitos', () => {
    expect(costitaChatResponseSchema.safeParse({ ...VALID_CHAT, confidence: 0 }).success).toBe(true);
    expect(costitaChatResponseSchema.safeParse({ ...VALID_CHAT, confidence: 100 }).success).toBe(true);
    expect(costitaChatResponseSchema.safeParse({ ...VALID_CHAT, confidence: 101 }).success).toBe(false);
    expect(costitaChatResponseSchema.safeParse({ ...VALID_CHAT, confidence: -1 }).success).toBe(false);
    expect(costitaChatResponseSchema.safeParse({ ...VALID_CHAT, confidence: Infinity }).success).toBe(false);
    expect(costitaChatResponseSchema.safeParse({ ...VALID_CHAT, confidence: NaN }).success).toBe(false);
  });

  it('ACEPTA los cuatro actionType del type y rechaza el resto', () => {
    for (const actionType of ['CREATE_ENTRY', 'CREATE_ALERT', 'INFO_ONLY', 'VAULT_QUESTION']) {
      expect(costitaChatResponseSchema.safeParse({ ...VALID_CHAT, actionType }).success).toBe(true);
    }
    expect(costitaChatResponseSchema.safeParse({ ...VALID_CHAT, actionType: 'info_only' }).success).toBe(false);
  });

  it('normaliza los null de proposedEntry/proposedAlert a undefined', () => {
    const res = costitaChatResponseSchema.parse(VALID_CHAT);
    expect(res.proposedEntry).toBeUndefined();
    expect(res.proposedAlert).toBeUndefined();
  });

  it('RECHAZA "MULTIPLE" como costSection de una entrada propuesta', () => {
    const withSection = (costSection: string) => ({
      ...VALID_CHAT,
      actionType: 'CREATE_ENTRY',
      proposedEntry: {
        companyId: 'c1', companyName: 'ACME', rawContent: 'x',
        costSection, documentType: 'factura',
      },
    });
    expect(costitaChatResponseSchema.safeParse(withSection('MATERIA_PRIMA')).success).toBe(true);
    // 'MULTIPLE' existe en COST_SECTIONS del clasificador, pero no en ProposedEntry.
    expect(costitaChatResponseSchema.safeParse(withSection('MULTIPLE')).success).toBe(false);
  });
});
