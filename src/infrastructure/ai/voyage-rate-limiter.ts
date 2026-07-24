/**
 * Rate limiter para llamadas a la API de Voyage AI.
 *
 * Sin método de pago cargado en la cuenta, Voyage aplica un límite reducido
 * de 3 req/min — el indexador de la bóveda hace una llamada por nota
 * procesada, así que con más de un puñado de notas se pisa ese límite
 * enseguida. Voyage no manda header `Retry-After` en el 429, así que
 * esperamos un intervalo fijo mayor a la ventana de 1 minuto / 3 requests
 * (~20s) antes de reintentar.
 *
 * El indexador ya llama secuencialmente (un archivo por vez), así que acá
 * no hace falta semáforo de concurrencia — solo retry con espera en 429.
 */

const MAX_RETRIES = 25;
const RETRY_DELAY_MS = 21_000; // > 20s (ventana de 3 req/min sin billing)

/**
 * Ejecuta un fetch a Voyage con retry automático en 429.
 * En otros errores (4xx/5xx no relacionados a rate limit) propaga
 * inmediatamente para que el caller lo maneje.
 */
export async function voyageFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    const res = await fetch(url, options);

    if (res.status !== 429) {
      return res; // éxito o error no-retriable
    }

    attempt++;
    if (attempt > MAX_RETRIES) {
      return res; // devolver el 429 para que el caller lo maneje
    }

    const retryAfter = res.headers.get('Retry-After');
    const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : RETRY_DELAY_MS;

    console.warn(`[voyage-rate-limiter] 429 recibido. Reintento ${attempt}/${MAX_RETRIES} en ${delayMs}ms`);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  // Nunca debería llegar acá, pero TypeScript lo requiere
  throw new Error('voyageFetch: max retries exceeded');
}
