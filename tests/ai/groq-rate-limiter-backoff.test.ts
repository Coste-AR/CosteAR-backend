/**
 * CL-07 — El backoff del rate limiter no puede quedar sin tope.
 *
 * La auditoría del 06/08/2026 midió al proceso dormido 33, 10 y 43 minutos en
 * tres intentos distintos contra el free tier de Groq, porque el limiter
 * respetaba el `Retry-After` sin ningún límite. Un worker dormido 43 minutos con
 * documentos en cola es una caída silenciosa: nadie recibe un error.
 *
 * Estos tests fijan las dos propiedades que lo evitan:
 *   1. el backoff nunca supera MAX_BACKOFF_MS (60s), y
 *   2. cuando se recorta, queda visible para un operador.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { groqFetch, getGroqRateLimiterStats } from '@/infrastructure/ai/groq-rate-limiter.js';

const MAX_BACKOFF_MS = 60_000;

/** Respuesta 429 con el Retry-After que se quiera simular (en segundos). */
function respuesta429(retryAfterSegundos: string | null): Response {
  const headers = new Headers();
  if (retryAfterSegundos !== null) headers.set('Retry-After', retryAfterSegundos);
  return new Response('rate limited', { status: 429, headers });
}

describe('groqFetch — tope del backoff (CL-07)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * Corre groqFetch con timers falsos y devuelve cuánto durmió en cada reintento.
   * Adelantar el tiempo a mano es lo que permite testear un backoff de 43 minutos
   * sin esperar 43 minutos.
   */
  async function esperasDe(retryAfter: string | null, respuestas: Response[]) {
    const dormidas: number[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      dormidas.push(ms ?? 0);
      fn(); // resolvemos el sleep de inmediato: nos interesa el ms pedido, no esperarlo
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    for (const r of respuestas) fetchMock.mockResolvedValueOnce(r);

    await groqFetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST' });
    return dormidas;
  }

  it('recorta a 60s un Retry-After de 43 minutos — el caso que midió la auditoría', async () => {
    const cuarentaYTresMinutos = String(43 * 60); // 2580 s
    const dormidas = await esperasDe(cuarentaYTresMinutos, [
      respuesta429(cuarentaYTresMinutos),
      new Response('ok', { status: 200 }),
    ]);

    expect(dormidas).toHaveLength(1);
    expect(dormidas[0]).toBe(MAX_BACKOFF_MS);
    // La comprobación que importa de verdad: no dormir 43 minutos.
    expect(dormidas[0]).toBeLessThan(43 * 60 * 1000);
  });

  it('respeta un Retry-After corto sin tocarlo (no se vuelve más agresivo)', async () => {
    const dormidas = await esperasDe('5', [
      respuesta429('5'),
      new Response('ok', { status: 200 }),
    ]);

    expect(dormidas).toEqual([5_000]);
  });

  it('un Retry-After ilegible no produce NaN ni un reintento en caliente', async () => {
    const dormidas = await esperasDe('un-rato', [
      respuesta429('un-rato'),
      new Response('ok', { status: 200 }),
    ]);

    expect(dormidas[0]).not.toBeNaN();
    expect(dormidas[0]).toBeGreaterThan(0);
    expect(dormidas[0]).toBeLessThanOrEqual(MAX_BACKOFF_MS);
  });

  it('sin Retry-After usa el backoff exponencial de siempre', async () => {
    const dormidas = await esperasDe(null, [
      respuesta429(null),
      respuesta429(null),
      new Response('ok', { status: 200 }),
    ]);

    expect(dormidas).toEqual([1_000, 2_000]);
  });

  it('el recorte queda contabilizado y visible para un operador', async () => {
    const antes = getGroqRateLimiterStats().backoffRecortados;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await esperasDe('3000', [
      respuesta429('3000'),
      new Response('ok', { status: 200 }),
    ]);

    expect(getGroqRateLimiterStats().backoffRecortados).toBe(antes + 1);
    expect(errorSpy).toHaveBeenCalledOnce();
    // El mensaje tiene que decir que los documentos se encolan, no solo "429".
    expect(errorSpy.mock.calls[0][0]).toMatch(/cuota|encolan/i);
  });

  it('agotados los reintentos devuelve el 429 al caller en vez de seguir durmiendo', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuesta429('99999'));

    const res = await groqFetch('https://api.groq.com/x', { method: 'POST' });

    // Devolver el 429 deja que el caller reencole el trabajo. Bloquear el slot
    // esperando sería la caída silenciosa que CL-07 viene a eliminar.
    expect(res.status).toBe(429);
  });

  it('libera el slot aunque agote los reintentos (no filtra concurrencia)', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuesta429('99999'));

    await groqFetch('https://api.groq.com/x', { method: 'POST' });

    expect(getGroqRateLimiterStats().enCurso).toBe(0);
    expect(getGroqRateLimiterStats().enCola).toBe(0);
  });
});
