import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createDocsFixture, runEntryPoint } from './cli-fixture.ts';
import { claimHash, normalizeClaimLine } from '../scripts/lib/docs-corpus.mjs';

const fixtures: ReturnType<typeof createDocsFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.dispose()));
const script = new URL('../scripts/docs-impact.mjs', import.meta.url);
const current = { commands: ['init', 'generate', 'run', 'check', 'heal'], planned: ['view', 'review', 'mcp', 'baseline', 'restore'] };
const old = { commands: ['generate', 'run', 'check', 'heal'], planned: ['view', 'review', 'mcp', 'baseline', 'restore'] };

function fixture(files: Record<string, string> = {}) {
  const result = createDocsFixture({
    'README.md': '`init`\nevery implemented command\nThere is no `init` command yet\n',
    'website/public/capabilities.json': JSON.stringify(current),
    'website/docs-audit-allowlist.json': '[]',
    'test/fixtures/capabilities.json': JSON.stringify(current),
    'test/fixtures/cli-manifest.json': JSON.stringify({ commands: current.commands.map((name) => ({ name, flags: [] })) }),
    'test/fixtures/config-schema.json': JSON.stringify({ type: 'object', properties: {} }),
    ...files,
  });
  fixtures.push(result);
  return result;
}

function run(root: string, args: string[]) {
  return runEntryPoint(script, root, ['--repo-root', root, ...args]);
}

function records(stdout: string): Array<{ id: string; rule: string; path: string; identifier: string }> {
  return stdout.trim() ? stdout.trim().split('\n').map((line) => JSON.parse(line)) : [];
}

