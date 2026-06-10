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

      const res = await fetch(GROQ_API_URL, {
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
}
