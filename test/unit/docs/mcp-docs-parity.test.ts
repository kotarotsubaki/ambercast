import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const locales = ['', 'ja/', 'zh-cn/'] as const;
const pages = ['reference/mcp-tools.md', 'reference/cli/mcp.md', 'agents/mcp-server.md'] as const;
const required = [
  'ambercast_generate', 'ambercast_run', 'ambercast_check', 'ambercast_heal',
  'ambercast_job_status', 'ambercast_job_cancel', '--dir', '--sync-wait-ms',
  'HEAL_APPLY_TOKEN_INVALID', 'JOB_NOT_FOUND', 'applyToken', 'jobId',
];

function readDocument(locale: string, page: string): string {
  return readFileSync(new URL(`../../../website/src/content/docs/${locale}${page}`, import.meta.url), 'utf8');
}

function codeSpans(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)].map((match) => match[1]!))].sort();
}

describe('MCP public documentation', () => {
  it.each(pages)('%s is implemented and has matching code spans in every locale', (page) => {
    const documents = locales.map((locale) => readDocument(locale, page));
    for (const document of documents) {
      const frontmatter = document.match(/^---\n([\s\S]*?)\n---/)?.[1];
      expect(frontmatter).toBeDefined();
      expect(frontmatter).not.toMatch(/^status: planned$/m);
      expect(frontmatter).not.toMatch(/^\s*badge:/m);
      expect(document).not.toMatch(/^:::caution\b/m);
      expect(document).toContain('{#changes-from-the-planned-design}');
      expect(document.match(/^\|[^\n]+\|$/gm)?.length).toBeGreaterThanOrEqual(10);
    }
    const englishSpans = codeSpans(documents[0]!);
    for (const document of documents.slice(1)) expect(codeSpans(document)).toStrictEqual(englishSpans);
  });

  it('keeps the required public MCP vocabulary in code spans', () => {
    const spans = new Set(pages.flatMap((page) => codeSpans(readDocument('', page))));
    for (const term of required) expect(spans.has(term)).toBe(true);
  });

  it.each(locales)('shows all three client registrations in %s', (locale) => {
    const document = readDocument(locale, 'reference/cli/mcp.md');
    expect(document).toContain('.mcp.json');
    expect(document).toContain('config.toml');
    expect(document).toContain('Claude Desktop');
    expect(document.match(/"--no-install",\s*"ambercast",\s*"mcp"/g)).toHaveLength(3);
    expect(document).toContain('args = ["--no-install", "ambercast", "mcp"]');
  });

  it.each(['README.md', 'README-ja.md', 'README-zh-CN.md'])('%s advertises ambercast mcp', (name) => {
    const document = readFileSync(new URL(`../../../${name}`, import.meta.url), 'utf8');
    expect(document).toContain('ambercast mcp');
    expect(document).toContain('.mcp.json');
    expect(document).toContain('"--no-install", "ambercast", "mcp"');
  });

  it('removes the obsolete English README claim', () => {
    expect(readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')).not.toContain('No MCP server yet.');
  });

  it('mentions the job status tool in the official skill', () => {
    expect(readFileSync(new URL('../../../skills/ambercast/SKILL.md', import.meta.url), 'utf8')).toContain('ambercast_job_status');
  });
});
