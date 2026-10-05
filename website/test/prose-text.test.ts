import { describe, expect, it } from 'vitest';
import { stripFrontmatterOffset, parseProseTree, extractTextBlocks, splitSentences } from '../scripts/lib/prose-text.mjs';

type Node = { type: string; children?: Node[]; position?: { start: { line: number } } };
const types = (node: Node): string[] => [node.type, ...(node.children ?? []).flatMap(types)];
function extract(markdown: string, isMdx = false) {
  const { body, frontmatterLineOffset } = stripFrontmatterOffset(markdown);
  return extractTextBlocks(parseProseTree(body, { isMdx }), markdown.split('\n'), frontmatterLineOffset);
}
const text = (markdown: string, isMdx = false) => extract(markdown, isMdx).textBlocks.map((b) => b.joinedText).join('\n');

describe('stripFrontmatterOffset', () => {
  it('leaves a document without frontmatter intact', () => {
    const markdown = '# Heading\nBody.\n';
    expect(stripFrontmatterOffset(markdown)).toEqual({ body: markdown, frontmatterLineOffset: 0 });
  });
  it('strips the prefix and restores a parsed body line to its original line', () => {
    const result = stripFrontmatterOffset('---\ntitle: X\n---\n\nBody here.\n');
    expect(result).toEqual({ body: '\nBody here.\n', frontmatterLineOffset: 3 });
    const tree = parseProseTree(result.body, { isMdx: false }) as Node;
    expect(tree.children?.[0].position?.start.line + result.frontmatterLineOffset).toBe(5);
  });
  it('handles content immediately after the frontmatter', () => {
    expect(stripFrontmatterOffset('---\ntitle: X\n---\nBody here\n')).toEqual({ body: 'Body here\n', frontmatterLineOffset: 3 });
  });
  it('handles CRLF frontmatter delimiters', () => {
    expect(stripFrontmatterOffset('---\r\ntitle: X\r\n---\r\nBody here\r\n')).toEqual({ body: 'Body here\r\n', frontmatterLineOffset: 3 });
  });
});

describe('parseProseTree', () => {
  it('recognizes GFM tables, strikethrough, and autolinks', () => {
    const tree = parseProseTree('| A |\n| --- |\n| cell |\n\n~~gone~~ https://example.com', { isMdx: false }) as Node;
    for (const type of ['table', 'delete', 'link']) expect(types(tree)).toContain(type);
  });
  it('enables MDX JSX and expression grammar only for MDX', () => {
    const body = '<Steps>\n\nInside.\n\n</Steps>\n\n{1 + 1}';
    const mdx = types(parseProseTree(body, { isMdx: true }) as Node);
    expect(mdx).toContain('mdxJsxFlowElement');
    expect(mdx).toContain('mdxFlowExpression');
    const md = types(parseProseTree(body, { isMdx: false }) as Node);
    expect(md).not.toContain('mdxJsxFlowElement');
    expect(md).not.toContain('mdxFlowExpression');
  });
  it.each([
    ['heading', '# Heading\n', 'heading'],
    ['paragraph', 'Plain text.\n', 'paragraph'],
    ['thematic break', 'Before.\n\n---\n\nAfter.', 'thematicBreak'],
    ['fenced code', '```text\ncode\n```', 'code'],
  ])('parses %s to the correct mdast node', (_label, body, type) => {
    expect(types(parseProseTree(body, { isMdx: false }) as Node)).toContain(type);
  });
});

