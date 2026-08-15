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

/**
 * Tope del backoff, en ms.
 *
 * Groq puede devolver un `Retry-After` de varios minutos cuando se agota la
 * cuota del free tier. Respetarlo sin tope deja al worker dormido: la auditoría
 * del 06/08/2026 lo midió durmiendo 33, 10 y 43 minutos en tres intentos, y por
 * eso la corrida de producción nunca pudo completarse.
 *
 * Un worker dormido 43 minutos con documentos en cola es una caída silenciosa:
 * nadie recibe un error, simplemente no pasa nada. Preferimos devolver el 429 al
 * caller —que sabe reencolar el trabajo— antes que bloquear el slot.
 */
const MAX_BACKOFF_MS = 60_000;

/**
 * Cuántas veces se recortó el backoff desde que arrancó el proceso.
 *
 * Es la señal de que la cuota de Groq está apretando y los documentos se están
 * amontonando. Se expone para que el health check y el panel de operación
 * puedan mostrarla: sin esto, "el clasificador está lento" es indistinguible de
 * "el clasificador está caído".
 */
let backoffRecortados = 0;

export function getGroqRateLimiterStats(): {
  backoffRecortados: number;
  enCurso: number;
  enCola: number;
} {
  return {
    backoffRecortados,
    enCurso: activeRequests,
    enCola: waitQueue.length,
  };
}

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

      // Leer Retry-After si Groq lo provee, si no usar backoff exponencial.
      const retryAfter = res.headers.get('Retry-After');
      const pedido = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : BASE_DELAY_MS * 2 ** (attempt - 1);

      // Un Retry-After ilegible (no numérico) no debe convertirse en NaN: si
      // NaN llegara al setTimeout, el timer dispararía inmediatamente y haría
      // un reintento en caliente contra un servicio que ya nos está frenando.
      const pedidoValido = Number.isFinite(pedido) && pedido > 0
        ? pedido
        : BASE_DELAY_MS * 2 ** (attempt - 1);

      const delayMs = Math.min(pedidoValido, MAX_BACKOFF_MS);

      if (delayMs < pedidoValido) {
        backoffRecortados++;
        // Nivel error, no warn: que Groq pida esperar más de un minuto significa
        // que la cuota está agotada y los documentos se están acumulando. Es
        // accionable (subir el plan, bajar el volumen) y tiene que verse.
        console.error(
          `[groq-rate-limiter] Groq pidió esperar ${Math.round(pedidoValido / 1000)}s; ` +
          `se recortó a ${MAX_BACKOFF_MS / 1000}s. La cuota está agotada y los documentos ` +
          `se están encolando (recortes acumulados: ${backoffRecortados}, en cola: ${waitQueue.length}).`,
        );
      } else {
        console.warn(`[groq-rate-limiter] 429 recibido. Reintento ${attempt}/${MAX_RETRIES} en ${delayMs}ms`);
      }

      await new Promise((r) => setTimeout(r, delayMs));
    }

    // Nunca debería llegar acá, pero TypeScript lo requiere
    throw new Error('groqFetch: max retries exceeded');
  } finally {
    releaseSlot();
  }
}
