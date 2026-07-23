import { VoyageService } from '../../infrastructure/ai/voyage-service.js';
import { GroqService } from '../../infrastructure/ai/groq-service.js';
import { PrismaVaultChunkRepository } from '../vault-indexer/vault-chunk-repository.js';
import { UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';

export interface VaultQueryResult {
  answer: string;
  citations: string[];
  confidence: 'HIGH' | 'LOW' | 'NONE';
  fallbackMessage?: string;
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
  private readonly embedder: VoyageService;
  private readonly ai: GroqService;
  private readonly repo: PrismaVaultChunkRepository;

  constructor() {
    this.embedder = new VoyageService();
    this.ai = new GroqService();
    this.repo = new PrismaVaultChunkRepository();
  }

  async query(question: string, maxResults = 5): Promise<VaultQueryResult> {
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

      // Short-circuit: no se encontró contexto suficientemente similar.
      return {
        answer: 'No encontré información relevante en la bóveda de costeo para responder esta pregunta.',
        citations: [],
        confidence: 'NONE',
        fallbackMessage: 'Intentá usar palabras clave más específicas que coincidan con la terminología de la cátedra.'
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

    const userPrompt = `PREGUNTA DEL USUARIO:\n"${question}"\n\nCONTEXTO:\n${contextStr}`;

    // 4. Generación de respuesta (Groq)
    const result = await this.ai.completeJSON<{ answer: string; citations: string[]; answeredFromContext: boolean }>(
      QA_SYSTEM_PROMPT,
      userPrompt
    );

    if (!result) {
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
    return {
      answer: result.answer,
      citations: verifiedCitations,
      confidence: result.answeredFromContext ? (usedWidenedSearch ? 'LOW' : 'HIGH') : 'LOW'
    };
  }
}
