import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdvisorService } from '@/application/advisor/advisor-service.js';

/**
 * AdvisorService (issue #99, B-11). Capa delgada sobre `LLMService.completeJSON`
 * (Claude por default desde F1-10). Se inyecta un fake. Verificamos:
 *   - AdvisorResult bien formado cuando el LLM responde
 *   - null cuando el LLM no responde o falta headline
 *   - points truncados a 4
 *   - schema + cacheSystem se pasan al LLM
 */

const completeJSON = vi.fn();
const fakeLlm = { isConfigured: true, modelId: 'claude-sonnet-4-5', completeJSON } as never;

beforeEach(() => completeJSON.mockReset());

describe('AdvisorService', () => {
  it('devuelve AdvisorResult cuando el LLM responde con JSON válido', async () => {
    completeJSON.mockResolvedValue({
      headline: 'El margen es bajo, subí el precio.',
      points: ['Punto A', 'Punto B'],
    });

    const result = await new AdvisorService(fakeLlm).advise('cost_result', { margin: 5 });

    expect(result).toMatchObject({
      headline: 'El margen es bajo, subí el precio.',
      points: ['Punto A', 'Punto B'],
    });
    expect(completeJSON.mock.calls[0]![2]).toMatchObject({ cacheSystem: true });
    expect(completeJSON.mock.calls[0]![1]).toContain('"margin": 5'); // el prompt trae el contexto
  });

  it('devuelve null cuando el LLM devuelve null', async () => {
    completeJSON.mockResolvedValue(null);
    expect(await new AdvisorService(fakeLlm).advise('macro', { usd: 1500 })).toBeNull();
  });

  it('devuelve null cuando el resultado no tiene headline', async () => {
    completeJSON.mockResolvedValue({ points: ['algo'] });
    expect(await new AdvisorService(fakeLlm).advise('alerts', {})).toBeNull();
  });

  it('trunca points a 4 aunque el LLM devuelva más', async () => {
    completeJSON.mockResolvedValue({ headline: 'Resumen', points: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] });
    const result = await new AdvisorService(fakeLlm).advise('reconciliation', {});
    expect(result!.points).toHaveLength(4);
  });

  it('devuelve points vacío cuando el LLM no devuelve un array', async () => {
    completeJSON.mockResolvedValue({ headline: 'Título', points: 'no es array' });
    const result = await new AdvisorService(fakeLlm).advise('cost_result', {});
    expect(result!.points).toEqual([]);
  });
});
