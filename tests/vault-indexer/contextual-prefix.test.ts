import { describe, it, expect, vi } from 'vitest';
import { ContextualPrefixGenerator } from '@/application/vault-indexer/contextual-prefix.js';

function llm(over: Partial<{ isConfigured: boolean; completeJSON: unknown }> = {}) {
  return {
    isConfigured: true,
    completeJSON: vi.fn(),
    ...over,
  } as never;
}

describe('ContextualPrefixGenerator.generate', () => {
  it('devuelve el contexto del LLM y lo pide con el documento cacheado', async () => {
    const fake = llm();
    (fake as unknown as { completeJSON: ReturnType<typeof vi.fn> }).completeJSON.mockResolvedValue({
      context: 'Este fragmento del apunte de CIP explica el prorrateo por horas máquina.',
    });
    const gen = new ContextualPrefixGenerator(fake);

    const out = await gen.generate('# CIP\n\nprorrateo...', 'El prorrateo usa horas máquina.');

    expect(out).toBe('Este fragmento del apunte de CIP explica el prorrateo por horas máquina.');
    const [system, , opts] = (fake as unknown as { completeJSON: ReturnType<typeof vi.fn> }).completeJSON.mock.calls[0];
    expect(system).toContain('# CIP'); // el documento va en el system
    expect(opts).toMatchObject({ cacheSystem: true });
  });

  it('devuelve null si el LLM no está configurado (sin llamar al modelo)', async () => {
    const fake = llm({ isConfigured: false });
    const gen = new ContextualPrefixGenerator(fake);
    expect(await gen.generate('doc', 'chunk')).toBeNull();
    expect((fake as unknown as { completeJSON: ReturnType<typeof vi.fn> }).completeJSON).not.toHaveBeenCalled();
  });

  it('devuelve null si el LLM responde null o un contexto vacío', async () => {
    const fake = llm();
    const spy = (fake as unknown as { completeJSON: ReturnType<typeof vi.fn> }).completeJSON;
    spy.mockResolvedValueOnce(null);
    const gen = new ContextualPrefixGenerator(fake);
    expect(await gen.generate('doc', 'chunk')).toBeNull();

    spy.mockResolvedValueOnce({ context: '   ' });
    expect(await gen.generate('doc', 'chunk')).toBeNull();
  });

  it('trunca un documento muy largo antes de mandarlo', async () => {
    const fake = llm();
    const spy = (fake as unknown as { completeJSON: ReturnType<typeof vi.fn> }).completeJSON;
    spy.mockResolvedValue({ context: 'ok' });
    const gen = new ContextualPrefixGenerator(fake);

    await gen.generate('x'.repeat(50_000), 'chunk');
    const [system] = spy.mock.calls[0];
    expect(system).toContain('[...documento truncado...]');
    expect(system.length).toBeLessThan(50_000);
  });
});
