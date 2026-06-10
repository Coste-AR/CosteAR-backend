/**
 * Groq AI — Chat del costista.
 *
 * A diferencia del portal de operadores (clasificación automática),
 * aquí el costista describe una situación y la IA:
 *  1. Interpreta qué evento contable ocurrió
 *  2. Propone una acción concreta (con datos específicos)
 *  3. El costista confirma antes de que se aplique cualquier cambio
 *
 * Tipos de acción que puede proponer la IA:
 *  - CREATE_ENTRY   → registrar un evento de costo manual
 *  - CREATE_ALERT   → crear una alerta para una empresa
 *  - INFO_ONLY      → respuesta informativa, sin cambios en la DB
 */

import { getEnv } from '../config/env.js';
import { groqFetch } from './groq-rate-limiter.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const TEXT_MODEL   = 'llama-3.3-70b-versatile';

export type ChatActionType = 'CREATE_ENTRY' | 'CREATE_ALERT' | 'INFO_ONLY';

export interface ProposedEntry {
  companyId: string;
  companyName: string;
  rawContent: string;
  costSection: 'MATERIA_PRIMA' | 'MANO_DE_OBRA' | 'COSTOS_INDIRECTOS' | 'VENTAS' | 'DESCONOCIDO';
  documentType: string;
  estimatedImpact?: string; // ej: "+15% en Costos Indirectos"
}

export interface ProposedAlert {
  companyId: string;
  companyName: string;
  message: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface CostitaChatResponse {
  reply: string;            // respuesta conversacional para mostrar al costista
  actionType: ChatActionType;
  proposedEntry?: ProposedEntry;
  proposedAlert?: ProposedAlert;
  confidence: number;       // 0-100, qué tan segura está la IA de su interpretación
}

interface PortfolioContext {
  companies: Array<{
    id: string;
    name: string;
    industry: string | null;
    structureCount: number;
  }>;
  pendingCount: number;
  activeAlerts: number;
  macroContext?: {
    usdOficial?: number;
    ipcMensual?: number;
  };
}

const SYSTEM_PROMPT = `Sos un asistente especializado en contabilidad de costos para PyMEs argentinas.
Tu interlocutor es el COSTISTA (contador/consultor), no el operario. Es un profesional que sabe de costos.

Tu rol:
- Interpretar situaciones de negocio que describe el costista
- Proponer acciones contables concretas (registrar un evento, crear una alerta)
- Ser preciso con los datos: empresa afectada, sección de costos, impacto estimado
- Si no tenés suficiente información, pedirla de forma concisa

Secciones de costo del sistema:
- MATERIA_PRIMA: insumos directos del proceso productivo
- MANO_DE_OBRA: sueldos, liquidaciones, horas trabajadas
- COSTOS_INDIRECTOS: energía, alquiler, seguros, mantenimiento
- VENTAS: facturas de venta, precios unitarios

Respondé SIEMPRE con JSON válido y nada más:
{
  "reply": "respuesta conversacional en español rioplatense, 2-3 oraciones máximo",
  "actionType": "CREATE_ENTRY | CREATE_ALERT | INFO_ONLY",
  "confidence": <0-100>,
  "proposedEntry": {
    "companyId": "<id de la empresa o null si no se puede determinar>",
    "companyName": "<nombre de la empresa>",
    "rawContent": "<descripción del evento para registrar, 1-2 oraciones>",
    "costSection": "<MATERIA_PRIMA|MANO_DE_OBRA|COSTOS_INDIRECTOS|VENTAS|DESCONOCIDO>",
    "documentType": "<AJUSTE_COSTO|EVENTO_NEGOCIO|ACTUALIZACION_PRECIO|EVENTO_LABORAL|OTRO>",
    "estimatedImpact": "<descripción del impacto estimado o null>"
  },
  "proposedAlert": {
    "companyId": "<id o null>",
    "companyName": "<nombre>",
    "message": "<texto de la alerta>",
    "severity": "<LOW|MEDIUM|HIGH>"
  }
}

Reglas:
- Si actionType es INFO_ONLY, proposedEntry y proposedAlert deben ser null
- Si actionType es CREATE_ENTRY, proposedEntry es obligatorio, proposedAlert es null
- Si actionType es CREATE_ALERT, proposedAlert es obligatorio, proposedEntry es null
- Si no podés identificar la empresa del portfolio, pedí aclaración (INFO_ONLY + reply preguntando)
- Nunca inventés datos que no estén en el mensaje o el contexto`;

export class GroqCostitaChat {
  private readonly apiKey: string;

  constructor() {
    this.apiKey = getEnv().GROQ_API_KEY;
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 10;
  }

  async interpret(
    message: string,
    portfolio: PortfolioContext,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  ): Promise<CostitaChatResponse | null> {
    if (!this.isConfigured) return null;

    const portfolioSummary = portfolio.companies
      .map((c) => `- ${c.name} (ID: ${c.id}, rubro: ${c.industry ?? 'no especificado'}, estructuras: ${c.structureCount})`)
      .join('\n');

    const macroSummary = portfolio.macroContext
      ? [
          portfolio.macroContext.usdOficial ? `USD oficial: $${portfolio.macroContext.usdOficial}` : null,
          portfolio.macroContext.ipcMensual  ? `IPC mensual: ${portfolio.macroContext.ipcMensual}%` : null,
        ].filter(Boolean).join(', ')
      : 'no disponible';

    const contextBlock = `
CARTERA DEL COSTISTA (${portfolio.companies.length} empresas):
${portfolioSummary || '(sin empresas cargadas)'}

Validaciones pendientes: ${portfolio.pendingCount}
Alertas activas: ${portfolio.activeAlerts}
Variables macro actuales: ${macroSummary}`;

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: `CONTEXTO DE LA CARTERA:\n${contextBlock}\n\n---\nMensaje del costista: ${message}` },
      // Historial de conversación (para mensajes de seguimiento)
      ...conversationHistory.slice(-6), // últimos 3 intercambios
    ];

    try {
      const res = await groqFetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: TEXT_MODEL,
          messages,
          max_tokens: 500,
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        console.error('[groq-costista-chat] API error:', await res.text());
        return null;
      }

      const data = await res.json() as { choices: { message: { content: string } }[] };
      const raw  = data.choices[0]?.message.content ?? '';
      const parsed = JSON.parse(raw) as CostitaChatResponse;

      // Sanitize: si propone una empresa que no está en el portfolio, rechazar
      if (parsed.proposedEntry?.companyId) {
        const valid = portfolio.companies.some((c) => c.id === parsed.proposedEntry!.companyId);
        if (!valid) {
          parsed.proposedEntry.companyId = '';
        }
      }

      return parsed;
    } catch (err) {
      console.error('[groq-costista-chat] error:', err);
      return null;
    }
  }
}
