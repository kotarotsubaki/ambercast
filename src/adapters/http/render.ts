// HTML renderers for the ambercast viewer HTTP adapter.

import { VIEW_COPY } from '#core/viewer/copy.js';
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

const page = (title: string, body: string): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} · ambercast</title><style>body{font-family:system-ui,sans-serif;max-width:70rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}th,td{padding:.5rem;border-bottom:1px solid #ddd;text-align:left}.verdigris{color:#087e72}.amber{color:#9a6700}pre{white-space:pre-wrap}</style></head><body><header>${VIEW_COPY.pageHeader.brand}</header>${body}</body></html>`;
const duration = (ms: number): string => ms < 1000 ? `${ms} ms` : `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
const reasonText = (reason: Extract<RunListing, { kind: 'unreadable' }>['reason']): string => ({
  'invalid-json': VIEW_COPY.list.cases.unreadableReasons.invalidJson,
  'schema-mismatch': VIEW_COPY.list.cases.unreadableReasons.schemaMismatch,
  'not-run-report': VIEW_COPY.list.cases.unreadableReasons.notRunReport,
  'read-error': VIEW_COPY.list.cases.unreadableReasons.readFailed,
})[reason];
const rawLink = (runId: string, label: string): string => `<a href="/runs/${runId}/report.json">${label}</a>`;
const statusText = (status: string): string => status === 'failed' ? VIEW_COPY.list.rowStatus.failed : status === 'error' ? VIEW_COPY.list.rowStatus.error : status === 'passed' ? VIEW_COPY.list.rowStatus.passed : status;

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
 */
export function renderRunList(listings: readonly RunListing[]): string {
  const copy = VIEW_COPY.list;
  if (listings.length === 0) return page(copy.title, `<h1>${copy.title}</h1><p>${copy.emptyState.line1}</p><p>${copy.emptyState.line2}</p>`);
  const headers = Object.values(copy.columnHeaders).map((label) => `<th>${label}</th>`).join('');
  const rows = listings.map((listing) => {
    const { runId } = listing;
    if (listing.kind !== 'readable') {
      const status = listing.kind === 'no-report' ? copy.rowStatus.noReport : copy.rowStatus.unreadable;
      const cases = listing.kind === 'no-report' ? copy.cases.evidenceOnly : reasonText(listing.reason);
      const link = listing.kind === 'unreadable' && listing.reason !== 'read-error' ? ` ${rawLink(runId, copy.runLinks.rawJson)}` : '';
      return `<tr><td>${status}</td><td>${escapeHtml(runId)}${link}</td><td>—</td><td>—</td><td>${cases}</td></tr>`;
    }
    const { summary, startedAt, durationMs } = listing.envelope;
    const status = summary.failed > 0 ? copy.rowStatus.failed : summary.errored > 0 ? copy.rowStatus.error : summary.passed > 0 ? copy.rowStatus.passed : copy.rowStatus.empty;
    const counts = [[summary.passed, 'passed'], [summary.failed, 'failed'], [summary.errored, 'error'], [summary.skipped, 'skipped']].filter(([count]) => Number(count) > 0).map(([count, name]) => `${count} ${name}`).join(' · ') || '0 cases';
    return `<tr><td>${status}</td><td>${escapeHtml(runId)} <a href="/runs/${runId}">${copy.runLinks.openRun}</a></td><td>${escapeHtml(startedAt)}</td><td>${duration(durationMs)}</td><td>${counts}</td></tr>`;
  }).join('');
  return page(copy.title, `<h1>${copy.title}</h1><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`);
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
    const reason = listing.kind === 'unreadable' ? reasonText(listing.reason) : VIEW_COPY.list.cases.evidenceOnly;
    return page(escapeHtml(runId), `<h1>${copy.unreadable.heading}</h1><p>${reason}</p>${rawLink(runId, copy.unreadable.rawJson)}`);
  }
  const report = listing.envelope;
  const summary = report.summary;
  const totals = `${summary.passed} passed · ${summary.failed} failed · ${summary.errored} error · ${summary.skipped} skipped`;
  const header = `<h1>${escapeHtml(runId)}</h1><p>${copy.header.started} ${escapeHtml(report.startedAt)} · ${copy.header.duration} ${duration(report.durationMs)} · ${totals} · ${report.reportPersistence === 'failed' ? copy.header.reportFailed : copy.header.reportPersisted} · ${rawLink(runId, copy.header.rawJson)}</p>`;
  const errors = report.errors.length ? `<section><h2>${copy.runErrors.headingPrefix}${report.errors.length})</h2><ul>${report.errors.map((error) => `<li>${escapeHtml(error.code)} · ${error.scope === 'run' ? 'run' : `case · ${escapeHtml(error.caseId)}`} ${escapeHtml(error.message)}</li>`).join('')}</ul></section>` : '';
  const cases = report.results.length ? report.results.map((result) => {
    if (result.status === 'listed' || result.status === 'skipped') return `<p>${result.status === 'listed' ? copy.listedSkipped.listedPrefix : copy.listedSkipped.skippedPrefix}${escapeHtml(result.file)}</p>`;
    const calls = result.aiCalls ?? 0;
    const auxiliary = `<p>${copy.caseAuxiliary.plan} ${escapeHtml(result.planFile)}${result.id === result.file ? '' : ` · ${copy.caseAuxiliary.id} ${escapeHtml(result.id)}`}</p><p><span>${copy.caseAuxiliary.explanation}</span> ${escapeHtml(result.explanation)}</p>`;
    const columns = Object.values(copy.stepTable).map((label) => `<th>${label}</th>`).join('');
    const steps = result.steps.map((step, index) => {
      const diagnostics = step.status === 'failed' || step.status === 'error' ? `${step.expected === undefined ? '' : `<p>${copy.failedStep.expected} ${escapeHtml(step.expected)}</p>`}${step.actual === undefined ? '' : `<p>${copy.failedStep.actual} ${escapeHtml(step.actual)}</p>`}` : '';
      const screenshot = step.screenshotOmitted ? `<p>${copy.failedStep.screenshotOmitted}</p>` : step.screenshot === undefined ? '' : `<img src="/runs/${runId}/screenshots/${escapeHtml(encodeURIComponent(step.screenshot))}" alt="${copy.snapshotAltPrefix}${escapeHtml(step.id)}">`;
      const observed = step.observed ? `<details><summary>${copy.snapshotDetails.summary}</summary><p>${escapeHtml(step.observed.note)}</p><pre>${escapeHtml(step.observed.accessibilitySnapshot)}</pre></details>` : '';
      return `<tr><td>${index + 1}</td><td>${escapeHtml(step.id)}</td><td>${escapeHtml(step.type)}</td><td>${escapeHtml(step.status)}</td></tr>${diagnostics || screenshot || observed ? `<tr><td colspan="4">${diagnostics}${screenshot}${observed}</td></tr>` : step.status === 'failed' || step.status === 'error' ? '<tr><td colspan="4">—</td></tr>' : ''}`;
    }).join('');
    return `<section><h2>${statusText(result.status)} · ${escapeHtml(result.file)} · <span class="${calls === 0 ? 'verdigris' : 'amber'}">${calls}${copy.case.aiCallsSuffix}</span> · ${duration(result.durationMs)}</h2>${auxiliary}<table><thead><tr>${columns}</tr></thead><tbody>${steps}</tbody></table></section>`;
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
