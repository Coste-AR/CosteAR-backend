/**
 * Rate limiter para llamadas a la API de Groq.
 *
 * Groq Free Tier: ~30 req/min, pero en producción podemos tener varios
 * operadores subiendo documentos simultáneamente.
 *
 * Estrategia:
 * - Semáforo: máximo MAX_CONCURRENT llamadas simultáneas (evita ráfagas)
 * - Retry automático con backoff exponencial en 429 (rate limit de Groq)
 * - Máximo MAX_RETRIES intentos antes de rendir
 */

const MAX_CONCURRENT = 3;
const MAX_RETRIES    = 3;
const BASE_DELAY_MS  = 1000; // 1s → 2s → 4s

let activeRequests = 0;
const waitQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeRequests < MAX_CONCURRENT) {
      activeRequests++;
      resolve();
    } else {
      waitQueue.push(() => {
        activeRequests++;
        resolve();
      });
    }
  });
}

function releaseSlot(): void {
  activeRequests--;
  const next = waitQueue.shift();
  if (next) next();
}

/**
 * Ejecuta un fetch a Groq con rate limiting y retry automático.
 * - Espera si hay MAX_CONCURRENT llamadas activas
 * - En 429: espera Retry-After header (o backoff exponencial) y reintenta
 * - En otros errores: propaga inmediatamente
 */
export async function groqFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  await acquireSlot();

  let attempt = 0;
  try {
    while (attempt <= MAX_RETRIES) {
      const res = await fetch(url, options);

      if (res.status !== 429) {
        return res; // éxito o error no-retriable
      }

      attempt++;
      if (attempt > MAX_RETRIES) {
        return res; // devolver el 429 para que el caller lo maneje
      }

      // Leer Retry-After si Groq lo provee, si no usar backoff exponencial
      const retryAfter = res.headers.get('Retry-After');
      const delayMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : BASE_DELAY_MS * 2 ** (attempt - 1);

      console.warn(`[groq-rate-limiter] 429 recibido. Reintento ${attempt}/${MAX_RETRIES} en ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    // Nunca debería llegar acá, pero TypeScript lo requiere
    throw new Error('groqFetch: max retries exceeded');
  } finally {
    releaseSlot();
  }
}
