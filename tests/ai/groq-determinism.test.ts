/**
 * Muestreo determinista en TODOS los call sites de Groq.
 *
 * EL DEFECTO MEDIDO: el clasificador pedía `temperature: 0.05` y no mandaba
 * `seed`. Dos corridas del mismo corpus, sin un solo cambio de código, dieron
 * 61,1 % y 66,7 % de accuracy. Con esa varianza no se puede medir si una
 * corrección mejora algo — la diferencia entre dos versiones queda tapada por el
 * ruido del muestreo — y, del lado del cliente, el mismo comprobante subido dos
 * veces podía terminar en dos secciones de costo distintas.
 *
 * Este archivo no puede probar que Groq devuelva lo mismo (eso depende del
 * proveedor y `seed` es best-effort), pero sí lo único que está de nuestro lado:
 * que TODAS las llamadas SALGAN con `temperature: 0` y con el mismo seed. Es un
 * guard de regresión — el defecto original fue exactamente esto, un parámetro
 * suelto en el body de un call site.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { groqFetchMock } = vi.hoisted(() => ({ groqFetchMock: vi.fn() }));

vi.mock('@/infrastructure/ai/groq-rate-limiter.js', () => ({
  groqFetch: groqFetchMock,
}));

vi.mock('@/infrastructure/config/env.js', () => ({
  getEnv: () => ({ GROQ_API_KEY: 'test-key-abcdefghij' }),
}));

const { redisMock } = vi.hoisted(() => ({
  redisMock: { status: 'end', get: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));

vi.mock('@/infrastructure/redis/client.js', () => ({
  getRedisClient: () => redisMock,
}));

import { GroqService } from '@/infrastructure/ai/groq-service.js';
import { GroqCostitaChat } from '@/infrastructure/ai/groq-costista-chat.js';
import { DETERMINISTIC_SEED } from '@/infrastructure/ai/groq-client.js';

function ok(content: unknown) {
  const body = typeof content === 'string' ? content : JSON.stringify(content);
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: body } }] }),
    text: async () => body,
  };
}

/** El body JSON que efectivamente se le mandó a Groq en la N-ésima llamada. */
function bodyOf(callIndex: number): { temperature?: number; seed?: number } {
  const init = groqFetchMock.mock.calls[callIndex][1] as { body: string };
  return JSON.parse(init.body) as { temperature?: number; seed?: number };
}

const CLASIFICACION_VALIDA = {
  documentType: 'FACTURA_COMPRA',
  costSection: 'MATERIA_PRIMA',
  confidence: 90,
  reasoning: 'compra de insumos',
};

const ANALISIS_VALIDO = {
  documentType: 'factura_compra',
  quality: 'legible',
  qualityNote: null,
  costSection: 'MATERIA_PRIMA',
  message: 'ok',
};

const CHAT_VALIDO = {
  reply: 'Andá a la pestaña Clientes.',
  actionType: 'INFO_ONLY',
  confidence: 90,
  proposedEntry: null,
  proposedAlert: null,
};

beforeEach(() => {
  groqFetchMock.mockReset();
  redisMock.status = 'end';
});

describe('todas las llamadas a Groq piden muestreo determinista', () => {
  it('classifyDocument (Layer 5) — era `temperature: 0.05` y sin seed', async () => {
    groqFetchMock.mockResolvedValueOnce(ok(CLASIFICACION_VALIDA));

    await new GroqService().classifyDocument({
      text: 'Factura de compra de maíz',
      accumulatedPts: 40,
      foundSignalLabels: [],
      suggestedType: 'FACTURA_COMPRA',
    });

    expect(bodyOf(0).temperature).toBe(0);
    expect(bodyOf(0).seed).toBe(DETERMINISTIC_SEED);
  });

  it('el reintento guiado del clasificador sale con el MISMO seed', async () => {
    // Si el reintento sorteara distinto, la respuesta final volvería a depender
    // del azar justo en el camino que ya había fallado una vez.
    groqFetchMock
      .mockResolvedValueOnce(ok({ ...CLASIFICACION_VALIDA, costSection: 'INVENTADA' }))
      .mockResolvedValueOnce(ok(CLASIFICACION_VALIDA));

    await new GroqService().classifyDocument({
      text: 'Factura de compra de maíz',
      accumulatedPts: 40,
      foundSignalLabels: [],
      suggestedType: 'FACTURA_COMPRA',
    });

    expect(groqFetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(1).temperature).toBe(0);
    expect(bodyOf(1).seed).toBe(DETERMINISTIC_SEED);
  });

  it('analyzeDocument — extrae importes, es donde menos se tolera el azar', async () => {
    groqFetchMock.mockResolvedValueOnce(ok(ANALISIS_VALIDO));

    await new GroqService().analyzeDocument({ text: 'Factura A por 100.000' });

    expect(bodyOf(0).temperature).toBe(0);
    expect(bodyOf(0).seed).toBe(DETERMINISTIC_SEED);
  });

  it('el chat del costista — su respuesta se cachea 24h, el sorteo quedaba congelado', async () => {
    groqFetchMock.mockResolvedValueOnce(ok(CHAT_VALIDO));

    await new GroqCostitaChat().interpret('¿Cómo doy de alta una empresa?', {
      companies: [], pendingCount: 0, activeAlerts: 0,
    });

    expect(bodyOf(0).temperature).toBe(0);
    expect(bodyOf(0).seed).toBe(DETERMINISTIC_SEED);
  });

  it('completeJSON — el helper que usan advisor, nightly-learning y vault-query', async () => {
    groqFetchMock.mockResolvedValueOnce(ok({ answer: 'ok' }));

    await new GroqService().completeJSON('system', 'user');

    expect(bodyOf(0).temperature).toBe(0);
    expect(bodyOf(0).seed).toBe(DETERMINISTIC_SEED);
  });
});
