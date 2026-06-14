// src/application/advisor/advisor-service.ts
import { GroqService } from '../../infrastructure/ai/groq-service.js';

export type AdvisorKind = 'cost_result' | 'reconciliation' | 'macro' | 'alerts';

export interface AdvisorResult {
  headline: string;
  points: string[];
}

const SYSTEM = `Sos un asesor experto en contabilidad de costos para PyMEs argentinas, hablándole a un costista.
Te paso datos REALES ya calculados. Tu trabajo es interpretarlos y dar consejo accionable, claro y breve,
en español argentino, sin tecnicismos innecesarios. Reglas:
- Basate SOLO en los números que te doy. No inventes datos.
- Sé concreto y accionable ("subí el precio ~9%", "revisá el alquiler"), no genérico.
- Es una SUGERENCIA: el costista decide. No afirmes certezas absolutas.
- Respondé SIEMPRE en JSON válido: { "headline": "una frase resumen", "points": ["punto 1", "punto 2", "punto 3"] }
- Máximo 4 puntos, cada uno una oración.`;

function buildUserPrompt(kind: AdvisorKind, context: Record<string, unknown>): string {
  const data = JSON.stringify(context, null, 2);
  switch (kind) {
    case 'cost_result':
      return `Analizá este resultado de una estructura de costos (rubro y umbral de margen incluidos si están).
Decime si el margen es sano, qué elemento del costo pesa de más, y qué ajuste concreto haría falta para llegar al margen objetivo.
Datos:
${data}`;
    case 'reconciliation':
      return `Comparé lo que dice la estructura de costos contra lo que suman los comprobantes reales del período (libro mayor).
Explicá los desvíos y sugerí la acción concreta (actualizar costo unitario, faltan/sobran comprobantes, estructura desactualizada).
Datos (structureCosts = modelo, ledgerCosts = real):
${data}`;
    case 'macro':
      return `Estas son las variables macro argentinas más recientes (IPC, dólar, etc.).
Interpretá el impacto probable sobre los costos de una PyME y decí si conviene propagar el ajuste a las estructuras de costos activas.
Datos:
${data}`;
    case 'alerts':
      return `Estas son las alertas de margen del costista cruzando sus clientes.
Resumí lo más urgente, priorizá, e identificá si hay un patrón común (ej. suba de mano de obra en varios clientes).
Datos:
${data}`;
  }
}

export class AdvisorService {
  constructor(private readonly groq: GroqService = new GroqService()) {}

  async advise(kind: AdvisorKind, context: Record<string, unknown>): Promise<AdvisorResult | null> {
    const result = await this.groq.completeJSON<AdvisorResult>(SYSTEM, buildUserPrompt(kind, context));
    if (!result || !result.headline) return null;
    return {
      headline: String(result.headline),
      points: Array.isArray(result.points) ? result.points.slice(0, 4).map(String) : [],
    };
  }
}
