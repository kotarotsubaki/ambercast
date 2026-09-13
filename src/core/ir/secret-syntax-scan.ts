import type { NormalizedTestMd } from './normalize.js';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Node, Parent } from 'unist';

/**
 * Locates a rejected pre-v3 secret spelling in normalized Markdown.
 *
 * Line and column are one-based UTF-16 coordinates because they must align
 * with JavaScript string indexing and the rest of the prompt diagnostics.
 * A grant line is deliberately distinct from a reference: a full legacy
 * directive reports once at its first column rather than also reporting the
 * reference embedded inside it.
 */
export interface LegacyOccurrence {
  readonly kind: 'grant-line' | 'reference';
  readonly line: number;
  readonly column: number;
}

/**
 * Finds legacy secret directives and references that Plan IR v3 must reject
 * before target resolution, digesting, or plan processing (SPEC-C1-7).
 *
 * The scanner reuses CommonMark's code and inline-code ranges so
 * examples, fenced blocks of any backtick or tilde length, and indented code
 * remain prose-safe. For every other physical line it first recognizes a line
 * consisting only of the `@ambercast-secret` directive followed by one
 * brace-delimited secret reference, reporting exactly one `grant-line`
 * occurrence without also scanning that
 * line for `{{secrets.` references. Every other line reports one `reference`
 * occurrence for each `{{secrets.` substring match in its non-code segments.
 * Results are sorted by line and column; columns count
 * UTF-16 code units, including positions adjacent to surrogate pairs.
 */
export function scanLegacySecretSyntax(normalizedTestMd: NormalizedTestMd): readonly LegacyOccurrence[] {
  const markdown = normalizedTestMd as string;
  const excluded = codeRanges(markdown);
  const occurrences: LegacyOccurrence[] = [];
  let offset = 0;
  for (const [index, line] of markdown.split('\n').entries()) {
    const lineEnd = offset + line.length;
    const wholeLineIsCode = excluded.some(([start, end]) => start < lineEnd && end > offset);
    if (!wholeLineIsCode && /^[ \t]*@ambercast-secret[ \t]+\{\{secrets\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\}\}[ \t]*$/.test(line)) {
      occurrences.push({ kind: 'grant-line', line: index + 1, column: 1 });
    } else {
      for (let found = line.indexOf('{{secrets.'); found !== -1; found = line.indexOf('{{secrets.', found + 1)) {
        const absolute = offset + found;
        if (!excluded.some(([start, end]) => absolute >= start && absolute < end)) {
          occurrences.push({ kind: 'reference', line: index + 1, column: found + 1 });
        }
      }
    }
    offset = lineEnd + 1;
  }
  return occurrences.sort((left, right) => left.line - right.line || left.column - right.column);
}

function codeRanges(markdown: string): readonly (readonly [number, number])[] {
  const ranges: [number, number][] = [];
  const stack: Node[] = [fromMarkdown(markdown)];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if ((node.type === 'code' || node.type === 'inlineCode') && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      ranges.push([node.position.start.offset, node.position.end.offset]);
    }
    if ('children' in node) stack.push(...(node as Parent).children);
  }
  return ranges;
}
