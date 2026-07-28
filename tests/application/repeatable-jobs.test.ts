import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Los jobs recurrentes se registraban en dos lugares desalineados:
 *
 *   server.ts        → 'macro-sync-cron', SIN tz
 *   workers/index.ts → 'scheduled-sync',  tz ART
 *
 * Eso son dos repetibles DISTINTOS en Redis (se duplicaba la sync), y encima a
 * horas distintas: sin `tz` BullMQ usa la hora del proceso, y los contenedores
 * corren en UTC, así que '0 18 * * 1-5' disparaba a las 15:00 ART.
 */

const { macroSyncQueue, nightlyLearningQueue } = vi.hoisted(() => ({
  macroSyncQueue: { getRepeatableJobs: vi.fn(), removeRepeatableByKey: vi.fn(), add: vi.fn() },
  nightlyLearningQueue: { getRepeatableJobs: vi.fn(), removeRepeatableByKey: vi.fn(), add: vi.fn() },
}));

vi.mock('@/infrastructure/workers/queues.js', () => ({
  macroSyncQueue,
  nightlyLearningQueue,
  recalculateQueue: {},
}));

const TZ = 'America/Argentina/Buenos_Aires';
const CRON = '0 18 * * 1-5';

beforeEach(() => {
  vi.clearAllMocks();
  macroSyncQueue.getRepeatableJobs.mockResolvedValue([]);
  nightlyLearningQueue.getRepeatableJobs.mockResolvedValue([]);
});

async function run(cron = CRON) {
  const { registerRepeatableJobs } = await import('@/infrastructure/workers/repeatable-jobs.js');
  await registerRepeatableJobs(cron);
}

describe('registerRepeatableJobs', () => {
  it('programa un solo repetible por cola, con timezone explícito', async () => {
    await run();

    expect(macroSyncQueue.add).toHaveBeenCalledOnce();
    expect(nightlyLearningQueue.add).toHaveBeenCalledOnce();

    const [name, , opts] = macroSyncQueue.add.mock.calls[0]!;
    expect(name).toBe('macro-sync');
    expect(opts.repeat.pattern).toBe(CRON);
    expect(opts.jobId).toBe('scheduled-macro-sync');
    // El bug de las 3 horas: sin tz, '0 18' era 18:00 UTC = 15:00 ART.
    expect(opts.repeat.tz).toBe(TZ);
  });

  it('el pipeline nocturno también lleva timezone', async () => {
    await run();
    const [name, , opts] = nightlyLearningQueue.add.mock.calls[0]!;
    expect(name).toBe('nightly-pipeline');
    expect(opts.repeat.tz).toBe(TZ);
  });

  it('borra los repetibles legacy que quedaron en Redis de deploys viejos', async () => {
    macroSyncQueue.getRepeatableJobs.mockResolvedValue([
      { key: 'k1', name: 'macro-sync-cron', pattern: CRON, tz: undefined }, // el de server.ts, sin tz
      { key: 'k2', name: 'scheduled-sync', pattern: CRON, tz: TZ },         // el de workers/index.ts
    ]);

    await run();

    expect(macroSyncQueue.removeRepeatableByKey).toHaveBeenCalledTimes(2);
    expect(macroSyncQueue.removeRepeatableByKey).toHaveBeenCalledWith('k1');
    expect(macroSyncQueue.removeRepeatableByKey).toHaveBeenCalledWith('k2');
    expect(macroSyncQueue.add).toHaveBeenCalledOnce();
  });

  it('NO toca el repetible canónico si ya está bien (no hay ventana sin cron)', async () => {
    macroSyncQueue.getRepeatableJobs.mockResolvedValue([
      { key: 'ok', name: 'macro-sync', pattern: CRON, tz: TZ },
    ]);

    await run();

    expect(macroSyncQueue.removeRepeatableByKey).not.toHaveBeenCalled();
    // Se re-agrega igual: para BullMQ es el mismo repeat key, o sea un no-op.
    expect(macroSyncQueue.add).toHaveBeenCalledOnce();
  });

  it('un cron distinto se considera obsoleto y se reemplaza', async () => {
    macroSyncQueue.getRepeatableJobs.mockResolvedValue([
      { key: 'viejo', name: 'macro-sync', pattern: '0 9 * * *', tz: TZ },
    ]);

    await run('*/30 * * * *');

    expect(macroSyncQueue.removeRepeatableByKey).toHaveBeenCalledWith('viejo');
    expect(macroSyncQueue.add.mock.calls[0]![2].repeat.pattern).toBe('*/30 * * * *');
  });

  it('un repetible con el nombre bueno pero sin tz también se reemplaza', async () => {
    macroSyncQueue.getRepeatableJobs.mockResolvedValue([
      { key: 'sin-tz', name: 'macro-sync', pattern: CRON, tz: undefined },
    ]);

    await run();

    expect(macroSyncQueue.removeRepeatableByKey).toHaveBeenCalledWith('sin-tz');
  });

  it('es idempotente: correrlo dos veces converge al mismo estado', async () => {
    await run();
    macroSyncQueue.getRepeatableJobs.mockResolvedValue([
      { key: 'ok', name: 'macro-sync', pattern: CRON, tz: TZ },
    ]);
    await run();

    expect(macroSyncQueue.removeRepeatableByKey).not.toHaveBeenCalled();
    expect(macroSyncQueue.add).toHaveBeenCalledTimes(2); // una por corrida, nunca dos por corrida
  });

  it('si la cola no está disponible avisa y no explota', async () => {
    vi.resetModules();
    vi.doMock('@/infrastructure/workers/queues.js', () => ({
      macroSyncQueue: null,
      nightlyLearningQueue: null,
      recalculateQueue: {},
    }));
    const { registerRepeatableJobs } = await import('@/infrastructure/workers/repeatable-jobs.js');
    await expect(registerRepeatableJobs(CRON)).resolves.toBeUndefined();
    vi.doUnmock('@/infrastructure/workers/queues.js');
  });
});
