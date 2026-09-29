import { describe, expect, it } from 'vitest';
import { normalizeTestMd } from '#core/ir/normalize.js';
import { GeneratedElementIntent } from '#core/ir/schema.js';
import type { ElementIntent, GeneratedElementIntent as GeneratedIntent } from '#core/ir/schema.js';
import {
  attributeElementIntent,
  validateCommittedElementIntent,
} from '#usecases/element-intent-policy.js';
import type { ElementIntentIssueCode } from '#usecases/element-intent-policy.js';

const SOURCE = '「ログイン」ボタンを押す';
const FULL_SPAN = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 13 };
const QUOTE_SPAN = { startLine: 1, startColumn: 2, endLine: 1, endColumn: 6 };

function proposal(overrides: Partial<GeneratedIntent> = {}): GeneratedIntent {
  return {
    description: 'Press the login button',
    roleHint: 'button',
    startAnchor: 'L1',
    startColumn: 1,
    endAnchor: 'L1',
    endColumn: 13,
    citation: SOURCE,
    quote: { startAnchor: 'L1', startColumn: 2, endAnchor: 'L1', endColumn: 6, text: 'ログイン' },
    ...overrides,
  };
}

function expectAttributionIssues(
  generated: GeneratedIntent,
  source: string,
  codes: readonly ElementIntentIssueCode[],
): void {
  const result = attributeElementIntent(generated, normalizeTestMd(source));
  expect(result.success).toBe(false);
  if (result.success) throw new Error('Expected attribution issues');
  expect(result.issues.map(({ code }) => code)).toEqual(codes);
}

function committed(): ElementIntent {
  return {
    description: 'Press the login button',
    roleHint: 'button',
    sourceSpan: FULL_SPAN,
    quote: { text: 'ログイン', sourceSpan: QUOTE_SPAN },
  };
}

