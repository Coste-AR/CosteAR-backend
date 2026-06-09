/**
 * Servicio de análisis de documentos con Groq (llama-3.2-11b-vision-preview).
 *
 * Analiza texto, imágenes y PDFs enviados por operadores y devuelve
 * observaciones útiles para el costista: calidad del documento, datos
 * detectados, advertencias y sugerencias.
 */

import { getEnv } from '../config/env.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const VISION_MODEL  = 'meta-llama/llama-4-scout-17b-16e-instruct';
const TEXT_MODEL    = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = `Sos un asistente especializado en análisis de documentos para costistas argentinos.
Tu tarea es analizar documentos enviados por operadores de empresas (facturas, remitos, notas de débito,
planillas, fotos de comprobantes, etc.) y dar feedback útil.

Respondé siempre en español argentino, de forma concisa y directa.
Tu respuesta debe incluir:
1. Qué tipo de documento parece ser
2. Datos relevantes que detectás (montos, fechas, proveedores, conceptos)
3. Advertencias si algo no se entiende bien o está incompleto
4. Sugerencias para mejorar la calidad del envío si aplica

Si el documento está borroso, ilegible o no tiene contenido útil, decilo claramente.
Mantené la respuesta en máximo 5 oraciones.`;

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
    fileData?: string;      // base64
    fileMimeType?: string;  // image/jpeg, image/png, application/pdf
    fileName?: string;
  }): Promise<string> {
    if (!this.isConfigured) {
      return '';
    }

    const isImage = input.fileMimeType?.startsWith('image/') ?? false;
    const isPdf   = input.fileMimeType === 'application/pdf';

    try {
      let messages: object[];

      if (isImage && input.fileData) {
        // Vision: imagen en base64
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
                  ? `El operador también agregó este comentario: "${input.text}"`
                  : 'Analizá este documento.',
              },
            ],
          },
        ];
      } else {
        // Texto plano o PDF (mandamos el texto extraído o descripción)
        const content = [
          isPdf && input.fileName ? `[PDF adjunto: ${input.fileName}]` : '',
          input.text ?? '',
        ].filter(Boolean).join('\n');

        messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Analizá este contenido enviado por un operador:\n\n${content}` },
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
          max_tokens: 300,
          temperature: 0.3,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('[groq] Error de API:', err);
        return '';
      }

      const data = await res.json() as GroqResponse;
      return data.choices[0]?.message.content ?? '';
    } catch (err) {
      console.error('[groq] Error inesperado:', err);
      return '';
    }
  }
}
