// HTML renderers for the ambercast viewer HTTP adapter.

import { VIEW_COPY } from '#core/viewer/copy.js';
import { REPORT_SCHEMA_VERSION } from '#runtime/view-command.js';
import type { RunListing } from '#runtime/view-command.js';

/**
 * Escapes report-controlled text for HTML text nodes and double-quoted attributes.
 *
 * @param value - Text that may originate from a run report or path.
 * @returns Text with `&`, `<`, `>`, `"`, and `'` replaced by `&amp;`, `&lt;`,
 * `&gt;`, `&quot;`, and `&#39;`, respectively.
 * @remarks
 * The same encoding contract covers visible text and attribute values; callers
 * must still enclose attributes in double quotes. Fixed copy is a trusted
 * constant. The `observed.note` value used in `renderRunDetail` comes directly
 * from the report data's own `observed.note` field, because `#report/schema.js`'s
 * `Observed` schema enforces `note` equals the fixed `OBSERVED_NOTE` value via
 * a `z.literal`. Core cannot import `#report/schema.js` (layering), so this
 * file reads the value the data already carries instead of duplicating it.
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// With table-layout:fixed, unspecified columns divide the width equally. The
// colgroups are the sole per-column width definitions, placed directly
// after each table's opening tag so Run and Step remain usable while Status,
// Started, Type, and # stay narrow regardless of cell content.
// The structural invariant is that LIST_COLGROUP has exactly five
// <col> entries matching renderRunList's <th> columns (Status, Run, Started,
// Duration, Cases), and STEP_COLGROUP has exactly four matching the step table's
// <th> columns (#, Step, Type, Status), in the same order.
const LIST_COLGROUP = '<colgroup><col style="width:8rem"><col><col style="width:11rem"><col style="width:6rem"><col style="width:12rem"></colgroup>';
const STEP_COLGROUP = '<colgroup><col style="width:3rem"><col><col style="width:6rem"><col style="width:8rem"></colgroup>';

// Issue #434 needs containment across the whole table: img max-width:100%
// alone leaves a 1280px screenshot tall enough to push the pass/fail verdict
// below the fold; long identifiers and expected/actual text also overflow.
// Fixed layout with explicit colgroups and overflow-wrap:anywhere on cell text
// and paragraphs keeps column positions stable. Height-capped linked thumbnails
// and scrollable <pre> snapshot boxes retain access to the original evidence.
// A lightbox would require client JavaScript despite CSP default-src 'none'; server-side
// thumbnails add dependency weight and risk changing the served evidence bytes.
const page = (title: string, body: string): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} · ambercast</title><style>body{background:#181310;color:#F1EBE2;font-family:system-ui,sans-serif;max-width:70rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{padding:.5rem;border-bottom:1px solid #3B332C;text-align:left;overflow-wrap:anywhere}th.num,td.num{text-align:right}p{overflow-wrap:anywhere}a{color:inherit;text-decoration:underline}img{display:block;max-width:100%;height:auto}.shot img{max-height:20rem;width:auto}.pass{color:#7FC8A9}.fail{color:#E8875E}.skip{color:#3D6FA6}.verdigris{color:#7FC8A9}.amber{color:#E8B063}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:24rem;overflow:auto}</style></head><body><header>${VIEW_COPY.pageHeader.brand}</header>${body}</body></html>`;
const duration = (ms: number): string => ms < 1000 ? `${ms} ms` : `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
/** Receives the unreadable branch intact because unsupported versions need their associated version text as well as the reason. */
const reasonText = (listing: Extract<RunListing, { kind: 'unreadable' }>): string => {
  if (listing.reason === 'unsupported-version') return `${VIEW_COPY.list.cases.unreadableReasons.unsupportedVersion} ${escapeHtml(listing.version)}`;
  return ({
    'invalid-json': VIEW_COPY.list.cases.unreadableReasons.invalidJson,
    'schema-mismatch': VIEW_COPY.list.cases.unreadableReasons.schemaMismatch,
    'not-run-report': VIEW_COPY.list.cases.unreadableReasons.notRunReport,
    'read-error': VIEW_COPY.list.cases.unreadableReasons.readFailed,
  } as const)[listing.reason];
};
const rawLink = (runId: string, label: string): string => `<a href="/runs/${escapeHtml(runId)}/report.json">${label}</a>`;
type BadgeStatus = 'passed' | 'failed' | 'error' | 'skipped' | 'listed' | 'empty' | 'no-report' | 'unreadable';