describe('extractTextBlocks', () => {
  it.each([
    ['code', 'Before.\n\n```\nFENCED_SECRET\n```\n\nAfter.', 'FENCED_SECRET', false],
    ['inlineCode', 'Before `INLINE_SECRET` after.', 'INLINE_SECRET', false],
    ['inline html', 'Before <span data-secret="INLINE_HTML_SECRET" /> after.', 'INLINE_HTML_SECRET', false],
    ['block html', 'Before.\n\n<div>BLOCK_HTML_SECRET</div>\n\nAfter.', 'BLOCK_HTML_SECRET', false],
    ['mdxjsEsm import', 'import Secret from "IMPORT_SECRET";\n\nVisible.', 'IMPORT_SECRET', true],
    ['mdxjsEsm export', 'export const secret = "EXPORT_SECRET";\n\nVisible.', 'EXPORT_SECRET', true],
    ['mdxFlowExpression', '{FLOW_SECRET}\n\nVisible.', 'FLOW_SECRET', true],
    ['mdxTextExpression', 'Before {TEXT_SECRET} after.', 'TEXT_SECRET', true],
    ['table', 'Before.\n\n| TABLE_SECRET |\n| --- |\n| CELL_SECRET |\n\nAfter.', 'TABLE_SECRET', false],
    ['image alt', 'Before ![ALT_SECRET](https://example.com/x.png) after.', 'ALT_SECRET', false],
    ['definition', '[ref]: https://example.com/DEFINITION_SECRET\n\nVisible.', 'DEFINITION_SECRET', false],
  ])('excludes %s from every text block', (_label, markdown, secret, isMdx) => {
    const blocks = extract(markdown, isMdx).textBlocks;
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(block.joinedText).not.toContain(secret);
  });
  it('excludes every table cell', () => {
    const result = text('| HEADER_SECRET |\n| --- |\n| CELL_SECRET |\n\nVisible.');
    expect(result).not.toContain('HEADER_SECRET');
    expect(result).not.toContain('CELL_SECRET');
  });
  it.each([
    ['paragraph', 'Paragraph content.', 'Paragraph content.', false],
    ['blockquote', '> Quoted content.', 'Quoted content.', false],
    ['heading', '## Heading content', 'Heading content', false],
    ['link child', '[Link content](https://example.com/SECRET_URL)', 'Link content', false],
    ['mdxJsxTextElement child', 'Text <em>Emphasized content</em> end.', 'Emphasized content', true],
    ['mdxJsxFlowElement child', '<Steps>\n\nFlow content.\n\n</Steps>', 'Flow content.', true],
  ])('includes %s text', (_label, markdown, expected, isMdx) => {
    expect(text(markdown, isMdx)).toContain(expected);
  });
  it('includes link text without its destination', () => {
    expect(text('[Link content](https://example.com/SECRET_URL)')).not.toContain('SECRET_URL');
  });
  it('gives each list item paragraph its own block', () => {
    expect(extract('- First item.\n- Second item.').textBlocks.map((b) => b.joinedText)).toEqual(['First item.', 'Second item.']);
  });
  it.each([
    ['titled', ':::note[Title]\nInside text.\n:::', 'Inside text.'],
    ['titleless', ':::caution\nBe careful.\n:::', 'Be careful.'],
  ])('counts a %s aside and removes its markers', (_label, markdown, content) => {
    const result = extract(markdown);
    expect(result.calloutCount).toBe(1);
    expect(result.textBlocks.map((b) => b.joinedText)).toContain(content);
    expect(result.textBlocks.map((b) => b.joinedText).join('\n')).not.toContain(':::');
  });
  it('recognizes an aside whose body contains a list', () => {
    const result = extract(':::note\n- item one\n- item two\n\n:::');
    expect(result.calloutCount).toBe(1);
    for (const block of result.textBlocks) {
      expect(block.joinedText).not.toContain(':::');
    }
  });

  it('recognizes an aside whose body contains a fenced code block', () => {
    const result = extract(':::tip\n```\ncode\n```\n:::');
    expect(result.calloutCount).toBe(1);
    for (const block of result.textBlocks) {
      expect(block.joinedText).not.toContain(':::');
    }
  });
  it('reparses multiple paragraphs inside an aside', () => {
    const result = extract(':::note\nFirst paragraph.\n\nSecond paragraph.\n:::');
    expect(result.calloutCount).toBe(1);
    expect(result.textBlocks.map((b) => b.joinedText)).toEqual(['First paragraph.', 'Second paragraph.']);
  });
  it('reuses link extraction inside an aside', () => {
    const result = text(':::note\nRead [the guide](https://example.com/ASIDE_URL).\n:::');
    expect(result).toContain('the guide');
    expect(result).not.toContain('ASIDE_URL');
    expect(result).not.toContain(':::');
  });
  it('counts two asides', () => {
    expect(extract(':::note\nOne.\n:::\n\n:::tip\nTwo.\n:::').calloutCount).toBe(2);
  });
  it('maps a single-line paragraph through frontmatter to the original line', () => {
    const markdown = '---\ntitle: X\n---\n\n# Heading\n\nSingle line.';
    const { body, frontmatterLineOffset } = stripFrontmatterOffset(markdown);
    const tree = parseProseTree(body, { isMdx: false });
    const { textBlocks } = extractTextBlocks(tree, markdown.split('\n'), frontmatterLineOffset);
    expect(textBlocks.find((b) => b.joinedText === 'Single line.')?.segments).toEqual([{ line: 7, text: 'Single line.' }]);
  });
  it('maps each of three soft-wrapped source lines through frontmatter', () => {
    const markdown = '---\ntitle: X\n---\n\nFirst line\nsecond line\nthird line.';
    const { body, frontmatterLineOffset } = stripFrontmatterOffset(markdown);
    const tree = parseProseTree(body, { isMdx: false });
    const { textBlocks } = extractTextBlocks(tree, markdown.split('\n'), frontmatterLineOffset);
    expect(textBlocks).toHaveLength(1);
    expect(textBlocks[0].segments).toEqual([
      { line: 5, text: 'First line' }, { line: 6, text: 'second line' }, { line: 7, text: 'third line.' },
    ]);
  });
  it('maps aside body lines past both frontmatter and the marker', () => {
    const markdown = '---\ntitle: X\n---\n\n:::note[Title]\nInside text.\n:::';
    const { body, frontmatterLineOffset } = stripFrontmatterOffset(markdown);
    const tree = parseProseTree(body, { isMdx: false });
    const { textBlocks, calloutCount } = extractTextBlocks(tree, markdown.split('\n'), frontmatterLineOffset);
    expect(calloutCount).toBe(1);
    expect(textBlocks.find((b) => b.joinedText === 'Inside text.')?.segments).toEqual([{ line: 6, text: 'Inside text.' }]);
  });
  it('resolves a joined-text offset in source line two to line two', () => {
    const block = extract('First line\nsecond line continues.').textBlocks[0];
    const offset = block.joinedText.indexOf('second');
    expect(offset).toBeGreaterThan(0);
    expect(block.lineMap.filter((entry) => entry.offset <= offset).at(-1)?.line).toBe(2);
  });
});

