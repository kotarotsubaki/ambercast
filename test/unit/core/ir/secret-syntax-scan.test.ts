import { describe, expect, it } from 'vitest';
import { normalizeTestMd } from '#core/ir/normalize.js';
import { scanLegacySecretSyntax } from '#core/ir/secret-syntax-scan.js';

function scan(markdown: string) { return scanLegacySecretSyntax(normalizeTestMd(markdown)); }

describe('scanLegacySecretSyntax', () => {
  it.each([
    ['backtick fence', '```md\n@ambercast-secret {{secrets.fenced}}\n```\n'],
    ['tilde fence', '~~~\n@ambercast-secret {{secrets.tilde}}\n~~~\n'],
    ['four-backtick fence', '````\n@ambercast-secret {{secrets.four}}\n````\n'],
    ['inline code', 'Example `{{secrets.inline}}`.\n'],
    ['indented code', '    {{secrets.indented}}\n'],
  ])('ignores legacy syntax inside %s', (_kind, markdown) => { expect(scan(markdown)).toEqual([]); });

  it('reports grant lines outside code once, reference-only lines, and every reference on a mixed line', () => {
    expect(scan('@ambercast-secret {{secrets.grant}}\n{{secrets.first}} and {{secrets.second}}\n')).toEqual([
      { kind: 'grant-line', line: 1, column: 1 },
      { kind: 'reference', line: 2, column: 1 },
      { kind: 'reference', line: 2, column: 23 },
    ]);
  });

  it('does not scan a grant line interior, but scans a grant-looking mixed physical line as references', () => {
    expect(scan('@ambercast-secret {{secrets.a}} trailing {{secrets.b}}\n')).toEqual([
      { kind: 'reference', line: 1, column: 19 }, { kind: 'reference', line: 1, column: 42 },
    ]);
  });

  it.each([
    ['space padding', '  @ambercast-secret {{secrets.padded}}  \n'],
    ['tab padding', '@ambercast-secret\t{{secrets.tabbed}}\t\n'],
  ])('recognizes a complete grant line with %s', (_kind, markdown) => {
    expect(scan(markdown)).toEqual([{ kind: 'grant-line', line: 1, column: 1 }]);
  });

  it.each([
    ['missing directive separator', '@ambercast-secret{{secrets.missing_separator}}\n', 18],
    ['trailing non-whitespace', '@ambercast-secret {{secrets.trailing}} extra\n', 19],
  ])('falls through to a reference for a grant-looking line with %s', (_kind, markdown, column) => {
    expect(scan(markdown)).toEqual([{ kind: 'reference', line: 1, column }]);
  });

  it('uses one-based UTF-16 columns and sorts by line then column', () => {
    expect(scan('😀 {{secrets.later}} {{secrets.last}}\n@ambercast-secret {{secrets.grant}}\n')).toEqual([
      { kind: 'reference', line: 1, column: 4 }, { kind: 'reference', line: 1, column: 22 },
      { kind: 'grant-line', line: 2, column: 1 },
    ]);
  });

  it('scans inline code nested deeply enough to exceed a recursive tree walk', () => {
    const markdown = `${'> '.repeat(12_000)}\`{{secrets.deep}}\`\n`;

    expect(scan(markdown)).toEqual([]);
  });
});
