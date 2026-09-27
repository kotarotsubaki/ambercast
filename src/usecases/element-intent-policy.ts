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

/** Committed-intent validation result. */
export type ValidationResult = ElementIntentResult<ElementIntent | QuotedElementIntent>;

/**
 * Attributes a provider proposal to exact normalized Markdown spans.
 *
 * @remarks Validate anchor grammar and line range (`anchor-invalid`), then
 * coordinates, surrogate boundaries, and positive width (`intent-span-invalid`).
 * Reject whitespace-only intent text and citation mismatch with extracted
 * literal text. Independently validate a quoted span and its literal text,
 * paired surrounding marks (「」, 『』, curly double and single quotes),
 * containment in the intent span (including touching boundaries), and
 * non-whitespace quote text. Report `quote-span-invalid`,
 * `quote-text-mismatch`, `quote-unpaired`, `quote-outside-intent`, or
 * `quote-whitespace-only` as applicable. Use the shared
 * {@link resolveBoundaryOffset} and {@link extractSpan} helpers. Collect every
 * independently checkable issue: a failed span suppresses only checks derived
 * from that span, never checks on another valid span. Sort by step index, then
 * path, as in instruction coverage policy.
 *
 * @param generated - Provider coordinates and citation awaiting attribution.
 * @param normalizedTestMd - Exact normalized source used for extraction.
 * @returns Committed intent or all independently observable issues.
 */
export function attributeElementIntent(
  generated: GeneratedElementIntent | GeneratedQuotedElementIntent,
  normalizedTestMd: string,
): AttributionResult {
  throw new Error('not implemented (step 11)');
}

/**
 * Revalidates committed element intent against current normalized Markdown.
 *
 * @remarks Apply the same independent-check ladder as provider attribution:
 * span range and surrogate boundaries, whitespace-only text, then quoted
 * span validity, literal text equality without normalization, paired quote
 * marks, containment (boundary-touching counts), and quote whitespace. The
 * committed shape has no anchors or citation, so those provider-only checks
 * have no input here. Reuse {@link resolveBoundaryOffset} and
 * {@link extractSpan}; skip only checks whose own required span cannot be
 * extracted, collect all unrelated issues, and sort by step index then path.
 *
 * @param intent - The committed source-backed intent to validate.
 * @param normalizedTestMd - Current normalized source of truth.
 * @returns Validated intent or all independently observable issues.
 */
export function validateCommittedElementIntent(
  intent: ElementIntent | QuotedElementIntent,
  normalizedTestMd: string,
): ValidationResult {
  throw new Error('not implemented (step 11)');
}
