import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseProseTree, stripFrontmatterOffset } from '../scripts/lib/prose-text.mjs';

const samplePath = fileURLToPath(new URL('../../.agents/skills/docs-writing/references/blocks.mdx', import.meta.url));

const flowClasses = new Set(['ac-flow', 'ac-flow-node', 'ac-flow-stage', 'ac-flow-head', 'ac-flow-num', 'ac-flow-chip', 'ac-flow-chip-replay', 'ac-flow-chip-ai', 'ac-flow-title', 'ac-flow-meter', 'ac-flow-meter-s', 'ac-flow-meter-m', 'ac-flow-meter-l', 'ac-flow-track', 'ac-flow-fill', 'ac-flow-body', 'ac-flow-note', 'ac-flow-link', 'ac-flow-link-stage', 'ac-flow-cond']);
const flowElements = Object.fromEntries([...flowClasses].map((name) => [name,
  name === 'ac-flow' ? 'figure' : ['ac-flow-num', 'ac-flow-chip', 'ac-flow-chip-replay', 'ac-flow-chip-ai', 'ac-flow-cond'].includes(name) ? 'span' : ['ac-flow-title', 'ac-flow-body', 'ac-flow-note'].includes(name) ? 'p' : 'div']));
type ProseNode = { type: string; name?: string; value?: string; children?: ProseNode[]; attributes?: { type: string; name?: string; value?: unknown }[] };
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const attr = (node: ProseNode, name: string) => node.attributes?.find((attribute) => attribute.name === name)?.value;
const classes = (node: ProseNode) => String(attr(node, 'class') ?? '').split(/\s+/).filter(Boolean);
const has = (node: ProseNode, name: string) => classes(node).includes(name);
const jsx = (node: ProseNode) => ['mdxJsxFlowElement', 'mdxJsxTextElement'].includes(node.type);
const descendants = (node: ProseNode): ProseNode[] => [node, ...(node.children ?? []).flatMap(descendants)];
const text = (node: ProseNode): string => node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(text).join('');
function children(node: ProseNode): ProseNode[] {
  return (node.children ?? []).flatMap((child) => child.type === 'paragraph' ? children(child) : child.type === 'text' && !child.value?.trim() ? [] : [child]);
}

function validateFlowTree(body: string) {
  const tree = parseProseTree(body, { isMdx: true }) as ProseNode;
  const figures = descendants(tree).filter((node) => jsx(node) && node.name === 'figure' && attr(node, 'class') === 'ac-flow');
  expect(figures).toHaveLength(1);
  const figure = figures[0]!;
  expect(attr(figure, 'role')).toBeUndefined();
  const label = normalize(String(attr(figure, 'aria-label') ?? ''));
  expect(label).not.toBe('');
  const walk = (node: ProseNode, hidden = false) => {
    const isHidden = hidden || attr(node, 'aria-hidden') === 'true';
    if (jsx(node)) {
      expect(node === figure || node.name !== 'figure').toBe(true);
      expect(node.name).not.toMatch(/^h[1-6]$/);
      expect(attr(node, 'style')).toBeUndefined();
      for (const name of classes(node)) {
        expect(flowClasses.has(name), `Unknown class ${name}`).toBe(true);
        expect(node.name, `Element for ${name}`).toBe(flowElements[name]);
      }
      if (has(node, 'ac-flow-cond')) {
        expect(isHidden).toBe(false);
        expect(label).toContain(normalize(text(node)));
      }
    }
    for (const child of node.children ?? []) walk(child, isHidden);
  };
  walk(figure);
  const parts = children(figure);
  expect(parts.length).toBeGreaterThanOrEqual(3);
  expect(parts.length % 2).toBe(1);
  for (const [index, part] of parts.entries()) {
    expect(part.name).toBe('div');
    if (index % 2) {
      expect(has(part, 'ac-flow-link')).toBe(true);
      expect(classes(part).every((name) => ['ac-flow-link', 'ac-flow-link-stage'].includes(name))).toBe(true);
      expect(descendants(part).filter((node) => has(node, 'ac-flow-cond'))).toHaveLength(1);
      const arrows = descendants(part).filter((node) => node.name === 'svg');
      expect(arrows.length).toBeGreaterThanOrEqual(1);
      for (const arrow of arrows) expect(attr(arrow, 'aria-hidden')).toBe('true');
      expect(has(part, 'ac-flow-link-stage')).toBe(has(parts[index - 1]!, 'ac-flow-stage') && has(parts[index + 1]!, 'ac-flow-stage'));
      continue;
    }
    expect(has(part, 'ac-flow-node')).toBe(true);
    expect(classes(part).every((name) => ['ac-flow-node', 'ac-flow-stage'].includes(name))).toBe(true);
    const inner = children(part);
    const order = ['ac-flow-head', 'ac-flow-title', 'ac-flow-meter', 'ac-flow-body', 'ac-flow-note'];
    const positions = inner.map((child) => order.findIndex((name) => has(child, name)));
    expect(positions.slice(0, 2)).toEqual([0, 1]);
    expect(positions.every((position, i) => position >= 0 && (i === 0 || position > positions[i - 1]!))).toBe(true);
    expect(inner[0]?.name).toBe('div');
    expect(inner[1]?.name).toBe('p');
    const head = children(inner[0]!);
    expect(head.length).toBeGreaterThanOrEqual(1);
    expect(head.length).toBeLessThanOrEqual(2);
    expect(head[0]?.name).toBe('span');
    expect(has(head[0]!, 'ac-flow-num')).toBe(true);
    if (head[1]) {
      expect(head[1].name).toBe('span');
      expect(has(head[1], 'ac-flow-chip')).toBe(true);
      expect(classes(head[1]).filter((name) => ['ac-flow-chip-replay', 'ac-flow-chip-ai'].includes(name))).toHaveLength(1);
    }
    for (const child of inner.slice(2)) {
      if (!has(child, 'ac-flow-meter')) { expect(child.name).toBe('p'); continue; }
      expect(child.name).toBe('div');
      expect(classes(child).filter((name) => /^ac-flow-meter-[sml]$/.test(name))).toHaveLength(1);
      const meter = children(child);
      expect(meter).toHaveLength(2);
      expect(meter[0]?.name).toBe('div');
      expect(classes(meter[0]!)).toEqual(['ac-flow-track']);
      const track = children(meter[0]!);
      expect(track).toHaveLength(1);
      expect(track[0]?.name).toBe('div');
      expect(classes(track[0]!)).toEqual(['ac-flow-fill']);
      expect(meter[1]?.name).toBe('span');
    }
  }
}

