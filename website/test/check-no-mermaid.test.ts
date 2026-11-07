import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { MERMAID_MESSAGE, checkNoMermaid } from '../scripts/check-no-mermaid.mjs';

const scriptPath = fileURLToPath(new URL('../scripts/check-no-mermaid.mjs', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const temporaryRoots: string[] = [];

/** A temporary tree with the same layout the CLI resolves from `website/`. */
function makeTree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'ambercast-no-mermaid-'));
  temporaryRoots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const roots = (root: string) => [
  join(root, 'website/src/content/docs'),
  join(root, 'docs'),
  join(root, 'skills'),
  join(root, '.agents/skills/docs-writing/references'),
];

const scan = async (files: Record<string, string>) => {
  const root = makeTree(files);
  return { root, findings: await checkNoMermaid({ roots: roots(root) }) };
};

const PAGE = 'website/src/content/docs/page.md';
const fence = (info: string, marker = '```') => `${marker}${info}\ngraph TD\nA-->B\n${marker}\n`;

afterEach(() => {
  while (temporaryRoots.length) rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
});

describe('checkNoMermaid rejects Mermaid fences', () => {
  it.each([
    ['backtick fence', fence('mermaid')],
    ['tilde fence', fence('mermaid', '~~~')],
    ['long backtick fence', fence('mermaid', '`````')],
    ['fence with alt metadata', fence('mermaid alt="Diagram"')],
    ['fence with padding before the info string', fence(' mermaid')],
    ['fence indented by three spaces', `   ${fence('mermaid')}`],
    ['fence inside a blockquote', '> ```mermaid\n> graph TD\n> ```\n'],
    ['fence inside a nested blockquote', '> > ```mermaid\n> > graph TD\n> > ```\n'],
    ['fence inside a bullet item', '- ```mermaid\n  graph TD\n  ```\n'],
    ['fence inside a numbered item', '1. ```mermaid\n   graph TD\n   ```\n'],
    ['fence indented four spaces inside a list item', '- item\n\n    ```mermaid\n    graph TD\n    ```\n'],
    ['unclosed fence', '```mermaid\ngraph TD\nA-->B\n'],
    ['opening line at the end of the file without a line end', '```mermaid'],
    ['blockquote followed by a list marker', '> - ```mermaid\n>   graph TD\n>   ```\n'],
    ['list marker followed by a blockquote', '- > ```mermaid\n  > graph TD\n  > ```\n'],
    ['tab after the language token', '```mermaid\talt="x"\ngraph TD\n```\n'],
    ['fence shown inside a longer outer fence', '````md\n```mermaid\ngraph TD\n```\n````\n'],
  ])('%s', async (_name, body) => {
    const { root, findings } = await scan({ [PAGE]: `# Title\n\n${body}` });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({ rule: 'mermaid-fence', page: join(root, PAGE), line: 3 + (body.split('\n').findIndex((line) => /mermaid/.test(line))), message: MERMAID_MESSAGE });
  });

  it('points the author to the ac-flow figure', () => {
    expect(MERMAID_MESSAGE).toContain('ac-flow');
  });

  it('finds a Mermaid fence that follows a normal fence in an LF file', async () => {
    const { findings } = await scan({ [PAGE]: `${fence('txt')}\n${fence('mermaid')}` });
    expect(findings.map((finding) => finding.line)).toEqual([6]);
  });

  it('finds a Mermaid fence that follows a normal fence in a CRLF file', async () => {
    const source = `${fence('txt')}\n${fence('mermaid')}`.replace(/\n/g, '\r\n');
    const { findings } = await scan({ [PAGE]: source });
    expect(findings.map((finding) => finding.line)).toEqual([6]);
  });

  it('finds a Mermaid fence after a normal fence closed with extra indentation', async () => {
    const { findings } = await scan({ [PAGE]: '```txt\ncode\n  ```\n\n```mermaid\ngraph TD\n```\n' });
    expect(findings.map((finding) => finding.line)).toEqual([5]);
  });

  it('finds a Mermaid fence after an invalid backtick info line', async () => {
    const { findings } = await scan({ [PAGE]: '```a`b\n\n```mermaid\ngraph TD\n```\n' });
    expect(findings.map((finding) => finding.line)).toEqual([3]);
  });

  it('reports every opening line in one file in order', async () => {
    const { findings } = await scan({ [PAGE]: `${fence('mermaid')}\n${fence('txt')}\n${fence('mermaid', '~~~')}` });
    expect(findings.map((finding) => finding.line)).toEqual([1, 11]);
  });

  it('counts mixed LF and CRLF line ends as single lines', async () => {
    const { findings } = await scan({ [PAGE]: 'one\r\ntwo\nthree\r\n```mermaid\r\nx\r\n```\r\n' });
    expect(findings.map((finding) => finding.line)).toEqual([4]);
  });

  it.each([
    ['md under the site docs', 'website/src/content/docs/ja/guide.md'],
    ['mdx under the site docs', 'website/src/content/docs/zh-cn/guide.mdx'],
    ['nested spec source', 'docs/spec/nested/overview.md'],
    ['bundled skill', 'skills/ambercast/SKILL.md'],
    ['skill reference sample', '.agents/skills/docs-writing/references/blocks.mdx'],
  ])('scans %s', async (_name, path) => {
    const { root, findings } = await scan({ [path]: fence('mermaid') });
    expect(findings).toEqual([{ rule: 'mermaid-fence', page: join(root, path), line: 1, message: MERMAID_MESSAGE }]);
  });

  it('keeps same-named files under different roots distinguishable', async () => {
    const { root, findings } = await scan({ 'docs/a.md': fence('mermaid'), 'skills/a.md': fence('mermaid') });
    expect(findings.map((finding) => finding.page).sort()).toEqual([join(root, 'docs/a.md'), join(root, 'skills/a.md')]);
  });
});

