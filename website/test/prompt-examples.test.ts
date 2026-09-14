import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Node, Parent } from 'unist';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
// Keep this literal synchronized with scanLegacySecretSyntax in
// src/core/ir/secret-syntax-scan.ts:43; exporting it solely for this docs test would expand production scope.
const grantLine = /^[ \t]*@ambercast-secret[ \t]+\{\{secrets\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\}\}[ \t]*$/;
const legacyReference = '{{secrets.';
// The corpus has two verified invariants: json is the only non-prose fence label
// that legitimately contains legacy references, and every H1-shaped .test.md
// prompt example is labeled markdown. Exempting only json closes arbitrary-label
// relabeling while the H1 content shape enforces markdown normalization without a
// hand-maintained page inventory.
const EXEMPT_NON_PROSE_LABELS = new Set(['json']);

const exceptionTargets = [
  ['website/src/content/docs/how-to/upgrade.md', 'migrate-secret-grants'],
  ['website/src/content/docs/ja/how-to/upgrade.md', 'migrate-secret-grants'],
  ['website/src/content/docs/zh-cn/how-to/upgrade.md', 'migrate-secret-grants'],
  ['website/src/content/docs/reference/prompt-format.md', 'legacy-secret-syntax'],
  ['website/src/content/docs/ja/reference/prompt-format.md', 'legacy-secret-syntax'],
  ['website/src/content/docs/zh-cn/reference/prompt-format.md', 'legacy-secret-syntax'],
] as const;

interface Range {
  readonly start: number;
  readonly end: number;
}

interface Fence extends Range {
  readonly content: string;
  readonly contentStart: number;
  readonly info: string;
}

interface Document {
  readonly path: string;
  readonly source: string;
  readonly fences: readonly Fence[];
  readonly exceptions: readonly Range[];
  readonly missingAnchors: readonly string[];
}

