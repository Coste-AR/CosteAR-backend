import { describe, expect, it } from 'vitest';
import { generarBalance } from '../../scripts/balance-tanda.mjs';

const PR = {
  number: 701,
  author: { login: 'alan' },
  createdAt: '2026-09-01T09:00:00Z',
  mergedAt: '2026-09-01T11:00:00Z',
  additions: 12,
  deletions: 3,
  changedFiles: 2,
  headRefName: 'feat/balance',
  body: 'Closes #700',
  closingIssuesReferences: [{ number: 700 }],
  commits: [{ oid: 'commit-701', committedDate: '2026-09-01T08:30:00Z' }],
  comments: [],
  labels: [],
};

describe('balance-tanda', () => {
  it('cuenta solo las corridas de CI asociadas al SHA del PR', async () => {
    const result = await generarBalance(
      { desde: '2026-09-01', hasta: '2026-09-01', repos: ['Coste-AR/CosteAR-backend'] },
      {
        run: async (args: string[]) => {
          if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify([PR]);
          if (args[0] === 'api' && args[1].includes('/pulls/701/commits')) return JSON.stringify(PR.commits.map((commit) => ({ sha: commit.oid, commit: { committer: { date: commit.committedDate } } })));
          if (args[0] === 'api' && args[1].includes('/issues/700/events')) return JSON.stringify([{ event: 'labeled', label: { name: 'listo' }, created_at: '2026-09-01T08:00:00Z' }]);
          if (args[0] === 'api' && args[1].includes('/actions/runs')) return JSON.stringify({ total_count: 2, workflow_runs: [
            { id: 1, name: 'Backend CI', conclusion: 'failure', updated_at: '2026-09-01T09:00:00Z' },
            { id: 2, name: 'Backend CI', conclusion: 'success', updated_at: '2026-09-01T10:00:00Z' },
          ] });
          throw new Error(`Llamada no prevista: ${args.join(' ')}`);
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.markdown).toContain('2 intento(s), 1 fallido(s)');
    expect(result.markdown).toContain('1h 0m');
  });

  it('marca como no medible y falla cuando GitHub no permite leer las corridas de CI', async () => {
    const result = await generarBalance(
      { desde: '2026-09-01', hasta: '2026-09-01', repos: ['Coste-AR/CosteAR-backend'] },
      {
        run: async (args: string[]) => {
          if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify([PR]);
          if (args[0] === 'api' && args[1].includes('/pulls/701/commits')) return JSON.stringify(PR.commits.map((commit) => ({ sha: commit.oid, commit: { committer: { date: commit.committedDate } } })));
          if (args[0] === 'api' && args[1].includes('/issues/700/events')) return '[]';
          if (args[0] === 'api' && args[1].includes('/actions/runs')) throw new Error('HTTP 403: Resource not accessible');
          throw new Error(`Llamada no prevista: ${args.join(' ')}`);
        },
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.markdown).toContain('no medible: sin permisos de CI');
    expect(result.markdown).toContain('ausente');
  });
});
