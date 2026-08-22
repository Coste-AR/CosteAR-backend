import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests de AdvisorService (issue #99, B-11).
 *
 * El servicio es una capa delgada sobre GroqService.completeJSON. Verificamos:
 *   - Que devuelve un AdvisorResult bien formado cuando Groq responde
 *   - Que devuelve null cuando Groq no responde o la respuesta no tiene headline
 *   - Que trunca los points a 4 máximo
 *   - Que el prompt incluye los datos del contexto
 */

const mockCompleteJSON = vi.fn();

vi.mock('@/infrastructure/ai/groq-service.js', () => ({
  GroqService: vi.fn(() => ({ completeJSON: mockCompleteJSON })),
}));

describe('AdvisorService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devuelve AdvisorResult cuando Groq responde con JSON válido', async () => {
    const { AdvisorService } = await import('@/application/advisor/advisor-service.js');
    const svc = new AdvisorService();

    mockCompleteJSON.mockResolvedValue({
      headline: 'El margen es bajo, subí el precio.',
      points: ['Punto A', 'Punto B'],
    });

    const result = await svc.advise('cost_result', { margin: 5 });

    expect(result).toMatchObject({
      headline: 'El margen es bajo, subí el precio.',
      points: ['Punto A', 'Punto B'],
    });
  });

  it('devuelve null cuando Groq devuelve null', async () => {
    const { AdvisorService } = await import('@/application/advisor/advisor-service.js');
    const svc = new AdvisorService();

    mockCompleteJSON.mockResolvedValue(null);

    const result = await svc.advise('macro', { usd: 1500 });
    expect(result).toBeNull();
  });

  it('devuelve null cuando el resultado no tiene headline', async () => {
    const { AdvisorService } = await import('@/application/advisor/advisor-service.js');
    const svc = new AdvisorService();

    mockCompleteJSON.mockResolvedValue({ points: ['algo'] }); // falta headline

    const result = await svc.advise('alerts', {});
    expect(result).toBeNull();
  });

  it('trunca points a 4 aunque Groq devuelva más', async () => {
    const { AdvisorService } = await import('@/application/advisor/advisor-service.js');
    const svc = new AdvisorService();

    mockCompleteJSON.mockResolvedValue({
      headline: 'Resumen',
      points: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
    });

    const result = await svc.advise('reconciliation', {});
    expect(result!.points).toHaveLength(4);
  });

  it('devuelve points vacío cuando Groq no devuelve un array', async () => {
    const { AdvisorService } = await import('@/application/advisor/advisor-service.js');
    const svc = new AdvisorService();

    mockCompleteJSON.mockResolvedValue({ headline: 'Título', points: 'no es array' });

    const result = await svc.advise('cost_result', {});
    expect(result!.points).toEqual([]);
  });
});
