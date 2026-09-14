import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';

const fakeBin = mkdtempSync(join(tmpdir(), 'costear-briefing-'));
const fakeCli = join(fakeBin, 'fake-cli.mjs');
const projectRoot = resolve(import.meta.dirname, '..', '..');
const briefing = join(projectRoot, '.claude', 'hooks', 'briefing.mjs');

writeFileSync(fakeCli, `
const [tool, ...args] = process.argv.slice(2);
const scenario = process.env.FAKE_SCENARIO ?? 'messages';
const out = (value) => process.stdout.write(String(value));
if (tool === 'git') {
  if (args[0] === 'rev-parse') out('feat/test\\n');
  else if (args[0] === 'rev-list') out('0\\n');
  process.exit(0);
}
if (args[0] === 'variable') {
  if (scenario === 'variable-fail') process.exit(1);
  out('sprint\\n'); process.exit(0);
}
if (args[0] === 'repo') { out('Coste-AR/CosteAR-backend\\n'); process.exit(0); }
if (args[0] === 'api' && args[1] === 'user') { out('agent-test\\n'); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'list') {
  out(JSON.stringify([{ number: 351, labels: [{ name: 'listo' }] }])); process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'list') {
  if (args.includes('number,title,isDraft,author,baseRefName')) process.exit(0);
  out(JSON.stringify([{ number: 352 }])); process.exit(0);
}
if (args[0] === 'api' && args[1]?.includes('/issues/comments?')) {
  if (scenario === 'comments-fail') process.exit(1);
  if (scenario !== 'messages') { out('[[]]'); process.exit(0); }
  out(JSON.stringify([[
    { created_at: '2026-09-13T20:04:28Z', issue_url: 'https://api.github.com/repos/Coste-AR/CosteAR-backend/issues/351', html_url: 'https://github.com/x/351#c1', user: { login: 'Santiago' }, body: '/agente leé esto completo' },
    { created_at: '2026-09-13T20:06:28Z', issue_url: 'https://api.github.com/repos/Coste-AR/CosteAR-backend/issues/352', html_url: 'https://github.com/x/352#c2', user: { login: 'Alan' }, body: '/agente mensaje del PR' },
    { created_at: '2026-09-13T20:05:28Z', issue_url: 'https://api.github.com/repos/Coste-AR/CosteAR-backend/issues/351', html_url: 'https://github.com/x/351#c3', user: { login: 'Otro' }, body: 'comentario común' }
  ]])); process.exit(0);
}
process.exit(0);
`, 'utf8');

function run(scenario: string) {
  return execFileSync(process.execPath, [briefing], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectRoot,
      GITHUB_REPOSITORY: 'Coste-AR/CosteAR-backend',
      BRIEFING_COMMAND_SHIM: fakeCli,
      FAKE_SCENARIO: scenario,
    },
  });
}

afterAll(() => rmSync(fakeBin, { recursive: true, force: true }));

describe('briefing: modo y canal /agente', () => {
  it('muestra comentarios de issues habilitados y PRs abiertos, en hora argentina y en orden', () => {
    const output = run('messages');
    expect(output.split(/\r?\n/)[0]).toBe('Modo de trabajo: sprint');
    expect(output).toContain('Mensajes para vos:');
    expect(output).toContain('13/09/2026 17:04 ART · Santiago · #351');
    expect(output).toContain('/agente leé esto completo');
    expect(output).toContain('13/09/2026 17:06 ART · Alan · PR #352');
    expect(output).toContain('/agente mensaje del PR');
    expect(output).not.toContain('comentario común');
    expect(output.indexOf('#351')).toBeLessThan(output.indexOf('PR #352'));
  });

  it('declara la ausencia del modo sin cortar el resto del briefing', () => {
    const output = run('variable-fail');
    expect(output.split(/\r?\n/)[0]).toBe('Modo de trabajo: NO DECLARADO (no se pudo leer la variable)');
    expect(output).toContain('Rama: feat/test');
    expect(output).toContain('Mensajes para vos: ninguno');
  });

  it('dice explícitamente que no hay mensajes', () => {
    expect(run('empty')).toContain('Mensajes para vos: ninguno');
  });

  it('si falla la lectura de comentarios lo declara y termina el briefing', () => {
    const output = run('comments-fail');
    expect(output).toContain('No se pudieron leer los comentarios de los últimos 7 días.');
    expect(output).toContain('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });
});
