import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The production ESM script is deliberately untyped JavaScript.
import { deriveLabels } from '../../../scripts/lib/pr-labels.mjs';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const originalEnv = { ...process.env };
const scriptUrl = new URL('../../../scripts/lib/pr-labels.mjs', import.meta.url);
let importSequence = 0;

/** The entry guard executes unexported main with the same mocked process boundary as the CLI. */
async function runMain() {
  process.argv = [originalArgv[0]!, fileURLToPath(scriptUrl)];
  await import(`${scriptUrl.href}?test=${importSequence++}`);
}

/** A successful child result lets each test specify only the mutations it cares about. */
function success() {
  return { status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>;
}

/** Fixing all workflow inputs here keeps command assertions about behavior, not setup. */
function setPr(title: string, assignees: string[]) {
  process.env.PR_TITLE = title;
  process.env.PR_NUMBER = '505';
  process.env.PR_AUTHOR = 'author';
  vi.mocked(spawnSync).mockImplementation((_cmd, args) =>
    args?.[1] === 'view'
      ? { status: 0, stdout: JSON.stringify({ assignees }), stderr: '' } as ReturnType<typeof spawnSync>
      : success());
}

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.mocked(spawnSync).mockReset();
});

describe('deriveLabels', () => {
  it.each([
    ['feat', 'type: feature'], ['fix', 'type: bug'], ['docs', 'type: docs'],
    ['refactor', 'type: refactor'], ['test', 'type: test'], ['chore', 'type: chore'],
  ])('maps type %s to %s without a scope', (type, label) => {
    expect(deriveLabels(`${type}: change`)).toEqual({ labels: [label] });
  });

  it.each([
    ['website', 'area: website'],
    ['run', 'area: runner'], ['browser', 'area: runner'], ['adapters/browser', 'area: runner'],
    ['executor', 'area: executor'],
    ['heal', 'area: heal'], ['grounding', 'area: heal'],
    ['mcp', 'area: mcp'],
    ['core/ir', 'area: ir'], ['ir', 'area: ir'], ['schema', 'area: ir'], ['spec', 'area: ir'], ['check', 'area: ir'],
    ['cli', 'area: cli'], ['init', 'area: cli'], ['config', 'area: cli'],
    ['view', 'area: viewer'], ['secrets', 'area: secrets'], ['report', 'area: report'],
    ['generate', 'area: generate'], ['generator', 'area: generate'], ['ai', 'area: generate'],
    ['adapters/ai', 'area: generate'], ['ports/ai', 'area: generate'],
    ['hooks', 'area: workflow'], ['implement', 'area: workflow'], ['flow', 'area: workflow'],
    ['workflow', 'area: workflow'], ['skill', 'area: workflow'], ['codex', 'area: workflow'],
    ['ops', 'area: workflow'], ['scripts', 'area: workflow'], ['agents', 'area: workflow'],
    ['architecture', 'area: infra'], ['ci', 'area: infra'], ['deps', 'area: infra'],
    ['deps-dev', 'area: infra'], ['main', 'area: infra'], ['release', 'area: infra'],
    ['test', 'area: infra'], ['e2e', 'area: infra'], ['lint', 'area: infra'], ['gitignore', 'area: infra'],
  ])('maps scope %s to %s', (scope, area) => {
    expect(deriveLabels(`fix(${scope}): change`)).toEqual({ labels: ['type: bug', area] });
  });

  it('leaves an unknown scope without an area label', () => {
    expect(deriveLabels('fix(unknown): change')).toEqual({ labels: ['type: bug'] });
  });

  it('does not resolve inherited constructor as a scope mapping', () => {
    expect(deriveLabels('fix(constructor): change')).toEqual({ labels: ['type: bug'] });
  });

  it('emits only the type for a title without scope', () => {
    expect(deriveLabels('fix: change')).toEqual({ labels: ['type: bug'] });
  });

  it('orders breaking-change before a mapped area', () => {
    expect(deriveLabels('feat(browser)!: change')).toEqual({ labels: ['type: feature', 'breaking-change', 'area: runner'] });
  });

  it('supports breaking-change without a scope', () => {
    expect(deriveLabels('fix!: change')).toEqual({ labels: ['type: bug', 'breaking-change'] });
  });

  it.each(['MCP', 'Mcp', 'mcp'])('matches the standalone %s word outside the scope', (word) => {
    expect(deriveLabels(`fix: mention ${word} support`)).toEqual({ labels: ['type: bug', 'area: mcp'] });
  });

  it('does not match mcp inside a longer word', () => {
    expect(deriveLabels('fix: mcpserver support')).toEqual({ labels: ['type: bug'] });
  });

  it('deduplicates the scope and standalone keyword area', () => {
    expect(deriveLabels('fix(mcp): improve MCP support')).toEqual({ labels: ['type: bug', 'area: mcp'] });
  });

  it.each(['fix missing colon', 'feature: change', 'FIX: change'])('rejects malformed title %s', (title) => {
    expect(deriveLabels(title)).toEqual({ labels: [] });
  });

  it('rejects a malformed title even when it contains MCP', () => {
    expect(deriveLabels('FIX: mentions MCP')).toEqual({ labels: [] });
  });

  it('derives the full acceptance example in type, breaking, area order', () => {
    expect(deriveLabels('fix(mcp)!: improve MCP support')).toEqual({
      labels: ['type: bug', 'breaking-change', 'area: mcp'],
    });
  });
});