function git(root: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function commit(root: string, message: string) {
  git(root, 'add', '.');
  git(root, '-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', 'commit', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

function gitFixture(baseCapabilities = old) {
  const f = fixture({
    'test/fixtures/capabilities.json': JSON.stringify(baseCapabilities),
    'test/fixtures/cli-manifest.json': JSON.stringify({ commands: baseCapabilities.commands.map((name) => ({ name, flags: [] })) }),
  });
  git(f.root, 'init');
  const base = commit(f.root, 'base');
  return { f, base };
}

describe('docs-impact prospective mode', () => {
  it('needs no git and emits stable identifier-hit ids', () => {
    const f = fixture();
    const args = ['--prospective', '--identifier', 'command:init'];
    const first = run(f.root, args);
    const second = run(f.root, args);
    expect(first.status).toBe(0);
    expect(records(first.stdout).some((entry) => entry.rule === 'identifier-hit' && entry.identifier === 'command:init')).toBe(true);
    expect(records(first.stdout).map((entry) => entry.id)).toEqual(records(second.stdout).map((entry) => entry.id));
  });

  it('matches a single-dash flag alias without matching a different long flag', () => {
    const f = fixture({ 'README.md': 'Run `ambercast init -y` to accept the defaults.\n' });
    const result = run(f.root, ['--prospective', '--identifier', 'flag:init:--y', '--identifier', 'flag:init:--yes']);
    expect(result.status).toBe(0);
    const hits = records(result.stdout).filter((entry) => entry.rule === 'identifier-hit');
    expect(hits.map(({ identifier }) => identifier)).toEqual(['flag:init:--y']);
  });

  it.each([
    ['missing identifier', ['--prospective']],
    ['conflicting modes', ['--prospective', '--actual', '--base', 'HEAD', '--identifier', 'command:init']],
    ['duplicate identifier', ['--prospective', '--identifier', 'command:init', '--identifier', 'command:init']],
    ['identifier without kind', ['--prospective', '--identifier', 'init']],
    ['unknown identifier kind', ['--prospective', '--identifier', 'unknown:init']],
    ['missing base', ['--actual']],
  ])('exits 2 with empty stdout for %s', (_label, args) => {
    const f = fixture();
    const result = run(f.root, args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });

  it.each([
    ['missing plan', 'missing.md'],
    ['missing section', 'missing-section.md'],
    ['missing No candidates', 'missing-empty.md'],
    ['malformed disposition', 'malformed.md'],
  ])('reports plan-invalid for %s even with zero identifiers', (_label, plan) => {
    const f = fixture({
      'README.md': '# Clean\n',
      'missing-section.md': '# Plan\n',
      'missing-empty.md': '## Docs impact\n',
      'malformed.md': '## Docs impact\n- malformed\n',
    });
    const result = run(f.root, ['--prospective', '--identifier', 'command:absent', '--plan', `${f.root}/${plan}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/plan-invalid/);
  });

  it('accepts complete dispositions and reports a missing one', () => {
    const f = fixture();
    const initial = records(run(f.root, ['--prospective', '--identifier', 'command:init']).stdout);
    expect(initial.length).toBeGreaterThan(0);
    const disposition = initial.map(({ id }) => `- ${id}: keep — reviewed`).join('\n');
    const complete = fixture({ ...{ 'README.md': f.read('README.md') }, 'impact.md': `## Docs impact\n${disposition}\n` });
    expect(run(complete.root, ['--prospective', '--identifier', 'command:init', '--plan', `${complete.root}/impact.md`]).status).toBe(0);
    const incomplete = fixture({ 'impact.md': '## Docs impact\nNo candidates.\n' });
    const result = run(incomplete.root, ['--prospective', '--identifier', 'command:init', '--plan', `${incomplete.root}/impact.md`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/undisposed /);
  });

  it('does not let a hard allowlist entry suppress advisory candidates', () => {
    const text = 'There is no `init` command yet';
    const allowlist = [{ scope: 'hard', rule: 'planned-claim', path: 'README.md', claimHash: claimHash(normalizeClaimLine(text)), reason: 'legacy', owner: 'docs', removeWhen: 'updated' }];
    const f = fixture({ 'README.md': text, 'website/docs-audit-allowlist.json': JSON.stringify(allowlist) });
    expect(records(run(f.root, ['--prospective', '--identifier', 'command:init']).stdout).some((entry) => entry.rule === 'planned-claim')).toBe(true);
  });

  it('emits stale advisory entries when no raw claim matches, even without command changes', () => {
    const allowlist = [{ scope: 'advisory', rule: 'planned-claim', path: 'README.md', claimHash: '0000000000000000', reason: 'legacy', owner: 'docs', removeWhen: 'updated' }];
    const f = fixture({ 'README.md': '# Clean', 'website/docs-audit-allowlist.json': JSON.stringify(allowlist) });
    expect(records(run(f.root, ['--prospective', '--identifier', 'config:unrelated']).stdout).some((entry) => entry.rule === 'allowlist-stale')).toBe(true);
  });

  it('suppresses only the matching advisory planned claim', () => {
    const text = 'There is no `init` command yet';
    const allowlist = [{ scope: 'advisory', rule: 'planned-claim', path: 'README.md', claimHash: claimHash(normalizeClaimLine(text)), reason: 'legacy', owner: 'docs', removeWhen: 'updated' }];
    const f = fixture({ 'README.md': text, 'website/docs-audit-allowlist.json': JSON.stringify(allowlist) });
    const output = records(run(f.root, ['--prospective', '--identifier', 'command:init']).stdout);
    expect(output.some((entry) => entry.rule === 'planned-claim')).toBe(false);
    expect(output.some((entry) => entry.rule === 'identifier-hit')).toBe(true);
  });
});

describe('docs-impact actual mode', () => {
  it('finds unchanged-file identifier hits, planned and universal claims, excluding changed files', () => {
    const { f, base } = gitFixture();
    writeFileSync(`${f.root}/test/fixtures/capabilities.json`, JSON.stringify(current));
    writeFileSync(`${f.root}/test/fixtures/cli-manifest.json`, JSON.stringify({ commands: current.commands.map((name) => ({ name, flags: [] })) }));
    writeFileSync(`${f.root}/CONTRIBUTING.md`, '`init` changed file\n');
    commit(f.root, 'add init');
    const result = run(f.root, ['--actual', '--base', base]);
    expect(result.status).toBe(0);
    const output = records(result.stdout);
    expect(output.some((entry) => entry.rule === 'identifier-hit' && entry.path === 'README.md')).toBe(true);
    expect(output.some((entry) => entry.rule === 'identifier-hit' && entry.path === 'CONTRIBUTING.md')).toBe(false);
    expect(output.some((entry) => entry.rule === 'universal-claim')).toBe(true);
    expect(output.some((entry) => entry.rule === 'planned-claim')).toBe(true);
  });

  it('rejects an unresolvable base before writing candidates', () => {
    const { f } = gitFixture();
    const result = run(f.root, ['--actual', '--base', 'does-not-exist']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });

  it.each([
    ['planned to command', { commands: ['generate', 'run', 'check', 'heal'], planned: ['init', 'view'] }, { commands: ['init', 'generate', 'run', 'check', 'heal'], planned: ['view'] }],
    ['command to planned', { commands: ['init', 'generate', 'run', 'check', 'heal'], planned: ['view'] }, { commands: ['generate', 'run', 'check', 'heal'], planned: ['init', 'view'] }],
  ])('treats %s as two changed identifiers', (_label, before, after) => {
    const { f, base } = gitFixture(before);
    writeFileSync(`${f.root}/test/fixtures/capabilities.json`, JSON.stringify(after));
    writeFileSync(`${f.root}/test/fixtures/cli-manifest.json`, JSON.stringify({ commands: after.commands.map((name) => ({ name, flags: [] })) }));
    const result = run(f.root, ['--actual', '--base', base]);
    expect(result.status).toBe(0);
    const hits = records(result.stdout).filter((record) => record.rule === 'identifier-hit');
    expect(hits).toHaveLength(2);
    expect(hits.map(({ identifier, path, rule }) => ({ identifier, path, rule }))).toEqual(expect.arrayContaining([
      { identifier: 'planned:init', path: 'README.md', rule: 'identifier-hit' },
      { identifier: 'command:init', path: 'README.md', rule: 'identifier-hit' },
    ]));
  });

  it('omits universal claims when commands and flags are unchanged', () => {
    const { f, base } = gitFixture(current);
    writeFileSync(`${f.root}/test/fixtures/config-schema.json`, JSON.stringify({ type: 'object', properties: { added: { type: 'string' } } }));
    const output = records(run(f.root, ['--actual', '--base', base]).stdout);
    expect(output.filter((record) => record.rule === 'universal-claim')).toEqual([]);
  });

  it('exits 2 with empty stdout when a working-tree snapshot is unreadable', () => {
    const { f, base } = gitFixture();
    writeFileSync(`${f.root}/test/fixtures/capabilities.json`, '{');
    const result = run(f.root, ['--actual', '--base', base]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });

  it('exits 2 with empty stdout when the allowlist is missing', () => {
    const f = fixture();
    rmSync(`${f.root}/website/docs-audit-allowlist.json`);
    const result = run(f.root, ['--prospective', '--identifier', 'command:init']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });
});