describe('splitSentences', () => {
  it('splits English period, exclamation, and question mark with starting offsets', () => {
    expect(splitSentences('One. Two! Three?', 'en')).toEqual([
      { text: 'One.', offset: 0 }, { text: 'Two!', offset: 5 }, { text: 'Three?', offset: 10 },
    ]);
  });
  it('accepts an early split at an English abbreviation', () => {
    expect(splitSentences('Use e.g. examples.', 'en')).toEqual([
      { text: 'Use e.g.', offset: 0 }, { text: 'examples.', offset: 9 },
    ]);
  });
  it.each([
    ['ja', '一文。二文！三文？'], ['zh-cn', '一句。二句！三句？'],
  ])('splits adjacent %s sentences without whitespace', (locale, input) => {
    expect(splitSentences(input, locale)).toEqual([
      { text: input.slice(0, 3), offset: 0 },
      { text: input.slice(3, 6), offset: 3 },
      { text: input.slice(6), offset: 6 },
    ]);
  });
  it.each(['en', 'ja', 'zh-cn'])('treats paragraph end as one %s sentence without punctuation', (locale) => {
    expect(splitSentences('No terminal punctuation', locale)).toEqual([{ text: 'No terminal punctuation', offset: 0 }]);
  });
  it.each(['ja', 'zh-cn'])('does not treat combining marks or emoji as %s boundaries', (locale) => {
    expect(splitSentences('か\u3099😀続く。次。', locale)).toEqual([
      { text: 'か\u3099😀続く。', offset: 0 }, { text: '次。', offset: 7 },
    ]);
  });
});
