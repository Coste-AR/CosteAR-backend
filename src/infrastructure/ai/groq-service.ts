/**
 * Servicio de análisis de documentos con Groq.
 *
 * Analiza documentos enviados por operadores y devuelve:
 *  - Tipo de documento detectado
 *  - Calidad (legible / parcial / ilegible)
 *  - Datos extraídos estructurados (para pre-llenar el sistema)
 *  - Mensaje humano con observaciones
 *  - A qué sección de costos aplica
 */

import { getEnv } from '../config/env.js';
import { groqFetch } from './groq-rate-limiter.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const TEXT_MODEL   = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = `Sos un asistente experto en contabilidad de costos para PyMEs argentinas.
Los operadores de empresas te envían documentos (facturas, remitos, liquidaciones de sueldos,
planillas de horas, notas de débito, recibos, fotos de comprobantes, etc.) para que los analices
y extraigas la información relevante para el sistema de costeo.

El sistema maneja tres grandes áreas:
- MATERIA_PRIMA: compras de insumos, materiales, facturas de proveedores, ficha de stock
- MANO_DE_OBRA: liquidaciones de sueldos, horas trabajadas por departamento, cargas sociales
- COSTOS_INDIRECTOS: alquileres, energía, seguros, mantenimiento, gastos generales de fábrica
- VENTAS: facturas de venta, remitos de salida, precios unitarios

Tu tarea es:
1. Detectar qué tipo de documento es
2. Evaluar si se puede leer bien
3. Extraer los datos numéricos y de texto relevantes
4. Indicar a qué sección del sistema de costos aplica

Respondé SIEMPRE con un JSON válido con esta estructura exacta (sin texto antes ni después):
{
  "documentType": "factura_compra | factura_venta | remito | liquidacion_sueldos | planilla_horas | nota_debito | recibo | otro",
  "quality": "legible | parcial | ilegible",
  "qualityNote": "string — solo si quality es parcial o ilegible, explicá qué falla (borroso, cortado, luz, etc.)",
  "costSection": "MATERIA_PRIMA | MANO_DE_OBRA | COSTOS_INDIRECTOS | VENTAS | DESCONOCIDO",
  "message": "string — 2 a 4 oraciones en español argentino para el operador: qué detectaste, qué falta, qué está bien",
  "extractedData": {
    "date": "YYYY-MM-DD o null",
    "supplier": "nombre del proveedor o null",
    "invoiceNumber": "número de comprobante o null",
    "totalAmount": número o null,
    "taxAmount": número o null,
    "netAmount": número o null,
    "currency": "ARS | USD | null",
    "items": [
      { "description": "string", "quantity": número o null, "unitCost": número o null, "total": número o null }
    ],
    "department": "nombre del departamento si aplica o null",
    "hoursWorked": número o null,
    "employeeCount": número o null
  }
}

