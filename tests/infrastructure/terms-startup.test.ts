import { describe, expect, it, vi } from 'vitest';
import { InvalidInitialTermsContentError } from '@/application/legal/terms-service.js';
import { seedInitialTermsAtStartup } from '@/infrastructure/http/terms-startup.js';

describe('seedInitialTermsAtStartup', () => {
  it('en producción corta el arranque antes de listen si los términos son inválidos', async () => {
    const terms = {
      ensureInitialVersion: vi.fn().mockRejectedValue(new InvalidInitialTermsContentError(['[COMPLETAR FECHA]'])),
    };

    await expect(seedInitialTermsAtStartup(terms, 'production')).rejects.toThrow(/COMPLETAR FECHA/);
  });

  it('ante una falla transitoria de la base conserva el arranque degradado', async () => {
    const terms = { ensureInitialVersion: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(seedInitialTermsAtStartup(terms, 'production')).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('no se pudo sembrar'), expect.any(Error));
    warning.mockRestore();
  });
});
