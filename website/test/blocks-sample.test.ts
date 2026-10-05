import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseProseTree, stripFrontmatterOffset } from '../scripts/lib/prose-text.mjs';

const samplePath = fileURLToPath(new URL('../../.agents/skills/docs-writing/references/blocks.mdx', import.meta.url));

describe('SPEC-14 blocks sample', () => {
  it('exists at the authored skill reference path', () => {
    expect(existsSync(samplePath)).toBe(true);
  });

  it('parses with the existing prose MDX stack', () => {
    const { body } = stripFrontmatterOffset(readFileSync(samplePath, 'utf8'));
    expect(() => parseProseTree(body, { isMdx: true })).not.toThrow();
  });

  it('contains a Markdown table', () => {
    const { body } = stripFrontmatterOffset(readFileSync(samplePath, 'utf8'));
    expect(parseProseTree(body, { isMdx: true }).children.some((node) => node.type === 'table')).toBe(true);
  });

  it('uses heading-styled Steps with blank lines around the list', () => {
    const source = readFileSync(samplePath, 'utf8');
    expect(source).toMatch(/<Steps>\s*\n\s*\n1\.\s+#{2,3}\s+[^\n]+\\\{#[a-z][\w-]*\}/);
    expect(source).toMatch(/<Steps>[\s\S]*?\n\s*\n<\/Steps>/);
  });

  it('contains synchronized Claude and Codex tabs', () => {
    const source = readFileSync(samplePath, 'utf8');
    const tabs = source.match(/<Tabs\b[^>]*\bsyncKey="[^"]+"[^>]*>([\s\S]*?)<\/Tabs>/)?.[1];
    expect(tabs).toBeDefined();
    expect(tabs).toMatch(/<TabItem\b[^>]*\blabel="[Cc]laude"/);
    expect(tabs).toMatch(/<TabItem\b[^>]*\blabel="[Cc]odex"/);
  });

  it.each(['ins', 'del', 'mark'])('contains an Expressive Code %s line marker', (marker) => {
    expect(readFileSync(samplePath, 'utf8')).toMatch(new RegExp('^\\s*`{3,}[^\\n]*\\b' + marker + '=\\{[0-9,-]+\\}', 'm'));
  });

  it('shows the three login.test.md files inside a FileTree', () => {
    const tree = readFileSync(samplePath, 'utf8').match(/<FileTree\b[^>]*>([\s\S]*?)<\/FileTree>/)?.[1];
    expect(tree).toBeDefined();
    for (const filename of ['login.test.md', 'login.ambercast.plan.json', 'login.ambercast.grounding.json']) expect(tree).toContain(filename);
  });

  it('contains terminal and titled editor frames', () => {
    const source = readFileSync(samplePath, 'utf8');
    expect(source).toMatch(/^\s*`{3,}(?:bash|sh|shell|console)[^\n]*\bframe="terminal"/m);
    expect(source).toMatch(/^\s*`{3,}(?!bash|sh|shell|console)[^\n]*\btitle="[^"]+"/m);
  });

  it.each(['note', 'tip', 'caution', 'danger'])('contains a ::: %s aside', (kind) => {
    expect(readFileSync(samplePath, 'utf8')).toMatch(new RegExp(`^:::${kind}(?:\\[|\\s|$)`, 'm'));
  });

  it.each(['Tabs', 'FileTree', 'Badge', 'LinkCard', 'details'])('contains a <%s block', (name) => {
    expect(readFileSync(samplePath, 'utf8')).toMatch(new RegExp(`<${name}(?=[\\s/>])`));
  });

  it('contains fences with showLineNumbers and collapse metadata', () => {
    const source = readFileSync(samplePath, 'utf8');
    expect(source).toMatch(/^\s*`{3,}[^\n]*\bshowLineNumbers\b[^\n]*$/m);
    expect(source).toMatch(/^\s*`{3,}[^\n]*\bcollapse=/m);
  });

  it('contains a Mermaid fence with alt metadata', () => {
    expect(readFileSync(samplePath, 'utf8')).toMatch(/^\s*`{3,}mermaid\s+[^\n]*\balt=/m);
  });
});
