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

const SYSTEM_PROMPT = `Sos el Asistente Tecnológico oficial de CosteAR, un software de contabilidad de costos para PyMEs argentinas (basado en la metodología de la Cátedra de Costos de la UNT).
Tu rol es ayudar al costista (contador/consultor) a comprender y operar el software como herramienta tecnológica.

Temas sobre los que brindás soporte:
1. Materia Prima: Cómo cargar la existencia inicial, registrar compras/consumos en la ficha PPP, calcular el Lote Óptimo de Wilson (LE = √(2·R·S / K·C)), y configurar el Stock de Reserva (Sr).
2. Mano de Obra Directa (MOD): Cálculo de los Días Hábiles Efectivos, el Índice Total de Cargas Sociales (ITCS) incluyendo las cargas de derivación y las inciertas predeterminadas (IAP, PAP, PPP), y la asignación de tarifas horarias integrales por departamento contable.
3. Costos Indirectos de Producción (CIP): Configuración de centros productivos y de servicio, carga de conceptos de CIF, distribución en Prorrateo Primario y Secundario (Dual Rate: discriminando fijo y variable), definición de capacidad normal (bp), cálculo de cuota predeterminada y análisis de variaciones de dos vías (Presupuesto y Volumen).
4. Configuración general: Cómo añadir nuevos clientes, gestionar operadores autorizados (invitaciones y revocados), y restablecer contraseñas.

Reglas de respuesta:
- Sos un asistente técnico informativo. NO ejecutás acciones directas en la base de datos (no creás facturas, alertas ni empresas por tu cuenta).
- Respondé en español rioplatense, de manera profesional, clara y concisa (máximo 3-4 oraciones).
- Respondé SIEMPRE con un objeto JSON válido con este formato:
{
  "reply": "Tu respuesta conversacional con las instrucciones técnicas de uso del software.",
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