describe('TEST-I2: provider element-intent attribution (SPEC-I2, SPEC-I3)', () => {
  it('commits the normal source-backed intent', () => {
    const result = attributeElementIntent(proposal(), normalizeTestMd(SOURCE));
    expect(result).toEqual({ success: true, data: committed() });
  });

  it.each([
    ['「ログイン」', '「', '」'],
    ['『ログイン』', '『', '』'],
    ['“ログイン”', '“', '”'],
    ['"ログイン"', '"', '"'],
    ["'ログイン'", "'", "'"],
  ] as const)('accepts paired marks in %s', (source, _open, _close) => {
    const generated = proposal({ citation: source, endColumn: source.length + 1 });
    const result = attributeElementIntent(generated, normalizeTestMd(source));
    expect(result).toEqual({
      success: true,
      data: { ...committed(), sourceSpan: { ...FULL_SPAN, endColumn: source.length + 1 } },
    });
  });

  it.each([
    ['invalid L0 anchor', proposal({ startAnchor: 'L0' }), SOURCE, 'anchor-invalid'],
    ['line beyond source', proposal({ endAnchor: 'L2' }), SOURCE, 'anchor-invalid'],
    ['surrogate boundary split', proposal({ endColumn: 2, citation: '😀' , quote: undefined }), '😀', 'intent-span-invalid'],
    ['zero-width span', proposal({ endColumn: 1, quote: undefined }), SOURCE, 'intent-span-invalid'],
    ['whitespace-only intent', proposal({ endColumn: 4, citation: '   ', quote: undefined }), '   ', 'intent-span-whitespace-only'],
    ['citation differs from source', proposal({ citation: '別の本文' }), SOURCE, 'intent-citation-mismatch'],
    ['zero-width quote span', proposal({ quote: { ...proposal().quote!, endColumn: 2 } }), SOURCE, 'quote-span-invalid'],
    ['quote text differs by one character', proposal({ quote: { ...proposal().quote!, text: 'ログイソ' } }), SOURCE, 'quote-text-mismatch'],
    ['opening and closing marks are unpaired', proposal({ citation: '「ログイン”', endColumn: 7 }), '「ログイン”', 'quote-unpaired'],
    ['quote ends at source end without marks', proposal({ citation: ' ログイン', endColumn: 6 }), ' ログイン', 'quote-unpaired'],
    ['quote lies outside intent span', proposal({ startColumn: 7, citation: 'ボタンを押す' }), SOURCE, 'quote-outside-intent'],
    ['quote contains whitespace only', proposal({ citation: '「   」ボタンを押す', endColumn: 12, quote: { startAnchor: 'L1', startColumn: 2, endAnchor: 'L1', endColumn: 5, text: '   ' } }), '「   」ボタンを押す', 'quote-whitespace-only'],
  ] as const)('reports only %s', (_name, generated, source, code) => {
    expectAttributionIssues(generated, source, [code]);
  });

  it('accepts an intent and quote spanning multiple lines', () => {
    const source = '「ログイン\nボタン」を押す';
    const generated = proposal({
      citation: source,
      endAnchor: 'L2',
      endColumn: 8,
      quote: { startAnchor: 'L1', startColumn: 2, endAnchor: 'L2', endColumn: 4, text: 'ログイン\nボタン' },
    });
    expect(attributeElementIntent(generated, normalizeTestMd(source))).toEqual({
      success: true,
      data: {
        description: generated.description,
        roleHint: 'button',
        sourceSpan: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 8 },
        quote: { text: 'ログイン\nボタン', sourceSpan: { startLine: 1, startColumn: 2, endLine: 2, endColumn: 4 } },
      },
    });
  });

  it('uses coordinates of CRLF-normalized Markdown', () => {
    const generated = proposal({
      citation: SOURCE,
      startAnchor: 'L2', endAnchor: 'L2',
      quote: { startAnchor: 'L2', startColumn: 2, endAnchor: 'L2', endColumn: 6, text: 'ログイン' },
    });
    const result = attributeElementIntent(generated, normalizeTestMd('見出し\r\n' + SOURCE));
    expect(result).toEqual({
      success: true,
      data: {
        ...committed(),
        sourceSpan: { ...FULL_SPAN, startLine: 2, endLine: 2 },
        quote: { text: 'ログイン', sourceSpan: { ...QUOTE_SPAN, startLine: 2, endLine: 2 } },
      },
    });
  });

  it('collects independent anchor and quote issues in path order', () => {
    const generated = proposal({ startAnchor: 'L0', citation: '「ログイン”ボタンを押す' });
    const result = attributeElementIntent(generated, normalizeTestMd('「ログイン”ボタンを押す'));
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected attribution issues');
    expect(result.issues.map(({ code }) => code).sort()).toEqual(['anchor-invalid', 'quote-unpaired']);
    const paths = result.issues.map(({ path }) => JSON.stringify(path));
    expect(paths).toEqual([...paths].sort());
  });

  it('accepts a citation of 4096 UTF-16 characters', () => {
    const citation = 'x'.repeat(4096);
    const generated = proposal({ citation, endColumn: 4097, quote: undefined });
    expect(GeneratedElementIntent.safeParse(generated).success).toBe(true);
    expect(attributeElementIntent(generated, normalizeTestMd(citation))).toEqual({
      success: true,
      data: { description: generated.description, roleHint: 'button', sourceSpan: { ...FULL_SPAN, endColumn: 4097 } },
    });
  });

  it('rejects a citation of 4097 UTF-16 characters at the provider schema boundary', () => {
    const citation = 'x'.repeat(4097);
    const generated = proposal({ citation, endColumn: 4098, quote: undefined });
    attributeElementIntent(generated, normalizeTestMd(citation));
    expect(GeneratedElementIntent.safeParse(generated).success).toBe(false);
  });
});

describe('TEST-I3: committed element-intent revalidation (SPEC-I4)', () => {
  it.each([
    ['quote body changes', '「ログア」ボタンを押す', committed(), 'quote-text-mismatch'],
    ['surrounding quote marks disappear', ' ログイン ボタンを押す', committed(), 'quote-unpaired'],
    ['quote coordinates move outside intent', SOURCE, { ...committed(), sourceSpan: { ...FULL_SPAN, startColumn: 7 } }, 'quote-outside-intent'],
  ] as const)('rejects when %s', (_name, source, intent, code) => {
    const result = validateCommittedElementIntent(intent, normalizeTestMd(source));
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected committed-intent issues');
    expect(result.issues.some((issue) => issue.code === code)).toBe(true);
  });

  it('returns the current extracted intent and quote text for the original source', () => {
    const result = validateCommittedElementIntent(committed(), normalizeTestMd(SOURCE));
    expect(result).toEqual({
      success: true,
      data: committed(),
      extractedText: SOURCE,
      extractedQuoteText: 'ログイン',
    });
  });

  it('returns only extractedText for an unquoted committed intent', () => {
    const intent: ElementIntent = { description: 'Press the login button', sourceSpan: FULL_SPAN };
    const result = validateCommittedElementIntent(intent, normalizeTestMd(SOURCE));
    expect(result).toEqual({ success: true, data: intent, extractedText: SOURCE });
  });
});
