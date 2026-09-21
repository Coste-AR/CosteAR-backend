import { describe, expect, it, vi } from 'vitest';
import { createClassifierAiClient } from '@/infrastructure/classifier/classifier-ai-client.js';
import { GroqClassifier } from '@/infrastructure/ai/groq-classifier.js';

const validResponse = {
  documentType: 'FACTURA_COMPRA',
  costSection: 'MATERIA_PRIMA',
  confidence: 88,
  reasoning: 'Compra de insumos de producción.',
};

const input = {
  text: 'Factura de compra de chapa de acero',
  accumulatedPts: 40,
  foundSignalLabels: ['FACTURA_KEYWORD'],
  suggestedType: 'FACTURA_COMPRA',
  industryCategory: 'MANUFACTURA',
};

describe('proveedor configurable de Layer 5', () => {
  it('DeepSeek mockeado devuelve la misma forma que Groq y usa su endpoint/modelo', async () => {
    const makeResponse = () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validResponse) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const fetchMock = vi.fn(async () => makeResponse());
    const groqFetchMock = vi.fn(async () => makeResponse());

    const client = createClassifierAiClient({
      CLASSIFIER_AI_PROVIDER: 'deepseek',
      CLASSIFIER_AI_MODEL: 'deepseek-flash',
      CLASSIFIER_AI_API_KEY: 'test-deepseek-key-123456',
      GROQ_API_KEY: 'groq_placeholder',
    }, fetchMock);
    const result = await new GroqClassifier(client).classifyDocument(input);
    const groqClient = createClassifierAiClient({
      CLASSIFIER_AI_PROVIDER: 'groq',
      CLASSIFIER_AI_MODEL: 'openai/gpt-oss-120b',
      CLASSIFIER_AI_API_KEY: 'test-groq-key-1234567890',
      GROQ_API_KEY: 'groq_placeholder',
    }, groqFetchMock);
    const groqResult = await new GroqClassifier(groqClient).classifyDocument(input);

    expect(result).toEqual(validResponse);
    expect(result).toEqual(groqResult);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(body.model).toBe('deepseek-flash');
    expect(body).not.toHaveProperty('seed');
  });
});
