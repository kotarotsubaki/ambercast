import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkClaims } from '../scripts/check-claims.mjs';
import { claimHash, normalizeClaimLine } from '../scripts/lib/docs-corpus.mjs';
import { createDocsFixture, runEntryPoint } from './cli-fixture.ts';

const fixtures: ReturnType<typeof createDocsFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.dispose()));
const script = new URL('../scripts/check-claims.mjs', import.meta.url);
const capabilities = { commands: ['init', 'generate', 'run', 'check', 'heal'], planned: ['view', 'review', 'mcp', 'baseline', 'restore'] };

function fixture(source: string, extra: Record<string, string> = {}) {
  const result = createDocsFixture({
    'README.md': source,
    'website/public/capabilities.json': JSON.stringify(capabilities),
    'website/docs-audit-allowlist.json': '[]',
    ...extra,
  });
  fixtures.push(result);
  return result;
}

function run(root: string, args: string[] = []) {
  return runEntryPoint(script, root, ['--repo-root', root, ...args]);
}

function historicalLine(ref: string, path: string, fragment: string) {
  const result = spawnSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  const line = result.stdout.split('\n').find((value) => value.includes(fragment));
  if (!line) throw new Error(`missing historical line ${ref}:${path}`);
  return line;
}

describe('command enumeration', () => {
  it('flags the exact historical four-command claim in three locales', async () => {
    const paths = ['', 'ja/', 'zh-cn/'].map((locale) => `website/src/content/docs/${locale}reference/cli/view.md`);
    const fragments = ['CLI parser accepts only', 'のみを受け付け', '仅接受'];
    const lines = paths.map((path, index) => {
      const line = historicalLine('7aca08a', path, fragments[index]!);
      return index === 0 ? line.slice(line.indexOf('CLI parser accepts only')) : index === 2 ? line.slice(line.indexOf('仅接受')) : line;
    });
    const f = fixture('', Object.fromEntries(paths.map((path, index) => [path, lines[index]!] )));
    const violations = await checkClaims({ repoRoot: f.root });
    expect(violations.filter((entry) => entry.rule === 'command-enumeration')).toHaveLength(3);
  });

  it.each([
    'only `baseline` and `restore`',
    '`generate`, `run`, `check`, `heal` loop',
    'only. `generate`, `run`, `check`, and `heal`',
    '```text\nonly `generate`, `run`, `check`, and `heal`\n```',
  ])('does not flag an excluded enumeration: %s', async (source) => {
    const f = fixture(source);
    expect((await checkClaims({ repoRoot: f.root })).filter((entry) => entry.rule === 'command-enumeration')).toEqual([]);
  });

  it.each([
    ['Context. only `generate`, `run`, `check`, `heal`', 'website/src/content/docs/reference/cli/view.md'],
    ['Context. 仅 `generate`、`run`、`check`、`heal`', 'website/src/content/docs/zh-cn/reference/cli/view.md'],
    ['`generate`、`run`、`check`、`heal` のみ。Context', 'website/src/content/docs/ja/reference/cli/view.md'],
  ])('flags a marker despite unrelated punctuation: %s', async (source, path) => {
    const f = fixture('', { [path]: source });
    expect((await checkClaims({ repoRoot: f.root })).filter((entry) => entry.rule === 'command-enumeration')).toHaveLength(1);
  });

  it('does not flag the historical five-command operating contracts or Japanese file layout', async () => {
    const cases = [
      ['website/src/content/docs/agents/operating-contract.md', 'The CLI parser exposes exactly five implemented commands'],
      ['website/src/content/docs/agents/operating-contract.md', 'The parser exposes exactly `init`'],
      ['website/src/content/docs/ja/agents/operating-contract.md', 'の5つのコマンドのみ'],
      ['website/src/content/docs/zh-cn/agents/operating-contract.md', '命令恰好为 `init`'],
      ['website/src/content/docs/ja/reference/file-layout.md', '`run` のみです。`generate`'],
    ] as const;
    const files = Object.fromEntries(cases.map(([path, fragment], index) => [`${path.slice(0, -3)}-${index}.md`, historicalLine('7f4b0a8', path, fragment)]));
    const f = fixture('', files);
    expect((await checkClaims({ repoRoot: f.root })).filter((entry) => entry.rule === 'command-enumeration')).toEqual([]);
  });
});

