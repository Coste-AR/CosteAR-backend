import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { EMBEDDING_MODEL } from '../../infrastructure/ai/voyage-service.js';
import { getLLMService, type LLMService } from '../../infrastructure/ai/llm-service.js';
import { VaultRetriever, RETRIEVER_VERSION } from './vault-retriever.js';
import { UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';

const answerSchema = z.object({
  answer: z.string(),
  citations: z.array(z.string()),
  answeredFromContext: z.boolean(),
});

/** Techo defensivo de caracteres del contexto armado para el prompt del RAG. */
const MAX_CONTEXT_CHARS = 12_000;

/**
 * Debajo de esta distancia coseno consideramos que hubo un match semántico
 * directo (confianza alta). Si ningún chunk lo alcanza —vino todo por full-text
 * o por vecinos lejanos— la confianza no puede ser HIGH.
 */
const CLOSE_VECTOR_DISTANCE = 0.65;

export interface VaultQueryResult {
  answer: string;
  citations: string[];
  confidence: 'HIGH' | 'LOW' | 'NONE';
  fallbackMessage?: string;
  /** id de la fila de `vault_query_log` — para asociar el feedback 👍/👎. */
  queryLogId?: string;
}

export interface VaultQueryOptions {
  maxResults?: number;
  userId?: string | null;
}

interface RetrievedChunkLite {
  sourceFile: string;
  headingPath: string | null;
  distance: number | null;
  rrfScore: number;
  rerankScore: number | null;
}

const QA_SYSTEM_PROMPT = `Sos el consejero experto de CosteAR, respondiendo exclusivamente basándote en la metodología de la cátedra de costos.
Tenés que responder la pregunta del usuario usando ÚNICAMENTE el contexto provisto abajo, extraído de nuestra Bóveda de Conocimiento.

REGLAS ESTRICTAS DE CERO ALUCINACIONES:
1. Si el contexto NO contiene la respuesta, debés negarte educadamente a responder. No uses tus conocimientos previos, no adivines, no asumas.
2. Basate literal o conceptualmente solo en el texto del contexto provisto.
3. El contexto viene dividido en "Chunks" o fragmentos, cada uno con una cita en formato "sourceFile (headingPath)".
4. Todas las afirmaciones importantes que hagas DEBEN estar respaldadas por al menos uno de los fragmentos provistos.
5. Devolvé SIEMPRE un JSON válido con esta estructura:
{
  "answer": "La respuesta redactada clara y profesional, o tu negativa si no está en el contexto.",
  "citations": ["Costeo/Metodo-FIFO.md", "Costeo/ITCS.md"], // las rutas completas de los archivos usados
  "answeredFromContext": true // false si te tuviste que negar porque no estaba en el contexto
}

Contexto extraído de la Bóveda:
`;

export class VaultQueryService {
  private llm: LLMService | null;

  constructor(
    private readonly retriever: VaultRetriever = new VaultRetriever(),
    llm?: LLMService,
  ) {
    // Perezoso: `getLLMService` evalúa `getEnv()`; el servicio se instancia en
    // contextos donde el entorno completo puede no estar cargado.
    this.llm = llm ?? null;
  }

  private getLlm(): LLMService {
    if (!this.llm) this.llm = getLLMService('vault_query');
    return this.llm;
  }

  /**
   * Escribe una fila en `vault_query_log`. **Nunca puede romper la respuesta al
   * usuario**: cualquier error de la escritura se loguea y se devuelve `undefined`.
   */
  private async logQuery(row: {
    question: string;
    chunks: RetrievedChunkLite[];
    confidence: VaultQueryResult['confidence'];
    answeredFromContext: boolean;
    latencyMs: number;
    userId?: string | null;
  }): Promise<string | undefined> {
    try {
      const created = await prisma.vaultQueryLog.create({
        data: {
          question: row.question,
          retrieverVersion: RETRIEVER_VERSION,
          embeddingModel: EMBEDDING_MODEL,
          llmModel: this.getLlm().modelId,
          chunksReturned: row.chunks as unknown as Prisma.InputJsonValue,
          confidence: row.confidence,
          answeredFromContext: row.answeredFromContext,
          latencyMs: row.latencyMs,
          userId: row.userId ?? null,
        },
        select: { id: true },
      });
      return created.id;
    } catch (err) {
      console.error('[vault-query] no se pudo registrar la query en vault_query_log:', err);
      return undefined;
    }
  }

  async query(question: string, opts: VaultQueryOptions = {}): Promise<VaultQueryResult> {
    const startedAt = Date.now();
    const maxResults = opts.maxResults ?? 5;

    if (!this.getLlm().isConfigured) {
      throw new UnprocessableEntityError('El servicio de IA o embeddings no está configurado (faltan API keys).');
    }

    // Recuperación híbrida (vector + full-text, fusionada con RRF). El retriever
    // lanza UnprocessableEntityError si no puede generar el embedding.
    const chunks = await this.retriever.retrieve(question, { limit: maxResults });

    // La confianza no puede ser HIGH si el resultado no se apoya en al menos un
    // match semántico directo (vino todo por full-text o por vecinos lejanos).
    const hadCloseVectorMatch = chunks.some(
      (c) => c.distance !== null && c.distance < CLOSE_VECTOR_DISTANCE,
    );
    const usedWidenedSearch = chunks.length > 0 && !hadCloseVectorMatch;

    const chunksLite: RetrievedChunkLite[] = chunks.map((c) => ({
      sourceFile: c.sourceFile,
      headingPath: c.headingPath,
      distance: c.distance,
      rrfScore: c.rrfScore,
      rerankScore: c.rerankScore,
    }));

    if (chunks.length === 0) {
      // Registrar la falla en el Nightly Pipeline
      await prisma.dailySignal.create({
        data: {
          type: 'RAG_MISS',
          source: 'COSTISTA_CHAT',
          content: question,
          context: { reason: 'Hybrid retrieval returned no chunks' }
        }
      });

      const queryLogId = await this.logQuery({
        question,
        chunks: [],
        confidence: 'NONE',
        answeredFromContext: false,
        latencyMs: Date.now() - startedAt,
        userId: opts.userId,
      });

      // Short-circuit: no se encontró contexto suficientemente similar.
      return {
        answer: 'No encontré información relevante en la bóveda de costeo para responder esta pregunta.',
        citations: [],
        confidence: 'NONE',
        fallbackMessage: 'Intentá usar palabras clave más específicas que coincidan con la terminología de la cátedra.',
        queryLogId,
      };
    }

    // 3. Armado del prompt con el contexto
    let contextStr = '';
    let i = 1;
    for (const c of chunks) {
      const heading = c.headingPath ? ` > ${c.headingPath}` : '';
      contextStr += `[Chunk ${i}] Fuente: ${c.sourceFile}${heading}\n${c.content}\n\n`;
      i++;
    }

    if (contextStr.length > MAX_CONTEXT_CHARS) {
      console.warn(`[vault-query] Contexto truncado de ${contextStr.length} a ${MAX_CONTEXT_CHARS} caracteres.`);
      contextStr = contextStr.slice(0, MAX_CONTEXT_CHARS) + '\n\n[...contexto truncado por límite de tamaño...]';
    }

    const userPrompt = `PREGUNTA DEL USUARIO:\n"${question}"\n\nCONTEXTO:\n${contextStr}`;

    // 4. Generación de respuesta (LLM: Claude por default — ver getLLMService).
    // El system prompt anti-alucinación va con cacheSystem: se cachea y se
    // reusa; lo que varía es el contexto recuperado.
    const result = await this.getLlm().completeJSON(QA_SYSTEM_PROMPT, userPrompt, {
      cacheSystem: true,
      schema: answerSchema,
    });

    if (!result) {
      await this.logQuery({
        question,
        chunks: chunksLite,
        confidence: 'NONE',
        answeredFromContext: false,
        latencyMs: Date.now() - startedAt,
        userId: opts.userId,
      });
      throw new UnprocessableEntityError('Error al contactar al modelo generador.');
    }

    // Registrar RAG_MISS si el modelo dice que no está en el contexto
    if (!result.answeredFromContext) {
      await prisma.dailySignal.create({
        data: {
          type: 'RAG_MISS',
          source: 'COSTISTA_CHAT',
          content: question,
          context: { reason: 'LLM generated refusal (answeredFromContext=false)' }
        }
      });
    }

    // Las citas las decide el LLM, pero no confiamos en su palabra: filtramos a solo
    // los sourceFile que REALMENTE estaban en el contexto que le pasamos. Sin esto, el
    // modelo podría "citar" un archivo que nunca vio (alucinación de fuente), lo cual
    // rompe la garantía de "toda afirmación está respaldada por un fragmento real".
    const actualSourceFiles = new Set(chunks.map((c) => c.sourceFile));
    const verifiedCitations = result.answeredFromContext
      ? Array.from(new Set(result.citations)).filter((c) => actualSourceFiles.has(c))
      : [];

    // Si el match sólo apareció al ampliar el umbral, la confianza no puede ser HIGH
    // aunque el LLM haya podido responder con esos chunks.
    const confidence: VaultQueryResult['confidence'] = result.answeredFromContext
      ? (usedWidenedSearch ? 'LOW' : 'HIGH')
      : 'LOW';

    const queryLogId = await this.logQuery({
      question,
      chunks: chunksLite,
      confidence,
      answeredFromContext: result.answeredFromContext,
      latencyMs: Date.now() - startedAt,
      userId: opts.userId,
    });

    return {
      answer: result.answer,
      citations: verifiedCitations,
      confidence,
      queryLogId,
    };
  }
}
