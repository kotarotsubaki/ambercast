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

describe('command enumeration', () => {
  it('flags the exact historical four-command claim in three locales', async () => {
    const paths = ['', 'ja/', 'zh-cn/'].map((locale) => `website/src/content/docs/${locale}reference/cli/view.md`);
    const lines = [
      'CLI parser accepts only `generate`, `run`, `check`, and `heal`, and rejects any other command. Its planned role as a local results viewer is established in the viewer design.',
      '`ambercast view` は 0.3.1 では実装されていません。現在のコマンドパーサーは `generate`、`run`、`check`、`heal` のみを受け付け、それ以外のコマンドは拒絶します。本コマンドが担うローカルビューアとしての役割は、計画されているビューア設計で定義されています。',
      '仅接受 `generate`、`run`、`check` 和 `heal`，并会拒绝任何其他命令。',
    ];
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
    ['only. It accepts exactly `generate`, `run`, `check`, and `heal`.', 'website/src/content/docs/reference/cli/view.md'],
    ['Context. 仅 `generate`、`run`、`check`、`heal`', 'website/src/content/docs/zh-cn/reference/cli/view.md'],
    ['`generate`、`run`、`check`、`heal` のみ。Context', 'website/src/content/docs/ja/reference/cli/view.md'],
  ])('flags a marker despite unrelated punctuation: %s', async (source, path) => {
    const f = fixture('', { [path]: source });
    expect((await checkClaims({ repoRoot: f.root })).filter((entry) => entry.rule === 'command-enumeration')).toHaveLength(1);
  });

  it('does not flag the historical five-command operating contracts or Japanese file layout', async () => {
    const cases = [
      ['website/src/content/docs/agents/operating-contract.md', 'This operating contract defines the action boundaries, preconditions, side effects, and safe follow-up actions for invoking ambercast commands. The CLI parser exposes exactly five implemented commands: `init`, `generate`, `run`, `check`, and `heal`.'],
      ['website/src/content/docs/agents/operating-contract.md', 'Before invoking a command, verify its preconditions and expected side effects to decide whether you can execute it safely. The parser exposes exactly `init`, `generate`, `run`, `check`, and `heal` as implemented commands.'],
      ['website/src/content/docs/ja/agents/operating-contract.md', 'パーサーが実装済みコマンドとして公開しているのは、`init`、`generate`、`run`、`check`、`heal` の5つのコマンドのみです。`check` は、変更可能なストレージ、AIプロバイダー、またはブラウザーへの依存関係を持ちません。heal は確認が行われるまで plan および grounding コンパニオンの変更のみをバッファリングします。ただし、そのリプレイ試行では承認前や dry run の実行中であっても、ケース実行ディレクトリ内に包含されたエビデンスを書き込む場合があります。'],
      ['website/src/content/docs/zh-cn/agents/operating-contract.md', 'ambercast 解析器所公开实现的命令恰好为 `init`、`generate`、`run`、`check` 与 `heal`。本页为 AI Agent 提供调用这些命令时的动作边界、前提条件、副作用以及所需的批准规则，帮助您判断是否能够安全地调用相应命令。'],
      ['website/src/content/docs/ja/reference/file-layout.md', '`report.json` を永続化するのは `run` のみです。`generate`、`check`、および `heal` は、このレイアウト書き込みを行わずにエンベロープを返します。'],
    ] as const;
    const files = Object.fromEntries(cases.map(([path, line], index) => [`${path.slice(0, -3)}-${index}.md`, line]));
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
    ['/ambercast/reference/cli/view/?x=1', '# View\n'],
    ['/ambercast/reference/cli/view/?v=1.0', '# View\n'],
  ])('resolves %s', async (url, page) => {
    const f = fixture(`[link](${url})`, { 'website/src/content/docs/reference/cli/view.md': page });
    expect((await checkClaims({ repoRoot: f.root })).filter((entry) => entry.rule.startsWith('link-'))).toEqual([]);
  });

  it('rejects a path that traverses outside the public root', async () => {
    const f = fixture('[link](/ambercast/../package.json)', { 'website/package.json': '{}' });
    expect((await checkClaims({ repoRoot: f.root })).filter((entry) => entry.rule === 'link-missing-artifact')).toHaveLength(1);
  });

  it('does not accept data-id as a fragment anchor', async () => {
    const f = fixture('[link](/ambercast/reference/cli/view/#x)', {
      'website/src/content/docs/reference/cli/view.md': '<span data-id="x"></span>\n',
    });
    expect((await checkClaims({ repoRoot: f.root })).filter((entry) => entry.rule === 'link-missing-fragment')).toHaveLength(1);
  });

  it('does not accept an id attribute inside a fenced code block as an anchor', async () => {
    const f = fixture('[link](/ambercast/reference/cli/view/#x)', {
      'website/src/content/docs/reference/cli/view.md': '```html\n<span id="x"></span>\n```\n',
    });
    expect((await checkClaims({ repoRoot: f.root })).filter((entry) => entry.rule === 'link-missing-fragment')).toHaveLength(1);
  });

  it.each([
    ['inline code', '`<span id="x"></span>`\n'],
    ['indented code', '    <a id="x">\n'],
    ['an HTML comment', '<!-- <a id="x"> -->\n'],
    ['another attribute value', '<span title=\'id="x"\'>\n'],
  ])('does not accept an id inside %s as a fragment anchor', async (_context, page) => {
    const f = fixture('[link](/ambercast/reference/cli/view/#x)', {
      'website/src/content/docs/reference/cli/view.md': page,
    });
    expect((await checkClaims({ repoRoot: f.root })).filter((entry) => entry.rule === 'link-missing-fragment')).toHaveLength(1);
  });

  it.each([
    ['a block HTML tag', '<a id="x"></a>\n'],
    ['a single-quoted id attribute', "<a id='x'>\n"],
  ])('resolves a fragment anchor in %s', async (_context, page) => {
    const f = fixture('[link](/ambercast/reference/cli/view/#x)', {
      'website/src/content/docs/reference/cli/view.md': page,
    });
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

  it('reports a non-array allowlist as a violation with exit 1', () => {
    const f = fixture('# Clean\n', { 'website/docs-audit-allowlist.json': '{}' });
    const result = run(f.root);
    expect(result.status).toBe(1);
    expect(result.stdout.trim().split('\n').map((line) => JSON.parse(line).rule)).toContain('allowlist-invalid');
  });

  it.each([
    ['hard rule with advisory name', { ...entry(), rule: 'planned-claim' }],
    ['advisory rule with hard name', { ...entry(), scope: 'advisory', rule: 'command-enumeration' }],
    ['uppercase claim hash', { ...entry(), claimHash: 'ABCDEF0123456789' }],
    ['short claim hash', { ...entry(), claimHash: '01234567' }],
  ])('rejects %s', async (_label, invalid) => {
    const f = fixture('# Clean\n', { 'website/docs-audit-allowlist.json': JSON.stringify([invalid]) });
    expect((await checkClaims({ repoRoot: f.root })).filter((entry) => entry.rule === 'allowlist-invalid')).toHaveLength(1);
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

  it('exits 2 without partial JSONL when a source file is unreadable', (context) => {
    const f = fixture('source');
    const sourcePath = `${f.root}/README.md`;
    chmodSync(sourcePath, 0);
    let directReadError: unknown;
    try {
      readFileSync(sourcePath, 'utf8');
    } catch (error) {
      directReadError = error;
    }
    if (directReadError === undefined) {
      context.skip('File permissions are not enforced; cannot exercise the source-file read error.');
      return;
    }
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
