import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const locales = ['', 'ja/', 'zh-cn/'] as const;

function section(markdown: string, heading: RegExp): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) throw new Error(`Missing section: ${heading}`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

function tableRow(markdown: string, firstCell: string): string {
  const row = markdown.split('\n').find((line) => line.startsWith(`| ${firstCell} |`));
  if (!row) throw new Error(`Missing table row: ${firstCell}`);
  return row;
}

describe('documented ambiguity exit codes', () => {
  const skill = readFileSync(new URL('../../../skills/ambercast/SKILL.md', import.meta.url), 'utf8');
  const exitTable = section(skill, /^## Reading results$/);

  it('excludes ambiguity from the skill exit 1 row', () => {
    expect(tableRow(exitTable, '1')).not.toMatch(/ambiguity/i);
  });

  it('includes PROMPT_AMBIGUOUS in the skill exit 2 row', () => {
    expect(tableRow(exitTable, '2')).toContain('PROMPT_AMBIGUOUS');
  });

  it('includes --strict in the skill exit 2 row', () => {
    expect(tableRow(exitTable, '2')).toContain('`--strict`');
  });

  it.each(locales)('omits strict from the %s generate tool row', (locale) => {
    const document = readFileSync(new URL(`../../../website/src/content/docs/${locale}reference/mcp-tools.md`, import.meta.url), 'utf8');
    const toolTable = section(document, /^## .+ \{#tool-table\}$/);
    expect(tableRow(toolTable, '`ambercast_generate`')).not.toMatch(/strict/i);
  });

  it.each(locales)('documents PROMPT_AMBIGUOUS in the %s generate tool row', (locale) => {
    const document = readFileSync(new URL(`../../../website/src/content/docs/${locale}reference/mcp-tools.md`, import.meta.url), 'utf8');
    const toolTable = section(document, /^## .+ \{#tool-table\}$/);
    expect(tableRow(toolTable, '`ambercast_generate`')).toContain('PROMPT_AMBIGUOUS');
  });

  it.each(locales)('documents heal ambiguity in the %s MCP tool table', (locale) => {
    const document = readFileSync(new URL(`../../../website/src/content/docs/${locale}reference/mcp-tools.md`, import.meta.url), 'utf8');
    const toolTable = section(document, /^## .+ \{#tool-table\}$/);
    expect(tableRow(toolTable, '`ambercast_heal`')).toContain('PROMPT_AMBIGUOUS');
  });
});