/**
 * Renders shared status markup for list row statuses,
 * step-table Status cells, case headings, and listed/skipped one-liners.
 *
 * @param status - One of the viewer's display statuses.
 * @returns Exactly `<span class="${cls}">${label}</span>`, with no extra whitespace.
 * @remarks
 * Labels come from `VIEW_COPY.list.rowStatus` so the shared copy remains the
 * source of truth instead of duplicating display strings here.
 * The listed/skipped one-liner is `${badge} ${file}`: one separating space
 * and no other prefix. The closed `BadgeStatus` vocabulary makes an unmapped
 * status a compile error across all four rendering contexts.
 */
function statusBadge(status: BadgeStatus): string {
  const entry: Record<BadgeStatus, { readonly label: string; readonly cls: 'pass' | 'fail' | 'skip' }> = {
    passed: { label: VIEW_COPY.list.rowStatus.passed, cls: 'pass' },
    failed: { label: VIEW_COPY.list.rowStatus.failed, cls: 'fail' },
    error: { label: VIEW_COPY.list.rowStatus.error, cls: 'fail' },
    skipped: { label: VIEW_COPY.list.rowStatus.skipped, cls: 'skip' },
    listed: { label: VIEW_COPY.list.rowStatus.listed, cls: 'skip' },
    empty: { label: VIEW_COPY.list.rowStatus.empty, cls: 'skip' },
    'no-report': { label: VIEW_COPY.list.rowStatus.noReport, cls: 'fail' },
    unreadable: { label: VIEW_COPY.list.rowStatus.unreadable, cls: 'fail' },
  };
  const { label, cls } = entry[status];
  return `<span class="${cls}">${label}</span>`;
}

/**
 * Formats case counts with the same summary wording for list rows and detail
 * headers.
 *
 * @param summary - Counts for passed, failed, errored, and skipped cases.
 * @returns Nonzero terms in `passed`, `failed`, `error`, `skipped` order,
 * joined by ` · `; the all-zero summary renders the literal `0 cases`.
 * @remarks
 * `summary.errored` supplies the `error` label. Zero-valued terms are omitted
 * so both render paths share one count convention.
 */
function formatCounts(summary: { passed: number; failed: number; errored: number; skipped: number }): string {
  return [[summary.passed, 'passed'], [summary.failed, 'failed'], [summary.errored, 'error'], [summary.skipped, 'skipped']].filter(([count]) => Number(count) > 0).map(([count, name]) => `${count} ${name}`).join(' · ') || '0 cases';
}

/**
 * Renders the run index, including readable, missing-report, and unreadable rows.
 *
 * @param listings - Classified runs in display order.
 * @returns A complete HTML document, or the empty-state document for no runs.
 * @remarks
 * This is a pure string function with no storage, clock, or network I/O. Its
 * output depends only on `listings` and fixed copy, so the same input yields
 * the same output for snapshot tests. Only readable runs link to detail pages;
 * unreadable reports link to raw bytes unless the read itself failed.
 * A row's `runId` comes from its report directory name, and this exported pure renderer may receive arbitrary strings directly; escaping remains a render-layer invariant even though the HTTP router separately restricts in-scope IDs to `[A-Za-z0-9-]`.
 */