function validateFlowSource(source: string) {
  expect(source).not.toMatch(/\r?\n[\t ]*\r?\n/);
  expect(source).not.toContain('{');
  const stack: string[] = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const tags = /<\/?([a-z][a-z0-9-]*)(?:\s+[a-z][a-z0-9-]*="[^"<{]*")*\s*\/?>/g;
  let end = 0;
  for (const match of source.matchAll(tags)) {
    expect(source.slice(end, match.index)).not.toContain('<');
    const tag = match[0];
    const name = match[1]!;
    if (tag.startsWith('</')) {
      expect(tag).toBe(`</${name}>`);
      expect(stack.pop()).toBe(name);
    } else if (tag.endsWith('/>')) {
      expect(stack).toContain('svg');
      expect(new Set(['svg', 'path', 'line', 'polyline', 'polygon', 'circle', 'rect', 'ellipse', 'g', 'use', 'defs', 'symbol', 'text', 'tspan', 'title', 'desc', 'marker', 'mask', 'pattern', 'image', 'view', 'switch', 'a', 'style', 'script', 'filter', 'stop']).has(name)).toBe(true);
    } else if (!voidTags.has(name)) stack.push(name);
    end = match.index! + tag.length;
  }
  expect(source.slice(end)).not.toContain('<');
  expect(stack).toEqual([]);
}

function flowSlice(source: string) {
  const match = source.match(/<figure class="ac-flow"[\s\S]*?<\/figure>/);
  expect(match).not.toBeNull();
  return match![0];
}

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

  it('contains no Mermaid fences', () => {
    const { body } = stripFrontmatterOffset(readFileSync(samplePath, 'utf8'));
    expect(descendants(parseProseTree(body, { isMdx: true }) as ProseNode).filter((node) => node.type === 'code' && (node as ProseNode & { lang?: string }).lang === 'mermaid')).toHaveLength(0);
  });

  it('contains exactly one accessible flow figure with the shared child grammar', () => {
    const { body } = stripFrontmatterOffset(readFileSync(samplePath, 'utf8'));
    validateFlowTree(body);
  });

  it('uses the shared HTML source grammar for the flow figure', () => {
    validateFlowSource(flowSlice(readFileSync(samplePath, 'utf8')));
  });
});