describe('documentation prompt examples', () => {
  it('recognizes fenced blocks independently of their language, marker, or indentation', () => {
    const source = [
      '```markdown',
      'one',
      '```',
      '',
      '   ~~~ text',
      'two',
      '   ~~~',
      '',
      '```',
      'three',
      '```',
      '',
      '  ````typescript meta',
      'four',
      '  ````',
      '',
      '    indented code is not a fence',
    ].join('\n');

    expect(fences(source).map(({ info, content }) => ({ info, content }))).toEqual([
      { info: 'markdown', content: 'one\n' },
      { info: 'text', content: 'two\n' },
      { info: '', content: 'three\n' },
      { info: 'typescript meta', content: 'four\n' },
    ]);
  });

  it('requires every named legacy-syntax exception anchor to exist exactly once', async () => {
    const documents = await documentsUnderTest();
    const missing = documents.flatMap((document) => document.missingAnchors);

    expect(missing, `missing named exception anchors:\n${missing.join('\n')}`).toEqual([]);
  });

  it('extends a final exception section through end of source', () => {
    const source = ['## Legacy {#legacy}', '', '```text', 'legacy example', '```'].join('\n');
    const { exceptions, missingAnchors } = exceptionRanges(source, 'fixture.md', ['legacy']);
    const [fence] = fences(source);

    expect(missingAnchors).toEqual([]);
    expect(exceptions).toEqual([{ start: 0, end: source.length }]);
    expect(isExcepted(fence, exceptions)).toBe(true);
  });

  it('includes fences in nested subsections of an exception section', () => {
    const source = ['## Legacy {#legacy}', '', '### Details', '', '```text', 'legacy example', '```'].join('\n');
    const { exceptions } = exceptionRanges(source, 'fixture.md', ['legacy']);
    const [fence] = fences(source);

    expect(isExcepted(fence, exceptions)).toBe(true);
  });

  it('excludes fences after the next equal-or-shallower heading', () => {
    const source = ['## Legacy {#legacy}', '', '```text', 'legacy example', '```', '', '## Current', '', '```text', 'current example', '```'].join('\n');
    const { exceptions } = exceptionRanges(source, 'fixture.md', ['legacy']);
    const [, currentFence] = fences(source);

    expect(isExcepted(currentFence, exceptions)).toBe(false);
  });

  it('rejects legacy grant lines in every fenced code block outside an exception section', async () => {
    const violations = (await documentsUnderTest()).flatMap((document) => document.fences.flatMap((fence) => {
      if (isExcepted(fence, document.exceptions)) return [];
      return lineMatches(fence.content, grantLine).map(({ offset, text }) => `${displayPath(document.path)}:${locationAt(document.source, fence.contentStart + offset).line}: ${text}`);
    }));

    expect(violations, `rule (a) legacy grant lines:\n${violations.join('\n')}`).toEqual([]);
  });

  it('rejects legacy references in non-exempt fences outside an exception section', async () => {
    const violations = (await documentsUnderTest()).flatMap((document) => document.fences.flatMap((fence) => {
      if (!hasRuleBLegacyReferenceViolation(fence) || isExcepted(fence, document.exceptions)) return [];
      return occurrences(fence.content, legacyReference).map((offset) => {
        const location = locationAt(document.source, fence.contentStart + offset);
        return `${displayPath(document.path)}:${location.line}:${location.column}: info string ${JSON.stringify(fence.info)}`;
      });
    }));

    expect(violations, `rule (b) legacy references in non-exempt fences:\n${violations.join('\n')}`).toEqual([]);
  });

  it('treats up to three leading spaces before an H1 as markdown-shaped prompt content', () => {
    const source = [
      '```text',
      '   # Three-space heading',
      '```',
      '',
      '```text',
      '    # Four-space indented code',
      '```',
    ].join('\n');
    const [threeSpaceFence, fourSpaceFence] = fences(source);

    expect(requiresMarkdownNormalization(threeSpaceFence)).toBe(true);
    expect(requiresMarkdownNormalization(fourSpaceFence)).toBe(false);
  });

  it('requires a json fence with an indented H1 and legacy reference to use markdown', () => {
    const source = [
      '```json',
      '   # Sign in',
      '{{secrets.password}}',
      '```',
    ].join('\n');
    const [fence] = fences(source);

    expect(hasRuleBLegacyReferenceViolation(fence)).toBe(false);
    expect(requiresMarkdownNormalization(fence)).toBe(true);
  });

  it('normalizes every H1-shaped prompt fence to markdown outside an exception section', async () => {
    const violations = (await documentsUnderTest()).flatMap((document) => document.fences.flatMap((fence) => {
      if (!requiresMarkdownNormalization(fence) || isExcepted(fence, document.exceptions)) return [];
      const heading = firstNonBlankLine(fence.content);
      if (heading === undefined) return [];
      const location = locationAt(document.source, fence.contentStart + heading.offset);
      return [`${displayPath(document.path)}:${location.line}: info string ${JSON.stringify(fence.info)} must be "markdown" for an H1-shaped prompt fence`];
    }));

    expect(violations, `rule (c) markdown normalization for H1-shaped prompt fences:\n${violations.join('\n')}`).toEqual([]);
  });
});

async function documentsUnderTest(): Promise<readonly Document[]> {
  const paths = [
    ...(await markdownFiles(resolve(repositoryRoot, 'docs/spec'), false)),
    ...(await markdownFiles(resolve(repositoryRoot, 'website/src/content/docs'), true)),
    resolve(repositoryRoot, 'skills/ambercast/SKILL.md'),
  ].sort();

  return Promise.all(paths.map(async (path) => {
    const source = await readFile(path, 'utf8');
    const relativePath = displayPath(path);
    const anchors = exceptionTargets.filter(([exceptionPath]) => relativePath === exceptionPath).map(([, anchor]) => anchor);
    const { exceptions, missingAnchors } = exceptionRanges(source, relativePath, anchors);

    return { path, source, fences: fences(source), exceptions, missingAnchors };
  }));
}

function exceptionRanges(source: string, path: string, anchors: readonly string[]): Pick<Document, 'exceptions' | 'missingAnchors'> {
  const headings = nodes(fromMarkdown(source), 'heading');
  const exceptions: Range[] = [];
  const missingAnchors: string[] = [];

  for (const anchor of anchors) {
    const matches = headings.filter((heading) => headingHasAnchor(source, heading, anchor));
    if (matches.length !== 1) {
      missingAnchors.push(`${path}: expected exactly one {#${anchor}} heading, found ${matches.length}`);
      continue;
    }
    const heading = matches[0];
    const next = headings.find((candidate) => candidate.position!.start.offset! > heading.position!.start.offset! && headingDepth(candidate) <= headingDepth(heading));
    exceptions.push({ start: heading.position!.start.offset!, end: next?.position?.start.offset ?? source.length });
  }

  return { exceptions, missingAnchors };
}

