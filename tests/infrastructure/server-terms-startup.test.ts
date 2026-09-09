import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class InvalidInitialTermsContentError extends Error {}

  const app = {
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    log: { info: vi.fn(), warn: vi.fn() },
  };
  const ensureInitialVersion = vi.fn();

  return { app, ensureInitialVersion, InvalidInitialTermsContentError };
});

vi.mock('@/infrastructure/http/app.js', () => ({ buildApp: vi.fn(async () => mocks.app) }));
vi.mock('@/infrastructure/config/env.js', () => ({
  getEnv: () => ({ NODE_ENV: 'production', PORT: 3000, MACRO_SYNC_CRON: '0 18 * * 1-5' }),
}));
vi.mock('@/application/legal/terms-service.js', () => ({
  TermsService: class {
    ensureInitialVersion = mocks.ensureInitialVersion;
  },
  InvalidInitialTermsContentError: mocks.InvalidInitialTermsContentError,
}));
vi.mock('@/infrastructure/workers/macro-sync.worker.js', () => ({ startMacroSyncWorker: vi.fn(() => ({ close: vi.fn() })) }));
vi.mock('@/infrastructure/workers/recalculate.worker.js', () => ({ startRecalculateWorker: vi.fn(() => ({ close: vi.fn() })) }));
vi.mock('@/infrastructure/workers/daily-run.worker.js', () => ({ startDailyRunWorker: vi.fn(() => ({ close: vi.fn() })) }));
vi.mock('@/infrastructure/workers/nightly-learning.worker.js', () => ({ startNightlyLearningWorker: vi.fn(() => ({ close: vi.fn() })) }));
vi.mock('@/infrastructure/workers/queues.js', () => ({ macroSyncQueue: null }));
vi.mock('@/infrastructure/workers/repeatable-jobs.js', () => ({ registerRepeatableJobs: vi.fn(async () => undefined) }));

const { main } = await import('@/infrastructure/http/server.js');

describe('main — términos iniciales', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.app.listen.mockResolvedValue(undefined);
  });

  it('en producción no llega a listen si la semilla tiene marcadores inválidos', async () => {
    mocks.ensureInitialVersion.mockRejectedValue(
      new mocks.InvalidInitialTermsContentError('El texto inicial contiene [COMPLETAR FECHA]'),
    );

    await expect(main()).rejects.toThrow(/COMPLETAR FECHA/);
    expect(mocks.app.listen).not.toHaveBeenCalled();
  });

  it('con una falla transitoria de la base llega a listen en modo degradado', async () => {
    mocks.ensureInitialVersion.mockRejectedValue(new Error('ECONNREFUSED'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(main()).resolves.toBeUndefined();
    expect(mocks.app.listen).toHaveBeenCalledWith({ port: 3000, host: '0.0.0.0' });
    warning.mockRestore();
  });
});
