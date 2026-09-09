import { z } from 'zod';
import { getLLMService, type LLMService } from '../../infrastructure/ai/llm-service.js';

/**
 * Contextual Retrieval (técnica de Anthropic): antes de embeber un chunk se le
 * antepone un contexto de 1-2 frases —de qué trata el documento y dónde encaja
 * el fragmento—, generado con un modelo barato (Haiku). Mejora el retrieval
 * notablemente sin cambiar el modelo de embeddings.
 *
 * El documento completo va en el `system` con `cacheSystem: true`: se cachea
 * una vez y se reusa para todos los chunks del mismo archivo. Lo único que
 * varía entre llamadas es el `user` (el chunk).
 */
const SYSTEM_PREFIX = `Sos un asistente que ayuda a indexar una bóveda de conocimiento de costeo.
Te doy un DOCUMENTO completo y, aparte, un FRAGMENTO de ese documento.
Devolvé un contexto de 1 o 2 frases que ubique el fragmento dentro del documento
(de qué trata el documento, qué parte es este fragmento), para mejorar su
recuperación en búsquedas. NO repitas el fragmento. NO agregues información que
no esté en el documento.

Respondé SIEMPRE en JSON: { "context": "..." }

DOCUMENTO:
`;

const contextSchema = z.object({ context: z.string() });

/** Techo de caracteres del documento que se manda como contexto cacheado. */
const MAX_DOC_CHARS = 20_000;

export class ContextualPrefixGenerator {
  private llm: LLMService | null;

  /**
   * `llm` se resuelve perezosamente (en el primer uso) para no evaluar
   * `getEnv()` al construir — el indexador se instancia en contextos donde el
   * entorno completo puede no estar cargado.
   */
  constructor(llm?: LLMService) {
    this.llm = llm ?? null;
  }

  private getLlm(): LLMService {
    if (!this.llm) this.llm = getLLMService('context');
    return this.llm;
  }

  get isConfigured(): boolean {
    return this.getLlm().isConfigured;
  }

  /**
   * Devuelve el contexto para un chunk, o `null` si el LLM no está disponible o
   * falla — en cuyo caso el indexador embebe el `content` pelado (degradación
   * segura).
   */
  async generate(documentText: string, chunkContent: string): Promise<string | null> {
    const llm = this.getLlm();
    if (!llm.isConfigured) return null;

    const doc = documentText.length > MAX_DOC_CHARS
      ? documentText.slice(0, MAX_DOC_CHARS) + '\n\n[...documento truncado...]'
      : documentText;

    const result = await llm.completeJSON(
      SYSTEM_PREFIX + doc,
      `FRAGMENTO:\n${chunkContent}\n\nDevolvé el contexto en JSON.`,
      { schema: contextSchema, cacheSystem: true, maxTokens: 200 },
    );

    const context = result?.context?.trim();
    return context && context.length > 0 ? context : null;
  }
}