async function markdownFiles(directory: string, includeMdx: boolean): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(entries.sort((left, right) => left.name.localeCompare(right.name)).map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path, includeMdx);
    return entry.name.endsWith('.md') || (includeMdx && entry.name.endsWith('.mdx')) ? [path] : [];
  }));
  return children.flat();
}

function fences(source: string, tree = fromMarkdown(source)): readonly Fence[] {
  return nodes(tree, 'code').flatMap((node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return [];
    const raw = source.slice(start, end);
    const opening = /^ {0,3}(`{3,}|~{3,})([^\n\r]*)/.exec(raw);
    if (opening === null) return [];
    const openerEnd = start + opening[0].length;
    const contentStart = source[openerEnd] === '\r' && source[openerEnd + 1] === '\n' ? openerEnd + 2 : source[openerEnd] === '\n' ? openerEnd + 1 : openerEnd;
    const close = closingFenceOffset(source, contentStart, end, opening[1]);
    return [{ start, end, contentStart, content: source.slice(contentStart, close ?? end), info: opening[2].trim() }];
  });
}

function closingFenceOffset(source: string, contentStart: number, end: number, opener: string): number | undefined {
  const marker = opener[0];
  const minimumLength = opener.length;
  for (let lineStart = contentStart; lineStart < end;) {
    const lineEnd = source.indexOf('\n', lineStart);
    const boundedEnd = lineEnd === -1 || lineEnd >= end ? end : lineEnd;
    const line = source.slice(lineStart, boundedEnd).replace(/\r$/, '');
    if (new RegExp(`^ {0,3}${marker}{${minimumLength},}[ \\t]*$`).test(line)) return lineStart;
    if (lineEnd === -1 || lineEnd >= end) break;
    lineStart = lineEnd + 1;
  }
  return undefined;
}

function nodes(tree: Node, type: string): Node[] {
  const found: Node[] = [];
  const stack: Node[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === type) found.push(node);
    if ('children' in node) stack.push(...(node as Parent).children.toReversed());
  }
  return found;
}

function headingHasAnchor(source: string, heading: Node, anchor: string): boolean {
  const start = heading.position?.start.offset;
  const end = heading.position?.end.offset;
  return start !== undefined && end !== undefined && new RegExp(`\\{#${anchor}\\}[ \\t]*$`).test(source.slice(start, end));
}

function headingDepth(heading: Node): number {
  return (heading as Node & { depth: number }).depth;
}

function isExcepted(fence: Range, exceptions: readonly Range[]): boolean {
  return exceptions.some((exception) => fence.start >= exception.start && fence.end <= exception.end);
}

function lineMatches(source: string, pattern: RegExp): readonly { offset: number; text: string }[] {
  const matches: { offset: number; text: string }[] = [];
  let offset = 0;
  for (const line of source.split('\n')) {
    const text = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (pattern.test(text)) matches.push({ offset, text });
    offset += line.length + 1;
  }
  return matches;
}

function isH1ShapedPromptFence(content: string): boolean {
  const heading = firstNonBlankLine(content);
  return heading !== undefined && /^ {0,3}#[ \t]/.test(heading.text);
}

function hasRuleBLegacyReferenceViolation(fence: Fence): boolean {
  return !EXEMPT_NON_PROSE_LABELS.has(fence.info) && occurrences(fence.content, legacyReference).length > 0;
}

function requiresMarkdownNormalization(fence: Fence): boolean {
  return fence.info !== 'markdown' && isH1ShapedPromptFence(fence.content);
}

function occurrences(source: string, needle: string): readonly number[] {
  const found: number[] = [];
  for (let offset = source.indexOf(needle); offset !== -1; offset = source.indexOf(needle, offset + 1)) found.push(offset);
  return found;
}

function firstNonBlankLine(source: string): { offset: number; text: string } | undefined {
  let offset = 0;
  for (const line of source.split('\n')) {
    const text = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (/\S/.test(text)) return { offset, text };
    offset += line.length + 1;
  }
  return undefined;
}

function locationAt(source: string, offset: number): { line: number; column: number } {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  return { line: source.slice(0, lineStart).split('\n').length, column: offset - lineStart + 1 };
}

function displayPath(path: string): string {
  return relative(repositoryRoot, path).replace(/\\/g, '/');
}
