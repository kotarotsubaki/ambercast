/**
 * Keeps the four fixed artifact rules and their text transformations in core
 * as pure functions. This lets planning, applying, and runtime composition
 * share one testable definition without coupling it to paths or storage.
 * A generic template engine or a repository per artifact would add indirection
 * without serving this deliberately small, fixed scaffold.
 */
import {
  AGENTS_BLOCK,
  CONFIG_TEMPLATE,
  GITIGNORE_APPEND_UNIT,
  SAMPLE_TEMPLATE,
} from './templates.js';

/**
 * Keeps init's pre-write classification aligned with exclusive updates when a
 * file starts with a UTF-8 BOM. `FsStorage.readTextSnapshotIfExists().text`
 * strips that BOM because `TextDecoder` defaults to `ignoreBOM: false`, while
 * `updateTextExclusive` obtains its commit-time `current` through
 * `readFile(path, 'utf8')`, which preserves it as a literal character. A file
 * differing only by that character could otherwise be skipped during planning
 * and become a conflict or replacement during apply. Decoding the snapshot's
 * raw bytes with `ignoreBOM: true` makes both classifications see the same text.
 */
export function decodePreservingBom(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

export type InitAction = 'create' | 'replace' | 'append' | 'skipped';

export type InitRejectionReason = 'config-conflict' | 'agents-malformed-markers';

/** A valid planned action whose next-text shape is fixed by its action. */
export type ActionClassification =
  | { readonly kind: 'action'; readonly action: 'skipped'; readonly nextText: null }
  | {
      readonly kind: 'action';
      readonly action: Exclude<InitAction, 'skipped'>;
      readonly nextText: string;
    };

/**
 * Represents either a usable file action or a planning precondition failure.
 *
 * @remarks
 * The tagged rejection variant distinguishes conflicting configuration and
 * malformed-marker preflight failures from ordinary actions. The action
 * variants make skipped content the only case without replacement text.
 * Returning that distinction as data keeps callers from confusing a pure
 * classification result with an exception crossing an asynchronous boundary.
 */
export type ClassificationResult =
  | ActionClassification
  | { readonly kind: 'rejected'; readonly reason: InitRejectionReason };

/**
 * Classifies the configuration artifact against the scaffold contract.
 *
 * @param current - The existing text, or `null` when the artifact is absent.
 * @param force - Whether a differing existing configuration may be replaced.
 * @returns A create, skipped, replace, or rejected classification.
 * @remarks
 * Absence creates the literal, while only byte-identical existing content is
 * skipped. A difference is rejected unless `force` authorizes replacement;
 * configuration deliberately has no BOM or EOL projection because replacement
 * writes the canonical literal and therefore removes a BOM and normalizes EOLs.
 */
export function classifyConfig(current: string | null, force: boolean): ClassificationResult {
  if (current === null) {
    return { kind: 'action', action: 'create', nextText: CONFIG_TEMPLATE };
  }
  if (current === CONFIG_TEMPLATE) {
    return { kind: 'action', action: 'skipped', nextText: null };
  }
  if (force) {
    return { kind: 'action', action: 'replace', nextText: CONFIG_TEMPLATE };
  }
  return { kind: 'rejected', reason: 'config-conflict' };
}

/**
 * Classifies the sample prompt artifact.
 *
 * @param current - The existing text, or `null` when the artifact is absent.
 * @returns A create classification for absence or skipped classification for
 * an existing sample.
 * @remarks
 * The sample is intentionally content-blind after creation: preserving a
 * user's existing prompt avoids treating scaffold ownership as ongoing
 * ownership of that test.
 */
export function classifySample(current: string | null): ClassificationResult {
  return current === null
    ? { kind: 'action', action: 'create', nextText: SAMPLE_TEMPLATE }
    : { kind: 'action', action: 'skipped', nextText: null };
}

/**
 * Classifies the run-evidence ignore entry.
 *
 * @param current - The existing text, or `null` when the artifact is absent.
 * @returns A create, skipped, or append classification.
 * @remarks
 * An existing complete runs-directory line skips the artifact; absence creates
 * it and every other existing state appends the ignore unit. BOM handling and
 * first-line-break EOL projection stay inside classification so presentation
 * differences do not affect the complete-line semantic presence check.
 */
export function classifyGitignore(current: string | null): ClassificationResult {
  if (current === null) {
    return { kind: 'action', action: 'create', nextText: GITIGNORE_APPEND_UNIT };
  }
  const body = current.startsWith('\uFEFF') ? current.slice(1) : current;
  if (body.split(/\r\n|\r|\n/).some((line) => line === 'tests/ambercast/.runs/')) {
    return { kind: 'action', action: 'skipped', nextText: null };
  }
  return {
    kind: 'action',
    action: 'append',
    nextText: applyAppend(current, GITIGNORE_APPEND_UNIT, 'trailing-newline'),
  };
}

/**
 * Classifies the managed guidance block in `AGENTS.md`.
 *
 * @param current - The existing text, or `null` when the artifact is absent.
 * @returns A create, skipped, replace, append, or rejected classification.
 * @remarks
 * No markers appends the block; one ordered begin/end pair is skipped when its
 * EOL-projected content matches and otherwise replaces just that span. Any
 * other marker arrangement rejects the plan. Treating BOM and EOL projection
 * here prevents display formatting from changing this identity decision.
 */
export function classifyAgents(current: string | null): ClassificationResult {
  if (current === null) {
    return { kind: 'action', action: 'create', nextText: AGENTS_BLOCK };
  }

  const markers = markerLines(current);
  const begins = markers.filter((marker) => marker.kind === 'begin');
  const ends = markers.filter((marker) => marker.kind === 'end');
  if (begins.length === 0 && ends.length === 0) {
    return {
      kind: 'action',
      action: 'append',
      nextText: applyAppend(current, AGENTS_BLOCK, 'blank-line-separator'),
    };
  }
  if (begins.length !== 1 || ends.length !== 1 || begins[0]!.start >= ends[0]!.start) {
    return { kind: 'rejected', reason: 'agents-malformed-markers' };
  }

  const begin = begins[0]!;
  const end = ends[0]!;
  const managed = current.slice(begin.start, end.end);
  const projected = projectEol(AGENTS_BLOCK, current);
  return managed === projected
    ? { kind: 'action', action: 'skipped', nextText: null }
    : { kind: 'action', action: 'replace', nextText: applyBlockReplace(current, AGENTS_BLOCK) };
}

/** Selects the artifact-specific separator rule for an append. */
export type AppendMode = 'trailing-newline' | 'blank-line-separator';

/**
 * Appends a scaffold unit using the target text's newline convention.
 *
 * @param current - Existing text whose prefix, BOM, and newline style remain
 * preserved.
 * @param unit - The canonical LF-delimited unit to append.
 * @param mode - `trailing-newline` ensures one newline before the unit when
 * needed and a newline after it; `blank-line-separator` normalizes the boundary
 * between existing text and the unit to exactly one empty line.
 * @returns The complete transformed text.
 * @remarks
 * The modes make the `.gitignore` trailing-newline rule and `AGENTS.md`
 * blank-line-separator rule explicit. This is separate from classification
 * because EOL projection and separator normalization are text-transformation
 * concerns, not decisions about whether an artifact should be created,
 * replaced, appended, or skipped. Keeping that boundary makes the required
 * append combinations independently testable.
 */
export function applyAppend(current: string, unit: string, mode: AppendMode): string {
  const eol = selectEol(current);
  const projectedUnit = projectEol(unit, current);
  const body = current.startsWith('\uFEFF') ? current.slice(1) : current;
  if (body.length === 0) {
    return `${current}${projectedUnit}`;
  }

  if (mode === 'trailing-newline') {
    return `${current}${/\r?\n$/.test(current) ? '' : eol}${projectedUnit}`;
  }
  if (/(?:\r\n|\n){2}$/.test(current)) {
    return `${current}${projectedUnit}`;
  }
  return `${current}${/\r?\n$/.test(current) ? eol : `${eol}${eol}`}${projectedUnit}`;
}

/**
 * Replaces the managed marker span while preserving surrounding text.
 *
 * @param current - Existing text containing one valid managed marker pair.
 * @param block - The canonical LF-delimited replacement block.
 * @returns Text with the span from the beginning of the begin-marker line
 * through the end-marker line's terminating newline replaced.
 * @remarks
 * Replacement projects the block to the file's EOL and preserves the BOM and
 * all text before and after the exact marker-line span. Keeping this text
 * transformation apart from classification lets replacement combinations be
 * verified independently of action choice.
 */
export function applyBlockReplace(current: string, block: string): string {
  const markers = markerLines(current);
  const begin = markers.find((marker) => marker.kind === 'begin');
  const end = markers.find((marker) => marker.kind === 'end' && marker.start > (begin?.start ?? Infinity));
  if (begin === undefined || end === undefined) {
    return current;
  }
  return `${current.slice(0, begin.start)}${projectEol(block, current)}${current.slice(end.end)}`;
}

type MarkerLine = { readonly kind: 'begin' | 'end'; readonly start: number; readonly end: number };

function markerLines(text: string): readonly MarkerLine[] {
  const markers: MarkerLine[] = [];
  const offset = text.startsWith('\uFEFF') ? 1 : 0;
  const body = text.slice(offset);
  const linePattern = /([^\r\n]*)(\r\n|\n|$)/g;
  for (let match = linePattern.exec(body); match !== null; match = linePattern.exec(body)) {
    const trimmed = match[1]!.trim();
    const kind = trimmed === '<!-- ambercast:begin -->'
      ? 'begin'
      : trimmed === '<!-- ambercast:end -->'
        ? 'end'
        : null;
    if (kind !== null) {
      markers.push({ kind, start: offset + match.index, end: offset + match.index + match[0].length });
    }
    if (match[0].length === 0) {
      break;
    }
  }
  return markers;
}

function selectEol(text: string): '\n' | '\r\n' {
  return /\r\n|\n/.exec(text)?.[0] === '\r\n' ? '\r\n' : '\n';
}

function projectEol(unit: string, current: string): string {
  return selectEol(current) === '\r\n' ? unit.replaceAll('\n', '\r\n') : unit;
}
