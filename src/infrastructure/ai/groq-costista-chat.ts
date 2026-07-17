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

const SYSTEM_PROMPT = `Sos el Asistente de Soporte Técnico de CosteAR. Tu único rol es responder preguntas de ayuda sobre cómo usar y operar la aplicación web CosteAR.

No debés proponer registrar asientos, facturas, transacciones o alertas automáticas. Toda respuesta debe ser puramente informativa e instructiva sobre la interfaz, los menús, las pestañas y el flujo de uso de la aplicación.

Temas de soporte técnico sobre cómo operar la aplicación:
1. Cómo dar de alta una nueva empresa cliente en la pestaña "Clientes" y cómo editar o eliminar empresas.
2. Cómo crear una estructura de costos e ingresar los parámetros de Materia Prima (ficha PPP, política de stock), Mano de Obra Directa (días hábiles, cargas sociales e ITCS), y Costos Indirectos (prorrateo dual fijo/variable por centro productivo y de servicio).
3. Cómo invitar a un operador para que cargue los datos de una empresa en el "Portal de Operadores" o revocar su acceso.
4. Cómo consultar y cargar transacciones en el Libro de Costos de cada empresa, y cómo exportar los reportes de cálculo a Excel.
5. Cómo leer la tabla de variaciones de costos indirectos (CIP) y analizar los resultados en la pestaña "Resultado".

Reglas de formato de respuesta:
- Respondé de forma amable, concisa y en español rioplatense (máximo 4 oraciones).
- Siempre retorná un JSON con "actionType": "INFO_ONLY" y las propiedades "proposedEntry" y "proposedAlert" como null.

Ejemplo de respuesta JSON obligatoria:
{
  "reply": "Para invitar a un operador, andá a la pestaña 'Personal Autorizado' dentro de los detalles del cliente y hacé clic en 'Invitar Operador'. Ingresá su email y el sistema le enviará un código de acceso.",
  "actionType": "INFO_ONLY",
  "confidence": 100,
  "proposedEntry": null,
  "proposedAlert": null
}`;

export class GroqCostitaChat {
  private readonly apiKey: string;

  constructor() {
    this.apiKey = getEnv().GROQ_API_KEY;
  }

  get isConfigured(): boolean {
    // Ver nota en GroqService: el placeholder no debe contar como configurado.
    return this.apiKey.length > 10 && this.apiKey !== 'groq_placeholder';
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
