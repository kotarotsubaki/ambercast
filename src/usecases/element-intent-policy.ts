/** Local attribution and revalidation of source-backed element intent. */
import type {
  ElementIntent,
  GeneratedElementIntent,
  GeneratedQuotedElementIntent,
  QuotedElementIntent,
} from '#core/ir/schema.js';
import { extractSpan, resolveBoundaryOffset } from './instruction-coverage-policy.js';

/** Closed diagnostic reasons for source attribution failures. */
export type ElementIntentIssueCode =
  | 'anchor-invalid'
  | 'intent-span-invalid'
  | 'intent-span-whitespace-only'
  | 'intent-citation-mismatch'
  | 'quote-span-invalid'
  | 'quote-text-mismatch'
  | 'quote-unpaired'
  | 'quote-outside-intent'
  | 'quote-whitespace-only';

/** One actionable issue at a caller-prefixed step path. */
export interface ElementIntentIssue {
  readonly code: ElementIntentIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/** Mirrors instruction-coverage policy's success/data or failure/issues form. */
export type ElementIntentResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: readonly ElementIntentIssue[] };

/** Provider attribution result with locally established committed provenance. */
export type AttributionResult = ElementIntentResult<ElementIntent | QuotedElementIntent>;

/** Committed-intent validation with text re-extracted from its source spans. */
export type ValidationResult =
  | {
    readonly success: true;
    readonly data: ElementIntent | QuotedElementIntent;
    readonly extractedText: string;
    readonly extractedQuoteText?: string;
  }
  | { readonly success: false; readonly issues: readonly ElementIntentIssue[] };

type SourceSpan = ElementIntent['sourceSpan'];

function issue(code: ElementIntentIssueCode, path: readonly string[], message: string): ElementIntentIssue {
  return { code, path, message };
}

function sortedIssues(issues: ElementIntentIssue[]): ElementIntentIssue[] {
  return issues.sort((left, right) => JSON.stringify(left.path).localeCompare(JSON.stringify(right.path)));
}

function boundaries(source: string, span: SourceSpan): { start: number; end: number } | undefined {
  const lines = source.split('\n');
  const start = resolveBoundaryOffset(source, lines, span.startLine, span.startColumn);
  const end = resolveBoundaryOffset(source, lines, span.endLine, span.endColumn);
  return start === undefined || end === undefined ? undefined : { start, end };
}

function quoteIssues(
  source: string,
  quoteSpan: SourceSpan,
  quoteText: string,
  intentSpan: SourceSpan | undefined,
): ElementIntentIssue[] {
  const issues: ElementIntentIssue[] = [];
  const extracted = extractSpan(source, quoteSpan);
  if (extracted === undefined) return [issue('quote-span-invalid', ['quote'], 'The quote span is invalid.')];
  if (extracted !== quoteText) issues.push(issue('quote-text-mismatch', ['quote', 'text'], 'The quote text differs from the source.'));

  const quoteBounds = boundaries(source, quoteSpan)!;
  const before = source[quoteBounds.start - 1];
  const after = source[quoteBounds.end];
  const pairs = new Map([['「', '」'], ['『', '』'], ['“', '”'], ['"', '"'], ["'", "'"]]);
  if (before === undefined || pairs.get(before) !== after) {
    issues.push(issue('quote-unpaired', ['quote'], 'The quote is not surrounded by matching marks.'));
  }
  if (intentSpan !== undefined) {
    const intentBounds = boundaries(source, intentSpan)!;
    if (quoteBounds.start < intentBounds.start || quoteBounds.end > intentBounds.end) {
      issues.push(issue('quote-outside-intent', ['quote'], 'The quote lies outside the intent span.'));
    } else if (!/\S/u.test(extracted)) {
      issues.push(issue('quote-whitespace-only', ['quote', 'text'], 'The quote contains only whitespace.'));
    }
  } else if (!/\S/u.test(extracted)) {
    issues.push(issue('quote-whitespace-only', ['quote', 'text'], 'The quote contains only whitespace.'));
  }
  return issues;
}

/**
 * Attributes a provider proposal to exact normalized Markdown spans.
 *
 * @remarks Validate anchor grammar and line range (`anchor-invalid`), then
 * coordinates, surrogate boundaries, and positive width (`intent-span-invalid`).
 * Reject whitespace-only intent text and citation mismatch with extracted
 * literal text. Independently validate a quoted span and its literal text,
 * paired surrounding marks (`「」`, `『』`, `“”`, `""`, `''`),
 * containment in the intent span (including touching boundaries), and
 * non-whitespace quote text. Report `quote-span-invalid`,
 * `quote-text-mismatch`, `quote-unpaired`, `quote-outside-intent`, or
 * `quote-whitespace-only` as applicable. Use the shared
 * {@link resolveBoundaryOffset} and {@link extractSpan} helpers. Collect every
 * independently checkable issue: a failed span suppresses only checks derived
 * from that span, never checks on another valid span. Sort this one intent's
 * issues by path. {@link prepareInstructionCoveredSteps} combines results
 * across steps and owns step-index-then-path ordering of that combined list.
 *
 * @param generated - Provider coordinates and citation awaiting attribution.
 * @param normalizedTestMd - Exact normalized source used for extraction.
 * @returns Committed intent or all independently observable issues.
 */