describe('checkNoMermaid accepts other content', () => {
  it.each([
    ['normal fences', fence('txt') + fence('ts') + fence('')],
    ['an info string that only starts with mermaid', fence('mermaidx')],
    ['a differently cased language', fence('Mermaid')],
    ['a hyphenated language that starts with mermaid', fence('mermaid-extra')],
    ['a two-character backtick opening', '``mermaid\ngraph TD\n``\n'],
    ['a two-character tilde opening', '~~mermaid\ngraph TD\n~~\n'],
    ['a language with mermaid as a later token', fence('txt mermaid')],
    ['the word in prose', 'Do not use Mermaid for diagrams.\n'],
    ['an inline code mention', 'Write `mermaid` fences? No.\n'],
    ['a three-backtick span that is not at line start', 'See ```mermaid in the middle of a line.\n'],
    ['an ac-flow figure', '<figure class="ac-flow" aria-label="x"><div>a</div></figure>\n'],
  ])('%s', async (_name, body) => {
    const { findings } = await scan({ [PAGE]: body });
    expect(findings).toEqual([]);
  });

  it('ignores files that are not md or mdx', async () => {
    const { findings } = await scan({ 'website/src/content/docs/data.json': fence('mermaid'), 'docs/notes.txt': fence('mermaid') });
    expect(findings).toEqual([]);
  });

  it('skips a root that does not exist', async () => {
    const root = makeTree({ [PAGE]: 'ok\n' });
    expect(await checkNoMermaid({ roots: [join(root, 'missing'), ...roots(root)] })).toEqual([]);
  });

  it('keeps scanning the roots after a missing one', async () => {
    const root = makeTree({ 'docs/a.md': fence('mermaid') });
    const findings = await checkNoMermaid({ roots: [join(root, 'missing'), join(root, 'docs')] });
    expect(findings.map((finding) => finding.page)).toEqual([join(root, 'docs/a.md')]);
  });

  it('returns no findings for no roots', async () => {
    expect(await checkNoMermaid({ roots: [] })).toEqual([]);
  });

  it('reports no violation in the repository content', async () => {
    const real = [
      join(repoRoot, 'website/src/content/docs'),
      join(repoRoot, 'docs'),
      join(repoRoot, 'skills'),
      join(repoRoot, '.agents/skills/docs-writing/references'),
    ];
    expect(await checkNoMermaid({ roots: real })).toEqual([]);
  });
});

describe('check-no-mermaid CLI', () => {
  const run = (root: string) => {
    mkdirSync(join(root, 'website'), { recursive: true });
    const result = spawnSync(process.execPath, [scriptPath], { cwd: join(root, 'website'), encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    return result;
  };

  it('exits 0 and prints nothing when the content is clean', () => {
    const root = makeTree({ [PAGE]: fence('txt'), 'docs/a.md': 'ok\n', 'skills/ambercast/SKILL.md': 'ok\n' });
    const result = run(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it.each([
    ['site docs', 'website/src/content/docs/a.md'],
    ['spec sources', 'docs/spec/a.md'],
    ['bundled skill', 'skills/ambercast/SKILL.md'],
    ['skill reference sample', '.agents/skills/docs-writing/references/blocks.mdx'],
  ])('exits 1 and prints the finding for a fence in %s', (_name, path) => {
    const root = makeTree({ [path]: `intro\n${fence('mermaid')}` });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('mermaid-fence');
    expect(result.stderr).toContain(path);
    expect(result.stderr).toContain('ac-flow');
    expect(result.stderr).toMatch(/line: 2/);
  });

  it('prints one block per finding', () => {
    const root = makeTree({ 'docs/a.md': fence('mermaid'), 'docs/b.md': fence('mermaid'), 'skills/c.md': fence('mermaid') });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr.match(/rule: 'mermaid-fence'/g)).toHaveLength(3);
  });

  it('exits 1 and names the unreadable root when a root cannot be read', () => {
    const root = makeTree({ 'website/src/content/docs': 'a file where a directory is expected\n' });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ENOTDIR/);
    expect(result.stderr).toContain('src/content/docs');
  });
});
