import { Prisma } from '@prisma/client';
import { VoyageService, EMBEDDING_MODEL } from '../../infrastructure/ai/voyage-service.js';
import { GroqService } from '../../infrastructure/ai/groq-service.js';
import { PrismaVaultChunkRepository } from '../vault-indexer/vault-chunk-repository.js';
import { UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';

/** Techo defensivo de caracteres del contexto armado para el prompt del RAG. */
const MAX_CONTEXT_CHARS = 12_000;

/** Versión del retriever que respondió. F1-07 la sube cuando entra el híbrido. */
const RETRIEVER_VERSION = 'v1-cosine';

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
  distance: number;
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
  constructor(
    private readonly embedder: VoyageService = new VoyageService(),
    private readonly ai: GroqService = new GroqService(),
    private readonly repo: PrismaVaultChunkRepository = new PrismaVaultChunkRepository(),
  ) {}

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
          llmModel: 'groq', // F1-10 lo hace real
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

    if (!this.embedder.isConfigured || !this.ai.isConfigured) {
      throw new UnprocessableEntityError('El servicio de IA o embeddings no está configurado (faltan API keys).');
    }

    // 1. Convertir pregunta a vector
    const embeddings = await this.embedder.embed([question], 'query');
    if (!embeddings || embeddings.length === 0 || !embeddings[0]) {
      throw new UnprocessableEntityError('No se pudo generar el embedding para la consulta.');
    }
    const queryVector = embeddings[0];

    // 2. Búsqueda semántica en Postgres (distancia coseno < 0.65)
    let chunks = await this.repo.searchChunks(queryVector, maxResults, 0.65);

    // Preguntas cortas o con siglas (ej. "¿Qué es el ITCS?") suelen quedar justo
    // por fuera de 0.65 aunque el término SÍ esté en la bóveda. Antes de rendirnos,
    // reintentamos con un umbral más amplio. Los chunks siguen siendo reales — el LLM
    // sigue restringido a responder solo desde ellos — pero marcamos la confianza como
    // LOW porque el match es menos preciso.
    let usedWidenedSearch = false;
    if (chunks.length === 0) {
      chunks = await this.repo.searchChunks(queryVector, maxResults, 0.85);
      usedWidenedSearch = chunks.length > 0;
    }

    const chunksLite: RetrievedChunkLite[] = chunks.map((c) => ({
      sourceFile: c.sourceFile,
      headingPath: c.headingPath,
      distance: c.distance,
    }));

    if (chunks.length === 0) {
      // Registrar la falla en el Nightly Pipeline
      await prisma.dailySignal.create({
        data: {
          type: 'RAG_MISS',
          source: 'COSTISTA_CHAT',
          content: question,
          context: { reason: 'No chunks found above similarity threshold' }
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

    // 4. Generación de respuesta (Groq)
    const result = await this.ai.completeJSON<{ answer: string; citations: string[]; answeredFromContext: boolean }>(
      QA_SYSTEM_PROMPT,
      userPrompt
    );

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