export function renderRunList(listings: readonly RunListing[]): string {
  const copy = VIEW_COPY.list;
  if (listings.length === 0) return page(copy.title, `<h1>${copy.title}</h1><p>${copy.emptyState.line1}</p><p>${copy.emptyState.line2}</p>`);
  const headers = Object.entries(copy.columnHeaders).map(([key, label]) => `<th${key === 'duration' ? ' class="num"' : ''}>${label}</th>`).join('');
  const rows = listings.map((listing) => {
    const { runId } = listing;
    if (listing.kind !== 'readable') {
      const status = statusBadge(listing.kind === 'no-report' ? 'no-report' : 'unreadable');
      const cases = listing.kind === 'no-report' ? copy.cases.evidenceOnly : reasonText(listing);
      const link = listing.kind === 'unreadable' && listing.reason !== 'read-error' ? ` ${rawLink(runId, copy.runLinks.rawJson)}` : '';
      return `<tr><td>${status}</td><td>${escapeHtml(runId)}${link}</td><td>—</td><td>—</td><td>${cases}</td></tr>`;
    }
    const { summary, startedAt, durationMs } = listing.envelope;
    const status = statusBadge(summary.failed > 0 ? 'failed' : summary.errored > 0 ? 'error' : summary.passed > 0 ? 'passed' : 'empty');
    const counts = formatCounts(summary);
    return `<tr><td>${status}</td><td>${escapeHtml(runId)} <a href="/runs/${escapeHtml(runId)}">${copy.runLinks.openRun}</a></td><td>${escapeHtml(startedAt)}</td><td class="num">${duration(durationMs)}</td><td>${counts}</td></tr>`;
  }).join('');
  return page(copy.title, `<h1>${copy.title}</h1><table>${LIST_COLGROUP}<thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`);
}

/**
 * Renders a run report or the reason its report cannot be read.
 *
 * @param listing - The classified run selected by the detail route.
 * @returns A complete HTML document for the selected run.
 * @remarks
 * The template is a pure string function so identical input has identical
 * output in snapshot tests. Errors precede cases to keep run-level failures
 * visible. A screenshot omitted for secrets never becomes an image, even if
 * the report also carries a screenshot reference. Report-derived text and
 * attribute values pass through `escapeHtml`; the page uses inline CSS and no
 * client script or external resource references.
 */
