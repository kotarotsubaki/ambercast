import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const locales = ['', 'ja/', 'zh-cn/'] as const;
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const reference = (locale: string, page: string) => read(`website/src/content/docs/${locale}reference/${page}.md`);
// English spec pages are sync outputs; their committed source is docs/spec.
const spec = (locale: string, page: string) => read(locale === '' ? `docs/spec/${page}.md` : `website/src/content/docs/${locale}spec/${page}.md`);

function section(document: string, anchor: string): string {
  const lines = document.split('\n');
  const start = lines.findIndex((line) => line.startsWith('## ') && line.includes(`{#${anchor}}`));
  if (start < 0) throw new Error(`Missing section: ${anchor}`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

function row(document: string, firstCell: string): string {
  const matches = document.split('\n').filter((line) => line.startsWith(`| ${firstCell} |`));
  expect(matches, `Table row ${firstCell}`).toHaveLength(1);
  return matches[0]!;
}

function identifiers(document: string): string[] {
  // Fenced examples cannot substitute for the inline-code vocabulary contract.
  const body = document.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
  return [...new Set([...body.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!)
    .filter((token) => token === 'generator-assumption' || token === 'assumptions'))].sort();
}

describe('TEST-11 generator assumption documentation (SPEC-11)', () => {
  for (const [page, identifier] of [['reports', 'generator-assumption'], ['plan-document', 'assumptions'], ['secrets', 'assumptions']] as const) {
    it.each(locales)(`documents inline-code ${identifier} in ${page} for locale %s with the same identifier set`, (locale) => {
      const document = page === 'reports' ? reference(locale, page) : spec(locale, page);
      const actual = identifiers(document);
      expect(actual).toContain(identifier);
      const english = identifiers(page === 'reports' ? reference('', page) : spec('', page));
      expect(english).toContain(identifier);
      expect(actual).toEqual(english);
    });
  }

  it.each(locales)('removes the strict flag from generate flags for locale %s', (locale) => {
    const flags = section(reference(locale, 'cli/generate'), 'flags');
    expect(flags).toContain('--force');
    expect(flags).not.toMatch(/--strict\b/);
  });

  it.each(locales)('removes strict from generate usage for locale %s', (locale) => {
    const surface = section(reference(locale, 'cli/overview'), 'command-surface');
    const usage = surface.match(/^Generate options:\s*\n([\s\S]*?)(?=^Run options:)/m);
    expect(usage, 'Generate usage block').not.toBeNull();
    expect(usage![1]).toContain('--force');
    expect(usage![1]).not.toMatch(/--strict\b/);
  });

  it.each(locales)('removes strict from the generate flag matrix for locale %s', (locale) => {
    const generate = row(section(reference(locale, 'cli/overview'), 'command-flag-matrix'), 'generate');
    expect(generate).toContain('force');
    expect(generate).not.toMatch(/\bstrict\b/);
  });

  it.each(locales)('removes strict from MCP generate inputs for locale %s', (locale) => {
    const generate = row(section(reference(locale, 'mcp-tools'), 'inputs'), '`ambercast_generate`');
    expect(generate).toContain('force');
    expect(generate).not.toMatch(/\bstrict\b/);
  });

  it('removes the regardless-of-strict qualification from the skill exit table', () => {
    const document = read('skills/ambercast/SKILL.md');
    const start = document.indexOf('## Reading results\n');
    expect(start).toBeGreaterThanOrEqual(0);
    const results = document.slice(start).split(/^## /m)[1]!;
    const exit = row(results, '2');
    expect(exit).toContain('PROMPT_AMBIGUOUS');
    expect(exit).not.toContain('regardless of `--strict`');
  });

  it.each(locales)('documents report 3.11 in the reports contract and examples for locale %s', (locale) => {
    const document = reference(locale, 'reports');
    const envelope = section(document, 'envelope');
    expect(envelope).toContain('schemaVersion');
    expect(envelope).toContain('3.11');
    expect(envelope).not.toContain('3.10');
    const examples = [...document.matchAll(/"schemaVersion"\s*:\s*"([^"]+)"/g)];
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) expect(example[1]).toBe('3.11');
  });

  for (const anchor of ['publication-metadata', 'generated-artifacts', 'report-schema']) {
    it.each(locales)(`documents report 3.11 at json-schemas ${anchor} for locale %s`, (locale) => {
      const content = section(reference(locale, 'json-schemas'), anchor);
      const report = anchor === 'publication-metadata' ? row(content, 'report')
        : anchor === 'generated-artifacts' ? row(content, '`report.schema.json`') : content;
      expect(report).toContain('schemaVersion');
      expect(report).toContain('3.11');
      expect(report).not.toContain('3.10');
    });
  }

  it.each(locales)('accepts report schemaVersion 3.11 in the spec overview table for locale %s', (locale) => {
    const report = row(section(spec(locale, 'overview'), 'compatibility'), 'Report `schemaVersion`');
    expect(report.split('|')[2]!.trim()).toBe('`3.11`');
  });

  it('includes inline-code generator-assumption guidance in the official skill', () => {
    const lines = read('skills/ambercast/SKILL.md').split('\n');
    expect(lines.some((line) => line.includes('`generator-assumption`'))).toBe(true);
  });

  it.each(locales)('links the producer/report/strict migration from the spec changelog for locale %s', (locale) => {
    const history = section(spec(locale, 'changelog'), 'version-history');
    const changes = history.split('\n').filter((line) => line.startsWith('|') && /\b3\.11\b/.test(line));
    expect(changes.length, 'Report 3.11 change row').toBeGreaterThan(0);
    const change = history.split('\n').filter((line) => line.startsWith('|')
      && (/\b3\.11\b/.test(line) || line.includes('`--strict`'))).join('\n');
    expect(change).toContain('`--strict`');
    expect(change).toContain('#reground-after-producer-change');
  });
});