Si el documento está ilegible, ponés extractedData con todos los campos en null.
Si es texto libre sin documento adjunto, analizá el texto como descripción y extraé lo que puedas.
Nunca rompas el formato JSON. Nunca agregues explicaciones fuera del JSON.`;

export interface DocumentAnalysis {
  documentType: string;
  quality: 'legible' | 'parcial' | 'ilegible';
  qualityNote?: string;
  costSection: 'MATERIA_PRIMA' | 'MANO_DE_OBRA' | 'COSTOS_INDIRECTOS' | 'VENTAS' | 'DESCONOCIDO';
  message: string;
  extractedData: {
    date?: string | null;
    supplier?: string | null;
    invoiceNumber?: string | null;
    totalAmount?: number | null;
    taxAmount?: number | null;
    netAmount?: number | null;
    currency?: string | null;
    items?: { description: string; quantity?: number | null; unitCost?: number | null; total?: number | null }[];
    department?: string | null;
    hoursWorked?: number | null;
    employeeCount?: number | null;
  };
}

interface GroqResponse {
  choices: { message: { content: string } }[];
}

export class GroqService {
  private readonly apiKey: string;

  constructor() {
    this.apiKey = getEnv().GROQ_API_KEY;
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 10;
  }

  async analyzeDocument(input: {
    text?: string;
    fileData?: string;
    fileMimeType?: string;
    fileName?: string;
  }): Promise<DocumentAnalysis | null> {
    if (!this.isConfigured) return null;

    const isImage = input.fileMimeType?.startsWith('image/') ?? false;
    const isPdf   = input.fileMimeType === 'application/pdf';

    try {
      let messages: object[];

      if (isImage && input.fileData) {
        messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${input.fileMimeType};base64,${input.fileData}` },
              },
              {
                type: 'text',
                text: input.text
                  ? `El operador agregó este comentario junto con la imagen: "${input.text}"`
                  : 'Analizá este documento y devolvé el JSON.',
              },
            ],
          },
        ];
      } else {
        const content = [
          isPdf && input.fileName ? `Archivo PDF adjunto: ${input.fileName}` : '',
          input.text ? `Contenido / descripción del operador:\n${input.text}` : '',
        ].filter(Boolean).join('\n\n');

        messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: content || 'Mensaje vacío — indicalo en el JSON.' },
        ];
      }

      const model = isImage ? VISION_MODEL : TEXT_MODEL;

      const res = await groqFetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 600,
          temperature: 0.1, // Baja temperatura para JSON consistente
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        console.error('[groq] Error de API:', await res.text());
        return null;
      }

      const data = await res.json() as GroqResponse;
      const raw = data.choices[0]?.message.content ?? '';

      try {
        return JSON.parse(raw) as DocumentAnalysis;
      } catch {
        console.error('[groq] JSON inválido:', raw);
        return null;
      }
    } catch (err) {
      console.error('[groq] Error inesperado:', err);
      return null;
    }
  }

  /**
   * Layer 5 AI Fallback: classifies a document when deterministic rules
   * couldn't reach the confidence threshold.
   */
  async classifyDocument(input: {
    text: string;
    accumulatedPts: number;
    foundSignalLabels: string[];
    suggestedType: string | null;
    industryLabel?: string;
    industryCategory?: string;
    intent?: string;
  }): Promise<{ documentType: string; costSection: string; confidence: number; reasoning: string } | null> {
    if (!this.isConfigured) return null;

    const signalsSummary = input.foundSignalLabels.length > 0
      ? input.foundSignalLabels.map((l) => `- ${l}`).join('\n')
      : '- Ninguna señal encontrada';

    const industryCtx = input.industryLabel
      ? `Rubro de la empresa: ${input.industryLabel} (categoría interna: ${input.industryCategory ?? 'DEFAULT'}).`
      : 'Rubro de la empresa: no especificado.';

    const intentCtx = input.intent && input.intent !== 'DOCUMENTO_FORMAL'
      ? `Nota: el mensaje fue detectado como "${input.intent}", tener en cuenta al clasificar.`
      : '';

    // Instrucciones específicas por rubro para evitar errores sistemáticos
    const industryHints: Record<string, string> = {
      AGRO:        'En agroindustria: combustible (gasoil) es MATERIA_PRIMA (insumo de tractores/maquinaria), semillas/agroquímicos son MATERIA_PRIMA, flete de granos es COSTOS_INDIRECTOS.',
      GASTRONOMIA: 'En gastronomía: ingredientes (carne, verdura, lácteos, bebidas) y gas de cocina son MATERIA_PRIMA. Alquiler del local, luz, agua son COSTOS_INDIRECTOS.',
      MANUFACTURA: 'En manufactura: materias primas del proceso productivo son MATERIA_PRIMA. Energía eléctrica suele ser COSTOS_INDIRECTOS salvo que sea insumo directo del proceso.',
      CONSTRUCCION:'En construcción: materiales (cemento, hierro, madera) son MATERIA_PRIMA. Alquiler de equipos y transporte son COSTOS_INDIRECTOS.',
      TEXTIL:      'En textil: telas, hilos, botones, cierres son MATERIA_PRIMA. Electricidad del taller es COSTOS_INDIRECTOS.',
      SALUD:       'En salud: medicamentos, insumos médicos, reactivos son MATERIA_PRIMA. Equipos y habilitaciones son COSTOS_INDIRECTOS.',
      TRANSPORTE:  'En transporte: combustible, neumáticos, repuestos son MATERIA_PRIMA (insumos directos del servicio). Seguro y peaje son COSTOS_INDIRECTOS.',
      COMERCIO:    'En comercio: mercadería para reventa es MATERIA_PRIMA (costo del producto). Logística y alquiler son COSTOS_INDIRECTOS.',
      SERVICIOS:   'En servicios profesionales: casi no hay MATERIA_PRIMA. Honorarios de personal son MANO_DE_OBRA. Oficina, internet, software son COSTOS_INDIRECTOS.',
    };
    const industryHint = input.industryCategory ? (industryHints[input.industryCategory] ?? '') : '';

    const prompt = `Contexto: documento contable argentino enviado por un operador de PyME.
${industryCtx}
${industryHint}
${intentCtx}

El clasificador de reglas encontró estas señales:
${signalsSummary}
Confianza acumulada: ${input.accumulatedPts}/100
Clasificación parcial: ${input.suggestedType ?? 'DESCONOCIDO'}

Texto del documento:
${input.text.slice(0, 3000)}

Tipos posibles: FACTURA_COMPRA, FACTURA_VENTA, REMITO, LIQUIDACION_MOD, PLANILLA_HORAS, NOTA_DEBITO, NOTA_CREDITO, DESCONOCIDO
Secciones de costo: MATERIA_PRIMA, MANO_DE_OBRA, COSTOS_INDIRECTOS, VENTAS, DESCONOCIDO

Respondé SOLO con JSON:
{
  "documentType": "...",
  "costSection": "...",
  "confidence": <número 0-100>,
  "reasoning": "una oración en español explicando la decisión, mencionando el rubro si influyó"
}`;

    try {
      const res = await groqFetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: TEXT_MODEL,
          messages: [
            { role: 'system', content: 'Sos un clasificador de documentos contables argentinos. Respondé solo con JSON válido.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 200,
          temperature: 0.05,
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        console.error('[groq] classifyDocument error:', await res.text());
        return null;
      }

      const data = await res.json() as GroqResponse;
      const raw = data.choices[0]?.message.content ?? '';
      return JSON.parse(raw) as { documentType: string; costSection: string; confidence: number; reasoning: string };
    } catch (err) {
      console.error('[groq] classifyDocument unexpected error:', err);
      return null;
    }
  }
}