describe('main', () => {
  it('adds all acceptance labels in one call and assigns the author separately', async () => {
    setPr('fix(mcp)!: improve MCP support', []);
    await runMain();
    expect(spawnSync).toHaveBeenCalledTimes(3);
    expect(vi.mocked(spawnSync).mock.calls[0]?.slice(0, 2)).toEqual([
      'gh', ['pr', 'edit', '505', '--add-label', 'type: bug', '--add-label', 'breaking-change', '--add-label', 'area: mcp'],
    ]);
    expect(vi.mocked(spawnSync).mock.calls[1]?.slice(0, 2)).toEqual(['gh', ['pr', 'view', '505', '--json', 'assignees']]);
    expect(vi.mocked(spawnSync).mock.calls[2]?.slice(0, 2)).toEqual([
      'gh', ['pr', 'edit', '505', '--add-assignee', 'author'],
    ]);
  });

  it('preserves an existing assignee while adding labels', async () => {
    setPr('fix: change', ['human']);
    await runMain();
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(vi.mocked(spawnSync).mock.calls[0]?.slice(0, 2)).toEqual([
      'gh', ['pr', 'edit', '505', '--add-label', 'type: bug'],
    ]);
    expect(vi.mocked(spawnSync).mock.calls[1]?.slice(0, 2)).toEqual(['gh', ['pr', 'view', '505', '--json', 'assignees']]);
  });

  it('makes no mutation calls when neither mutation is needed', async () => {
    setPr('FIX: malformed', ['human']);
    await runMain();
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawnSync).mock.calls[0]?.slice(0, 2)).toEqual(['gh', ['pr', 'view', '505', '--json', 'assignees']]);
  });

  it('assigns the author even when a malformed title yields no labels', async () => {
    setPr('FIX: malformed', []);
    await runMain();
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(vi.mocked(spawnSync).mock.calls[0]?.slice(0, 2)).toEqual(['gh', ['pr', 'view', '505', '--json', 'assignees']]);
    expect(vi.mocked(spawnSync).mock.calls[1]?.slice(0, 2)).toEqual([
      'gh', ['pr', 'edit', '505', '--add-assignee', 'author'],
    ]);
  });

  it('reports label failure and still attempts the independent assignment', async () => {
    setPr('fix: change', []);
    vi.mocked(spawnSync).mockImplementationOnce(() => ({ status: 1, stdout: '', stderr: 'label failed' } as ReturnType<typeof spawnSync>));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runMain();
    expect(spawnSync).toHaveBeenCalledTimes(3);
    expect(vi.mocked(spawnSync).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['gh', ['pr', 'edit', '505', '--add-label', 'type: bug']],
      ['gh', ['pr', 'view', '505', '--json', 'assignees']],
      ['gh', ['pr', 'edit', '505', '--add-assignee', 'author']],
    ]);
    expect(log).toHaveBeenCalledWith('::error::gh pr edit label failed: label failed');
    expect(process.exitCode).toBe(1);
  });

  it('reports assignment failure after a successful label call', async () => {
    setPr('fix: change', []);
    vi.mocked(spawnSync).mockImplementationOnce(() => success()).mockImplementationOnce(() => ({ status: 0, stdout: '{"assignees":[]}', stderr: '' } as ReturnType<typeof spawnSync>)).mockImplementationOnce(() => ({ status: 1, stdout: '', stderr: 'assignee failed' } as ReturnType<typeof spawnSync>));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runMain();
    expect(spawnSync).toHaveBeenCalledTimes(3);
    expect(vi.mocked(spawnSync).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['gh', ['pr', 'edit', '505', '--add-label', 'type: bug']],
      ['gh', ['pr', 'view', '505', '--json', 'assignees']],
      ['gh', ['pr', 'edit', '505', '--add-assignee', 'author']],
    ]);
    expect(log).toHaveBeenCalledWith('::error::gh pr edit assignee failed: assignee failed');
    expect(process.exitCode).toBe(1);
  });

  it('reports a spawn launch failure with null status without throwing', async () => {
    setPr('fix: change', ['human']);
    vi.mocked(spawnSync).mockImplementationOnce(() => ({ status: null, error: new Error('spawn gh ENOENT'), stdout: '', stderr: '' } as ReturnType<typeof spawnSync>));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runMain();
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(vi.mocked(spawnSync).mock.calls[0]?.slice(0, 2)).toEqual([
      'gh', ['pr', 'edit', '505', '--add-label', 'type: bug'],
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/::error::.*gh pr edit/));
    expect(process.exitCode).toBe(1);
  });

  it('uses defensive defaults when all workflow environment variables are unset', async () => {
    delete process.env.PR_TITLE;
    delete process.env.PR_NUMBER;
    delete process.env.PR_AUTHOR;
    vi.mocked(spawnSync).mockImplementation((_cmd, args) => args?.[1] === 'view'
      ? { status: 0, stdout: '{"assignees":[]}', stderr: '' } as ReturnType<typeof spawnSync>
      : success());
    await expect(runMain()).resolves.toBeUndefined();
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(vi.mocked(spawnSync).mock.calls[0]?.slice(0, 2)).toEqual(['gh', ['pr', 'view', '', '--json', 'assignees']]);
    expect(vi.mocked(spawnSync).mock.calls[1]?.slice(0, 2)).toEqual([
      'gh', ['pr', 'edit', '', '--add-assignee', ''],
    ]);
  });

  it('skips assignment and reports a failed assignee lookup', async () => {
    setPr('fix: change', []);
    vi.mocked(spawnSync).mockImplementationOnce(() => success()).mockImplementationOnce(() => ({ status: 1, stdout: '', stderr: 'lookup failed' } as ReturnType<typeof spawnSync>));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runMain();
    expect(vi.mocked(spawnSync).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['gh', ['pr', 'edit', '505', '--add-label', 'type: bug']],
      ['gh', ['pr', 'view', '505', '--json', 'assignees']],
    ]);
    expect(log).toHaveBeenCalledWith('::error::gh pr view assignees failed: lookup failed');
    expect(process.exitCode).toBe(1);
  });

  it('skips assignment and reports unparseable assignee lookup output', async () => {
    setPr('fix: change', []);
    vi.mocked(spawnSync).mockImplementationOnce(() => success()).mockImplementationOnce(() => ({ status: 0, stdout: 'not JSON', stderr: '' } as ReturnType<typeof spawnSync>));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runMain();
    expect(vi.mocked(spawnSync).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['gh', ['pr', 'edit', '505', '--add-label', 'type: bug']],
      ['gh', ['pr', 'view', '505', '--json', 'assignees']],
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^::error::gh pr view assignees failed: /));
    expect(process.exitCode).toBe(1);
  });
});
