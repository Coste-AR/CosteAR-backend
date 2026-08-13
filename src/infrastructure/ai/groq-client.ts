import { getEnv } from '../config/env.js';
import { groqFetch } from './groq-rate-limiter.js';

export const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
export const TEXT_MODEL   = 'llama-3.3-70b-versatile';

/**
 * Muestreo determinista para TODAS las llamadas de análisis a Groq.
 *
 * POR QUÉ (medido). El clasificador corría con `temperature: 0.05` y sin `seed`.
 * Dos corridas del MISMO corpus, sin tocar una línea de código, dieron 61,1% y
 * 66,7% de accuracy. Con esa varianza ninguna medición de mejora es confiable:
 * un cambio que suba 3 puntos es indistinguible del ruido del muestreo, así que
 * no se puede saber si una corrección corrige algo. Y para el cliente es peor
 * todavía: el MISMO comprobante, mandado dos veces, podía terminar en dos
 * secciones de costo distintas.
 *
 * `temperature: 0` sola no alcanza: sigue habiendo desempates no determinísticos
 * entre tokens de igual probabilidad, y la propia doc de Groq/OpenAI trata a
 * `seed` como el pedido explícito de reproducibilidad (best-effort: puede
 * cambiar si el proveedor cambia el backend del modelo; por eso `system_fingerprint`).
 * Van juntas, y por eso viven acá y no copiadas en cada call site.
 *
 * El valor concreto es arbitrario; lo que importa es que NO cambie. Cambiarlo
 * invalida cualquier comparación contra mediciones anteriores del corpus.
 */
export const DETERMINISTIC_SEED = 20260813;

/** Cuerpo base compartido por todos los call sites que piden JSON analítico. */
export const DETERMINISTIC_SAMPLING = {
  temperature: 0,
  seed: DETERMINISTIC_SEED,
} as const;

export interface GroqResponse {
  choices: { message: { content: string } }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

import { describeZodIssues } from './groq-schemas.js';
import type { z } from 'zod';

export function tryParseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function buildRetryHint(raw: string | null, parsed: unknown, error: z.ZodError | null): string {
  if (raw === null) {
    return 'La solicitud anterior no devolvió contenido. Devolvé el JSON completo y válido.';
  }
  if (parsed === undefined) {
    return `Tu respuesta anterior NO era JSON válido (no se pudo parsear). Devolvé SOLO un objeto JSON válido, sin texto adicional ni markdown. Fragmento recibido: ${raw.slice(0, 300)}`;
  }
  if (error) {
    return describeZodIssues(error.issues);
  }
  return 'Devolvé el JSON en el formato esperado.';
}

export class GroqClient {
  private readonly apiKey: string;

  constructor() {
    this.apiKey = getEnv().GROQ_API_KEY;
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 10 && this.apiKey !== 'groq_placeholder';
  }

  async postGroqRaw(body: Record<string, unknown>): Promise<string | null> {
    const res = await groqFetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('[groq] Error de API:', await res.text());
      return null;
    }
    const data = await res.json() as GroqResponse;
    return data.choices[0]?.message.content ?? '';
  }

  async completeJSON<T>(systemPrompt: string, userPrompt: string): Promise<T | null> {
    if (!this.isConfigured) return null;
    try {
      const res = await groqFetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: TEXT_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 500,
          // Mismo criterio que el clasificador: los tres consumidores de este
          // helper (advisor, nightly-learning, vault-query) producen JSON
          // analítico que se le muestra al costista o se persiste, no prosa
          // creativa. Ver DETERMINISTIC_SEED arriba.
          ...DETERMINISTIC_SAMPLING,
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) { console.error('[groq] completeJSON error:', await res.text()); return null; }
      const data = await res.json() as GroqResponse;
      if (data.usage) {
        console.info('[groq] usage', {
          model: TEXT_MODEL,
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        });
      }
      const raw = data.choices[0]?.message.content ?? '';
      return JSON.parse(raw) as T;
    } catch (err) {
      console.error('[groq] completeJSON unexpected error:', err);
      return null;
    }
  }

  async transcribeAudio(audioBuffer: Buffer, mimeType: string, filename: string): Promise<string | null> {
    if (!this.isConfigured) return null;
    try {
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: mimeType });
      formData.append('file', blob, filename);
      formData.append('model', 'whisper-large-v3');

      // Do NOT use groqFetch (rate limiter) for this as we don't need JSON rate limiting
      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: formData
      });
      
      if (!res.ok) {
        console.error('[groq] transcribeAudio error:', await res.text());
        return null;
      }
      const data = await res.json() as { text: string };
      return data.text;
    } catch (err) {
      console.error('[groq] transcribeAudio unexpected error:', err);
      return null;
    }
  }
}