describe('flow validator controls', () => {
  const node = '<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">BASELINE</span></div><p class="ac-flow-title">Prompt</p></div>';
  const link = '<div class="ac-flow-link"><svg aria-hidden="true"><path d="M0 0"></path></svg><span class="ac-flow-cond">Continue</span></div>';
  const valid = `<figure class="ac-flow" aria-label="Continue">${node}${link}${node}</figure>`;
  it('accepts a valid figure and SVG-only self-closing tags', () => {
    validateFlowTree(valid);
    validateFlowSource(valid);
    validateFlowSource(valid.replace('<path d="M0 0"></path>', '<path d="M0 0" />'));
  });
  it.each(['s', 'm', 'l'])('accepts a stage, chips, and the %s meter with optional body and note', (size) => {
    const stage = `<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">STAGE</span><span class="ac-flow-chip ac-flow-chip-ai">AI</span></div><p class="ac-flow-title">Plan</p><div class="ac-flow-meter ac-flow-meter-${size}"><div class="ac-flow-track"><div class="ac-flow-fill"></div></div><span>Scope</span></div><p class="ac-flow-body">Body</p><p class="ac-flow-note">Note</p></div>`;
    const baseline = node.replace('</span></div>', '</span><span class="ac-flow-chip ac-flow-chip-replay">Replay</span></div>');
    const source = `<figure class="ac-flow" aria-label="Continue">\n${baseline}\n${link}\n${stage}\n</figure>`;
    validateFlowTree(source);
    validateFlowSource(source);
  });
  it('normalizes label and condition whitespace and handles flow and text JSX', () => {
    validateFlowTree(valid.replace('aria-label="Continue"', 'aria-label="  Keep  going  "').replace('>Continue</span>', '>Keep\n going</span>').replaceAll('><', '>\n<'));
  });
  it.each(['path', 'line', 'polyline', 'polygon', 'circle', 'rect', 'ellipse', 'g', 'use'])('accepts self-closing SVG %s', (name) => {
    validateFlowSource(valid.replace('<path d="M0 0"></path>', `<${name} />`));
  });
  it.each(['div', 'span', 'p', 'b'])('rejects self-closing HTML %s inside SVG', (name) => {
    expect(() => validateFlowSource(valid.replace('<svg aria-hidden="true"><path d="M0 0"></path></svg>', `<svg aria-hidden="true"><${name} /></svg>`))).toThrow();
  });
  it('accepts a stage-to-stage link with its modifier', () => {
    validateFlowTree(valid.replaceAll('class="ac-flow-node"', 'class="ac-flow-node ac-flow-stage"').replace('class="ac-flow-link"', 'class="ac-flow-link ac-flow-link-stage"'));
  });
  it.each([
    ['single-quoted attribute', valid.replace('aria-label="Continue"', "aria-label='Continue'")],
    ['self-closing div', valid.replace('<div class="ac-flow-head">', '<div class="ac-flow-head" />')],
    ['expression', valid.replace('Prompt', '{expr}')],
    ['blank line', valid.replace(link, `\n\n${link}`)],
  ])('rejects source with %s', (_label, source) => {
    expect(() => validateFlowSource(source)).toThrow();
  });
  it.each([
    ['heading', valid.replace('<p class="ac-flow-title">Prompt</p>', '<h3 class="ac-flow-title">Prompt</h3>')],
    ['style', valid.replace('class="ac-flow-node"', 'class="ac-flow-node" style="color:red"')],
    ['hidden condition', valid.replace('class="ac-flow-link"', 'class="ac-flow-link" aria-hidden="true"')],
    ['missing condition in label', valid.replace('aria-label="Continue"', 'aria-label="Other transition"')],
    ['role', valid.replace('class="ac-flow"', 'class="ac-flow" role="img"')],
    ['unknown class', valid.replace('class="ac-flow-num"', 'class="unknown"')],
    ['single node', `<figure class="ac-flow" aria-label="One">${node}</figure>`],
    ['nested figure', valid.replace('Prompt', '<figure>Nested</figure>')],
    ['empty label', valid.replace('aria-label="Continue"', 'aria-label="  "')],
    ['wrong condition element', valid.replace('<span class="ac-flow-cond">Continue</span>', '<div class="ac-flow-cond">Continue</div>')],
    ['missing condition', valid.replace('<span class="ac-flow-cond">Continue</span>', '')],
    ['duplicate condition', valid.replace('>Continue</span>', '>Continue</span><span class="ac-flow-cond">Continue</span>')],
    ['visible SVG', valid.replace('aria-hidden="true"', 'aria-hidden="false"')],
    ['baseline-to-stage link with modifier', valid.replace(`${link}${node}`, `${link.replace('class="ac-flow-link"', 'class="ac-flow-link ac-flow-link-stage"')}${node.replace('class="ac-flow-node"', 'class="ac-flow-node ac-flow-stage"')}`)],
    ['stage link to a baseline', valid.replace(node, node.replace('ac-flow-node', 'ac-flow-node ac-flow-stage')).replace('class="ac-flow-link"', 'class="ac-flow-link ac-flow-link-stage"')],
    ['stage-to-stage link without modifier', valid.replaceAll('class="ac-flow-node"', 'class="ac-flow-node ac-flow-stage"')],
    ['title before head', valid.replace('<div class="ac-flow-head"><span class="ac-flow-num">BASELINE</span></div><p class="ac-flow-title">Prompt</p>', '<p class="ac-flow-title">Prompt</p><div class="ac-flow-head"><span class="ac-flow-num">BASELINE</span></div>')],
  ])('rejects tree with %s', (_label, source) => {
    expect(() => validateFlowTree(source)).toThrow();
  });
});
