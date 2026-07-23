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

import type { ClassifyResponse, DocumentAnalysis } from './groq-types.js';
import { GroqClient } from './groq-client.js';
import { GroqDocumentAnalyzer } from './groq-document-analyzer.js';
import { GroqClassifier } from './groq-classifier.js';

export * from './groq-types.js';

export class GroqService {
  private client: GroqClient;
  private analyzer: GroqDocumentAnalyzer;
  private classifier: GroqClassifier;

  constructor() {
    this.client = new GroqClient();
    this.analyzer = new GroqDocumentAnalyzer(this.client);
    this.classifier = new GroqClassifier(this.client);
  }

  get isConfigured(): boolean {
    return this.client.isConfigured;
  }

  async completeJSON<T>(systemPrompt: string, userPrompt: string): Promise<T | null> {
    return this.client.completeJSON<T>(systemPrompt, userPrompt);
  }

  async analyzeDocument(input: Parameters<GroqDocumentAnalyzer['analyzeDocument']>[0]): Promise<DocumentAnalysis | null> {
    return this.analyzer.analyzeDocument(input);
  }

  async classifyDocument(input: Parameters<GroqClassifier['classifyDocument']>[0]): Promise<ClassifyResponse | null> {
    return this.classifier.classifyDocument(input);
  }

  async transcribeAudio(audioBuffer: Buffer, mimeType: string, filename: string): Promise<string | null> {
    return this.client.transcribeAudio(audioBuffer, mimeType, filename);
  }
}