export function attributeElementIntent(
  generated: GeneratedElementIntent | GeneratedQuotedElementIntent,
  normalizedTestMd: string,
): AttributionResult {
  const issues: ElementIntentIssue[] = [];
  const startAnchor = /^L([1-9]\d*)$/.exec(generated.startAnchor);
  const endAnchor = /^L([1-9]\d*)$/.exec(generated.endAnchor);
  if (startAnchor === null) issues.push(issue('anchor-invalid', ['startAnchor'], 'The start anchor is invalid.'));
  if (endAnchor === null) issues.push(issue('anchor-invalid', ['endAnchor'], 'The end anchor is invalid.'));

  let intentSpan: SourceSpan | undefined;
  if (startAnchor !== null && endAnchor !== null) {
    const candidate = {
      startLine: Number(startAnchor[1]), startColumn: generated.startColumn,
      endLine: Number(endAnchor[1]), endColumn: generated.endColumn,
    };
    const extracted = extractSpan(normalizedTestMd, candidate);
    if (extracted === undefined) {
      const lines = normalizedTestMd.split('\n');
      const start = resolveBoundaryOffset(normalizedTestMd, lines, candidate.startLine, candidate.startColumn);
      const end = resolveBoundaryOffset(normalizedTestMd, lines, candidate.endLine, candidate.endColumn);
      const path = start === undefined
        ? candidate.startLine > lines.length ? 'startAnchor' : 'startColumn'
        : end === undefined
          ? candidate.endLine > lines.length ? 'endAnchor' : 'endColumn'
          : candidate.endLine < candidate.startLine ? 'endAnchor' : 'endColumn';
      const code = path.endsWith('Anchor') ? 'anchor-invalid' : 'intent-span-invalid';
      issues.push(issue(code, [path], 'The intent span is invalid.'));
    } else {
      intentSpan = candidate;
      if (!/\S/u.test(extracted)) issues.push(issue('intent-span-whitespace-only', ['citation'], 'The intent span contains only whitespace.'));
      else if (extracted !== generated.citation) issues.push(issue('intent-citation-mismatch', ['citation'], 'The citation differs from the source.'));
    }
  }

  let quoteSpan: SourceSpan | undefined;
  if (generated.quote !== undefined) {
    const quote = generated.quote;
    const quoteStart = /^L([1-9]\d*)$/.exec(quote.startAnchor);
    const quoteEnd = /^L([1-9]\d*)$/.exec(quote.endAnchor);
    if (quoteStart === null) issues.push(issue('quote-span-invalid', ['quote', 'startAnchor'], 'The quote start anchor is invalid.'));
    if (quoteEnd === null) issues.push(issue('quote-span-invalid', ['quote', 'endAnchor'], 'The quote end anchor is invalid.'));
    if (quoteStart !== null && quoteEnd !== null) {
      quoteSpan = {
        startLine: Number(quoteStart[1]), startColumn: quote.startColumn,
        endLine: Number(quoteEnd[1]), endColumn: quote.endColumn,
      };
      issues.push(...quoteIssues(normalizedTestMd, quoteSpan, quote.text, intentSpan));
    }
  }

  if (issues.length > 0) return { success: false, issues: sortedIssues(issues) };
  const data: ElementIntent = {
    description: generated.description,
    ...(generated.roleHint === undefined ? {} : { roleHint: generated.roleHint }),
    sourceSpan: intentSpan!,
    ...(generated.quote === undefined ? {} : { quote: { text: generated.quote.text, sourceSpan: quoteSpan! } }),
  };
  return { success: true, data };
}

/**
 * Revalidates committed element intent against current normalized Markdown.
 *
 * @remarks Apply the same independent-check ladder as provider attribution:
 * span range and surrogate boundaries, whitespace-only text, then quoted
 * span validity, literal text equality without normalization, paired quote
 * marks (`「」`, `『』`, `“”`, `""`, `''`), containment (boundary-touching
 * counts), and quote whitespace. The committed shape has no anchors or
 * citation, so those provider-only checks have no input here. Reuse
 * {@link resolveBoundaryOffset} and
 * {@link extractSpan}; skip only checks whose own required span cannot be
 * extracted, and collect all unrelated issues. Sort this one intent's issues
 * by path. {@link prepareInstructionCoveredSteps} combines results across
 * steps and owns step-index-then-path ordering of that combined list.
 *
 * @param intent - The committed source-backed intent to validate.
 * @param normalizedTestMd - Current normalized source of truth.
 * @returns Validated intent with `extractedText` from its intent span and,
 * when quoted, `extractedQuoteText` from its quote span (SPEC-I4), or all
 * independently observable issues.
 */
export function validateCommittedElementIntent(
  intent: ElementIntent | QuotedElementIntent,
  normalizedTestMd: string,
): ValidationResult {
  const issues: ElementIntentIssue[] = [];
  const extractedText = extractSpan(normalizedTestMd, intent.sourceSpan);
  if (extractedText === undefined) issues.push(issue('intent-span-invalid', ['sourceSpan'], 'The intent span is invalid.'));
  else if (!/\S/u.test(extractedText)) issues.push(issue('intent-span-whitespace-only', ['sourceSpan'], 'The intent span contains only whitespace.'));

  let extractedQuoteText: string | undefined;
  if (intent.quote !== undefined) {
    extractedQuoteText = extractSpan(normalizedTestMd, intent.quote.sourceSpan);
    issues.push(...quoteIssues(normalizedTestMd, intent.quote.sourceSpan, intent.quote.text,
      extractedText === undefined ? undefined : intent.sourceSpan));
  }
  if (issues.length > 0) return { success: false, issues: sortedIssues(issues) };
  return {
    success: true, data: intent, extractedText: extractedText!,
    ...(intent.quote === undefined ? {} : { extractedQuoteText: extractedQuoteText! }),
  };
}