describe('site links', () => {
  it.each([
    ['/ambercast/missing/', 'link-missing-page'],
    ['/ambercast/reference/cli/view/#missing', 'link-missing-fragment'],
    ['/ambercast/absent.json', 'link-missing-artifact'],
    ['/ambercast/reference/cli/view/#x', 'link-missing-fragment'],
  ])('classifies %s as %s', async (url, rule) => {
    const target = url.endsWith('#x') ? '## Title `{#x}`\n' : '## Title {#flags}\n';
    const f = fixture(`[link](${url})`, { 'website/src/content/docs/reference/cli/view.md': target });
    expect((await checkClaims({ repoRoot: f.root })).filter((entry) => entry.rule === rule)).toHaveLength(1);
  });

  it.each([
    ['/ambercast/reference/cli/view/#flags', '## Flags {#flags}\n'],
    ['/ambercast/reference/cli/view/#hello-code-world', '## Hello *Code* `World`\n'],
    ['/ambercast/reference/cli/view/#repeat-1', '## Repeat\n## Repeat\n'],
    ['/ambercast/reference/cli/view/#x', '<span id="x"></span>\n'],
    ['/ambercast/reference/cli/view', '# View\n'],
    ['https://kotarotsubaki.github.io/ambercast/reference/cli/view/', '# View\n'],
  ])('resolves %s', async (url, page) => {
    const f = fixture(`[link](${url})`, { 'website/src/content/docs/reference/cli/view.md': page });
    expect((await checkClaims({ repoRoot: f.root })).filter((entry) => entry.rule.startsWith('link-'))).toEqual([]);
  });

  it('resolves spec and generated/public artifacts and ignores fenced links', async () => {
    const f = fixture('[spec](/ambercast/spec/example/) [public](/ambercast/capabilities.json) [generated](/ambercast/ja/llms.txt)\n```md\n[missing](/ambercast/never/)\n```', {
      'docs/spec/example.md': '# Example\n',
    });
    expect((await checkClaims({ repoRoot: f.root })).filter((entry) => entry.rule.startsWith('link-'))).toEqual([]);
  });
});

describe('allowlist and CLI contract', () => {
  const stale = 'only `generate`, `run`, `check`, and `heal`';
  const entry = () => ({ scope: 'hard', rule: 'command-enumeration', path: 'README.md', claimHash: claimHash(normalizeClaimLine(stale)), reason: 'temporary legacy text', owner: 'docs', removeWhen: 'the prose is updated' });

  it('suppresses a matching hard finding and rejects a stale hash', async () => {
    const matching = fixture(stale, { 'website/docs-audit-allowlist.json': JSON.stringify([entry()]) });
    expect((await checkClaims({ repoRoot: matching.root })).filter((v) => v.rule === 'command-enumeration')).toEqual([]);
    const unmatched = fixture(stale, { 'website/docs-audit-allowlist.json': JSON.stringify([{ ...entry(), claimHash: '0000000000000000' }]) });
    const rules = (await checkClaims({ repoRoot: unmatched.root })).map((v) => v.rule);
    expect(rules).toContain('command-enumeration');
    expect(rules).toContain('allowlist-stale');
  });

  it.each(['missing-reason', 'identifier-hit'])('rejects invalid entries: %s', async (caseName) => {
    const entries = [caseName === 'missing-reason' ? { ...entry(), reason: '' } : { ...entry(), rule: 'identifier-hit' }];
    const f = fixture(stale, { 'website/docs-audit-allowlist.json': JSON.stringify(entries) });
    expect((await checkClaims({ repoRoot: f.root })).map((v) => v.rule)).toContain('allowlist-invalid');
  });

  it('writes JSONL for a finding and scan counts to stderr', () => {
    const f = fixture(stale);
    const result = run(f.root);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout.trim()).rule).toBe('command-enumeration');
    expect(result.stderr).toMatch(/scanned 1 source files, 0 links/);
  });

  it('exits zero for a clean source', () => {
    const f = fixture('# Clean\n');
    const result = run(f.root);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/scanned 1 source files, 0 links/);
  });

  it.each([
    ['invalid capabilities', { 'website/public/capabilities.json': '{' }],
    ['invalid allowlist', { 'website/docs-audit-allowlist.json': '{' }],
  ])('leaves stdout empty and exits 2 for %s', (_name, replacement) => {
    const f = fixture('source', replacement);
    const result = run(f.root);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/check-claims: cannot read/);
  });

  it.each(['website/public/capabilities.json', 'website/docs-audit-allowlist.json'])('exits 2 when %s is missing', (path) => {
    const f = fixture('source');
    rmSync(`${f.root}/${path}`);
    const result = run(f.root);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(path);
  });

  it('exits 2 without partial JSONL when a source file is unreadable', () => {
    const f = fixture('source');
    chmodSync(`${f.root}/README.md`, 0);
    const result = run(f.root);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/cannot read.*README\.md/);
  });

  it('does not let an advisory entry suppress a hard finding', async () => {
    const allowlist = [{ ...entry(), scope: 'advisory' }];
    const f = fixture(stale, { 'website/docs-audit-allowlist.json': JSON.stringify(allowlist) });
    expect((await checkClaims({ repoRoot: f.root })).map((v) => v.rule)).toContain('command-enumeration');
  });

  it('rejects malformed CLI arguments without findings', () => {
    const f = fixture('source');
    const result = run(f.root, ['--unknown']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });
});

it('scans the real documentation corpus within the unit-test timeout', async () => {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const findings = await checkClaims({ repoRoot });
  expect(findings.filter((entry) => entry.rule === 'command-enumeration')).toHaveLength(0);

  const livePage = readFileSync(`${repoRoot}/website/src/content/docs/reference/mcp-tools.md`, 'utf8');
  const currentLine = livePage.split('\n').find((line) => line.includes('The CLI parser accepts only `generate`'));
  expect(currentLine).toBeDefined();
  const staleLine = currentLine!.slice(currentLine!.indexOf('The CLI parser accepts only')).replace(', and `init`', '');
  expect(staleLine).not.toBe(currentLine);
  const control = fixture(staleLine);
  expect((await checkClaims({ repoRoot: control.root })).filter((entry) => entry.rule === 'command-enumeration')).toHaveLength(1);
}, 10_000);