export function renderRunDetail(listing: RunListing): string {
  const { runId } = listing;
  const copy = VIEW_COPY.detail;
  if (listing.kind !== 'readable') {
    const reason = listing.kind === 'unreadable' ? reasonText(listing) : VIEW_COPY.list.cases.evidenceOnly;
    const link =
      listing.kind === 'unreadable' && listing.reason !== 'read-error' ? rawLink(runId, copy.unreadable.rawJson) : '';
    return page(escapeHtml(runId), `<h1>${copy.unreadable.heading}</h1><p>${reason}</p>${link}`);
  }
  const report = listing.envelope;
  const summary = report.summary;
  const totals = formatCounts(summary);
  // Detail pages identify report formats differing from the current version, whether older or newer; the list stays compact and current reports need no schema label.
  const persistedLabel = report.reportPersistence === 'failed' ? copy.header.reportFailed : copy.header.reportPersisted;
  const schemaSegment = listing.envelope.schemaVersion !== REPORT_SCHEMA_VERSION ? ` · ${copy.header.schema} ${escapeHtml(listing.envelope.schemaVersion)}` : '';
  const header = `<h1>${escapeHtml(runId)}</h1><p>${copy.header.started} ${escapeHtml(report.startedAt)} · ${copy.header.duration} ${duration(report.durationMs)} · ${totals} · ${persistedLabel}${schemaSegment} · ${rawLink(runId, copy.header.rawJson)}</p>`;
  const errors = report.errors.length ? `<section><h2>${copy.runErrors.headingPrefix}${report.errors.length})</h2><ul>${report.errors.map((error) => `<li>${escapeHtml(error.code)} · ${error.scope === 'run' ? 'run' : `case · ${escapeHtml(error.caseId)}`} ${escapeHtml(error.message)}</li>`).join('')}</ul></section>` : '';
  const cases = report.results.length ? report.results.map((result) => {
    if (result.status === 'listed' || result.status === 'skipped') return `<p>${statusBadge(result.status)} ${escapeHtml(result.file)}</p>`;
    const calls = result.aiCalls ?? 0;
    const auxiliary = `<p>${copy.caseAuxiliary.plan} ${escapeHtml(result.planFile)}${result.id === result.file ? '' : ` · ${copy.caseAuxiliary.id} ${escapeHtml(result.id)}`}</p><p><span>${copy.caseAuxiliary.explanation}</span> ${escapeHtml(result.explanation)}</p>`;
    const columns = Object.entries(copy.stepTable).map(([key, label]) => `<th${key === 'columnHeaderNumber' ? ' class="num"' : ''}>${label}</th>`).join('');
    const steps = result.steps.map((step, index) => {
      const diagnostics = step.status === 'failed' || step.status === 'error' ? `${step.expected === undefined ? '' : `<p>${copy.failedStep.expected} ${escapeHtml(step.expected)}</p>`}${step.actual === undefined ? '' : `<p>${copy.failedStep.actual} ${escapeHtml(step.actual)}</p>`}` : '';
      // Screenshot visibility depends only on omission and reference presence,
      // never step status: a passed capture step with a reference retains its
      // image. The thumbnail links to the same URL, preserving access
      // to the full-size PNG in a new tab with target="_blank" and rel="noopener";
      // the same-origin image already satisfies the img-src 'self' policy.
      // Attribute order is a tested contract, so reordering fails a test instead
      // of silently drifting as incidental formatting.
      // Lazy loading avoids fetching every image at once in runs with many
      // screenshots.
      const screenshotUrl = `/runs/${escapeHtml(runId)}/screenshots/${escapeHtml(encodeURIComponent(step.screenshot ?? ''))}`;
      const screenshot = step.screenshotOmitted ? `<p>${copy.failedStep.screenshotOmitted}</p>` : step.screenshot === undefined ? '' : `<a class="shot" href="${screenshotUrl}" target="_blank" rel="noopener"><img src="${screenshotUrl}" alt="${copy.snapshotAltPrefix}${escapeHtml(step.id)}" loading="lazy" decoding="async"></a>`;
      const observed = step.observed ? `<details><summary>${copy.snapshotDetails.summary}</summary><p>${escapeHtml(step.observed.note)}</p><pre>${escapeHtml(step.observed.accessibilitySnapshot)}</pre></details>` : '';
      return `<tr><td class="num">${index + 1}</td><td>${escapeHtml(step.id)}</td><td>${escapeHtml(step.type)}</td><td>${statusBadge(step.status)}</td></tr>${diagnostics || screenshot || observed ? `<tr><td colspan="4">${diagnostics}${screenshot}${observed}</td></tr>` : step.status === 'failed' || step.status === 'error' ? '<tr><td colspan="4">—</td></tr>' : ''}`;
    }).join('');
    return `<section><h2>${statusBadge(result.status)} · ${escapeHtml(result.file)} · <span class="${calls === 0 ? 'verdigris' : 'amber'}">${calls}${copy.case.aiCallsSuffix}</span> · ${duration(result.durationMs)}</h2>${auxiliary}<table>${STEP_COLGROUP}<thead><tr>${columns}</tr></thead><tbody>${steps}</tbody></table></section>`;
  }).join('') : `<p>${copy.emptyCases}</p>`;
  return page(escapeHtml(runId), header + errors + cases);
}

/**
 * Renders a fixed-title HTTP error page.
 *
 * @param title - Short error heading chosen by the router.
 * @param hint - Recovery or explanation text chosen by the router.
 * @returns A complete HTML document for the error response.
 * @remarks
 * This remains a pure string function with no I/O, keeping error snapshots
 * deterministic under the same inputs. The router owns status and headers.
 */
export function renderError(title: string, hint: string): string {
  return page(escapeHtml(title), `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(hint)}</p>`);
}
