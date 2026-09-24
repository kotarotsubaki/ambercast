import { describe, expect, it } from 'vitest';
import { OBSERVED_NOTE, REPORT_SCHEMA_VERSION, ReportEnvelope } from '../../report/schema.js';
import { VIEW_COPY } from '../../core/viewer/copy.js';
import type { RunListing } from '../../runtime/view-command.js';
import { escapeHtml, renderError, renderRunDetail, renderRunList } from './render.js';

const runId = '2026-09-23T120000-abc123';
const envelope = ReportEnvelope.parse({
  schemaVersion: REPORT_SCHEMA_VERSION,
  command: 'run',
  startedAt: '2026-09-23T12:00:00Z',
  durationMs: 850,
  summary: { total: 15, passed: 12, failed: 2, errored: 1, skipped: 0 },
  errors: [],
  reportPersistence: 'persisted',
  results: [],
});
if (envelope.command !== 'run') throw new Error('Expected run envelope');
const readable = (overrides: Partial<typeof envelope> = {}, id = runId): RunListing => ({ kind: 'readable', runId: id, envelope: { ...envelope, ...overrides } });
const executed = (overrides: Record<string, unknown> = {}) => ({
  id: 'case-id', file: 'case.test.md', planFile: 'case.ambercast.plan.json',
  status: 'failed' as const, durationMs: 850, aiCalls: 0, sessions: {}, steps: [], explanation: 'Failure explained', ...overrides,
});

function fixedCopyValues(value: unknown): Set<string> {
  if (typeof value === 'string') return new Set([value]);
  if (value === null || typeof value !== 'object') return new Set();
  return new Set(Object.values(value).flatMap((part) => [...fixedCopyValues(part)]));
}

describe('escapeHtml', () => {
  it.each([['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;'], ["'", '&#39;']])('escapes %s', (input, output) => {
    expect(escapeHtml(input)).toBe(output);
  });
  it('preserves ordinary text and escapes all metacharacters in order', () => {
    expect(escapeHtml('plain 123')).toBe('plain 123');
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('renderRunList', () => {
  it('renders every status, case count, reason, and link branch', () => {
    const rows: RunListing[] = [
      readable(),
      readable({ summary: { total: 2, passed: 0, failed: 0, errored: 1, skipped: 1 } }, 'error-run'),
      readable({ summary: { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 } }, 'passed-run'),
      readable({ summary: { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0 } }, 'empty-run'),
      { kind: 'no-report', runId: 'missing-run' },
      { kind: 'unreadable', runId: 'invalid-run', reason: 'invalid-json' },
      { kind: 'unreadable', runId: 'schema-run', reason: 'schema-mismatch' },
      { kind: 'unreadable', runId: 'foreign-run', reason: 'not-run-report' },
      { kind: 'unreadable', runId: 'io-run', reason: 'read-error' },
    ];
    const html = renderRunList(rows);
    expect(html).toContain('<title>Runs · ambercast</title>');
    for (const label of Object.values(VIEW_COPY.list.columnHeaders)) expect(html).toContain(label);
    for (const label of Object.values(VIEW_COPY.list.rowStatus)) expect(html).toContain(label);
    for (const reason of Object.values(VIEW_COPY.list.cases.unreadableReasons)) expect(html).toContain(reason);
    expect(html).toContain('12 passed · 2 failed · 1 error');
    expect(html).toContain('1 error · 1 skipped');
    expect(html).toContain('0 cases');
    expect(html).toContain(VIEW_COPY.list.cases.evidenceOnly);
    expect(html).toMatch(new RegExp(`<a[^>]+href="/runs/${runId}"[^>]*>${VIEW_COPY.list.runLinks.openRun}</a>`));
    expect(html).toContain(VIEW_COPY.list.runLinks.rawJson);
    for (const id of ['missing-run', 'io-run']) expect(html).not.toMatch(new RegExp(`<a[^>]+href="[^"]*${id}[^"]*"`));
    expect(html).toContain('2026-09-23T12:00:00Z');
    expect(html).toContain('850 ms');
    for (const id of ['missing-run', 'invalid-run', 'schema-run', 'foreign-run', 'io-run']) {
      expect(html).toMatch(new RegExp(`${id}[\\s\\S]*?—[\\s\\S]*?—`));
    }
  });

  it.each([[1200, '1.2 s'], [1249, '1.2 s'], [1250, '1.3 s']])('formats %i ms as %s', (durationMs, formatted) => {
    expect(renderRunList([readable({ durationMs })])).toContain(formatted);
  });

  it('uses the two-line empty state without a table', () => {
    const html = renderRunList([]);
    expect(html).toContain(VIEW_COPY.list.emptyState.line1);
    expect(html).toContain(VIEW_COPY.list.emptyState.line2);
    expect(html).not.toContain('<table');
  });
});

describe('renderRunDetail', () => {
  it('places scoped run errors before cases and renders the header', () => {
    const html = renderRunDetail(readable({
      errors: [
        { scope: 'run', kind: 'environment', code: 'INTERRUPTED', message: 'Run stopped' },
        { scope: 'case', kind: 'usage', code: 'MISSING_PLAN', caseId: 'case-id', message: 'Plan absent' },
      ],
      results: [executed()],
    }));
    expect(html).toContain(`<title>${runId} · ambercast</title>`);
    expect(html).toContain('Started 2026-09-23T12:00:00Z');
    expect(html).toContain('Duration 850 ms');
    expect(html).toContain('Report: persisted');
    expect(html).toContain(VIEW_COPY.detail.header.rawJson);
    expect(html.indexOf(`${VIEW_COPY.detail.runErrors.headingPrefix}2)`)).toBeLessThan(html.indexOf('case.test.md'));
    expect(html).toContain('INTERRUPTED · run');
    expect(html).toContain('Run stopped');
    expect(html).toContain('MISSING_PLAN · case · case-id');
    expect(html).toContain('Plan absent');
  });

  it('shows empty results and each unreadable reason', () => {
    expect(renderRunDetail(readable())).toContain(VIEW_COPY.detail.emptyCases);
    for (const [reason, label] of Object.entries({ 'invalid-json': VIEW_COPY.list.cases.unreadableReasons.invalidJson, 'schema-mismatch': VIEW_COPY.list.cases.unreadableReasons.schemaMismatch, 'not-run-report': VIEW_COPY.list.cases.unreadableReasons.notRunReport, 'read-error': VIEW_COPY.list.cases.unreadableReasons.readFailed }) as [Extract<RunListing, { kind: 'unreadable' }>['reason'], string][]) {
      const html = renderRunDetail({ kind: 'unreadable', runId, reason });
      expect(html).toContain(VIEW_COPY.detail.unreadable.heading);
      expect(html).toContain(label);
      if (reason === 'read-error') {
        expect(html).not.toContain(VIEW_COPY.detail.unreadable.rawJson);
      } else {
        expect(html).toContain(VIEW_COPY.detail.unreadable.rawJson);
      }
    }
  });

  it('shows identity, explanation, step columns and AI call color', () => {
    const html = renderRunDetail(readable({ results: [executed(), executed({ id: 'same.test.md', file: 'same.test.md', aiCalls: 3 }), executed({ id: 'unset', file: 'unset.test.md', aiCalls: undefined })] }));
    expect(html).toContain(`${VIEW_COPY.detail.caseAuxiliary.plan} case.ambercast.plan.json`);
    expect(html.match(/<p>(?:<span>)?Plan\b/g)).toHaveLength(3);
    expect(html).toContain(`${VIEW_COPY.detail.caseAuxiliary.id} case-id`);
    expect(html).not.toContain(`${VIEW_COPY.detail.caseAuxiliary.id} same.test.md`);
    expect(html).toContain(VIEW_COPY.detail.caseAuxiliary.explanation);
    expect(html).toContain('Failure explained');
    for (const label of Object.values(VIEW_COPY.detail.stepTable)) expect(html).toContain(label);
    expect(html).toMatch(/class="[^"]*verdigris[^"]*"[^>]*>0 AI calls/);
    expect(html).toMatch(/class="[^"]*amber[^"]*"[^>]*>3 AI calls/);
    expect(html.match(/0 AI calls/g)).toHaveLength(2);
  });

  it('renders present diagnostics, screenshot and observed snapshot', () => {
    const ref = 'screenshots/a b&c.png';
    const html = renderRunDetail(readable({ results: [executed({ steps: [{ id: 'assert-1', type: 'assert', target: 'default', status: 'failed', expected: 'Expected value', actual: 'Actual value', screenshot: ref, observed: { note: OBSERVED_NOTE, accessibilitySnapshot: 'button Save' } }] })] }));
    expect(html).toContain(VIEW_COPY.detail.failedStep.expected);
    expect(html).toContain('Expected value');
    expect(html).toContain(VIEW_COPY.detail.failedStep.actual);
    expect(html).toContain('Actual value');
    expect(html).toContain(`<img src="/runs/${runId}/screenshots/${encodeURIComponent(ref)}" alt="Screenshot of step assert-1"`);
    expect(html).toContain(`<summary>${VIEW_COPY.detail.snapshotDetails.summary}</summary>`);
    expect(html).toContain(OBSERVED_NOTE);
    expect(html).toMatch(/<pre[^>]*>button Save<\/pre>/);
  });

  it('omits absent diagnostics and suppresses even a present secret screenshot', () => {
    const html = renderRunDetail(readable({ results: [executed({ steps: [
      { id: 'failed', type: 'assert', target: 'default', status: 'failed' },
      { id: 'secret', type: 'assert', target: 'default', status: 'error', screenshot: 'secret.png', screenshotOmitted: 'secret-detected' },
    ] })] }));
    expect(html).not.toContain('Expected');
    expect(html).not.toContain('Actual');
    expect(html).toContain(VIEW_COPY.detail.failedStep.screenshotOmitted);
    expect(html).not.toContain('<img');
    expect(html).toContain('—');
  });

  it('renders listed and skipped cases as one-line summaries without a step table', () => {
    const html = renderRunDetail(readable({ results: [
      { id: 'listed', file: 'listed.test.md', status: 'listed' },
      { id: 'skipped', file: 'skipped.test.md', status: 'skipped' },
    ] }));
    expect(html).toContain(`${VIEW_COPY.detail.listedSkipped.listedPrefix}listed.test.md`);
    expect(html).toContain(`${VIEW_COPY.detail.listedSkipped.skippedPrefix}skipped.test.md`);
    expect(html).not.toContain('<table');
  });
});

describe('HTML injection boundaries', () => {
  it('escapes report-controlled text in list and detail, including attributes', () => {
    const attack = '<script>alert(1)</script>" onmouseover="&';
    const listing = readable({ results: [executed({ id: attack, file: attack, planFile: attack, explanation: attack, steps: [{ id: attack, type: 'assert', target: 'default', status: 'failed', expected: attack, actual: attack, screenshot: attack, observed: { note: OBSERVED_NOTE, accessibilitySnapshot: attack } }] })], errors: [{ scope: 'run', kind: 'environment', code: 'INTERRUPTED', message: attack }] });
    for (const html of [renderRunList([listing]), renderRunDetail(listing)]) {
      expect(html).not.toContain('<script');
      expect(html).not.toContain('" onmouseover="');
      expect(html).not.toMatch(/https?:\/\//);
    }
    const detail = renderRunDetail(listing);
    expect(detail).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(detail).toContain('&quot;');
    expect(detail).toContain('&amp;');
    expect(detail).toContain(encodeURIComponent(attack));
  });
});

describe('deterministic rendering', () => {
  it('renders the same list and detail fixture to exact identical strings twice', () => {
    const fixture = readable({ results: [executed()] });
    const rows = [fixture, { kind: 'no-report' as const, runId: 'empty-run' }];
    const firstList = renderRunList(rows);
    const secondList = renderRunList(rows);
    const firstDetail = renderRunDetail(fixture);
    const secondDetail = renderRunDetail(fixture);
    expect(firstList).toBe(secondList);
    expect(firstDetail).toBe(secondDetail);
  });

  it('traces rendered fixed chrome to the central copy set', () => {
    const copy = fixedCopyValues(VIEW_COPY);
    const html = renderRunList([
      readable(),
      readable({ summary: { total: 1, passed: 0, failed: 0, errored: 1, skipped: 0 } }, 'error-run'),
      readable({ summary: { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 } }, 'passed-run'),
      readable({ summary: { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0 } }, 'empty-run'),
      { kind: 'no-report', runId: 'missing-run' },
      { kind: 'unreadable', runId: 'unreadable-run', reason: 'invalid-json' },
    ])
      + renderRunDetail(readable({ results: [executed()] }));
    const chrome = [
      ...Object.values(VIEW_COPY.list.columnHeaders),
      ...Object.values(VIEW_COPY.list.rowStatus),
      VIEW_COPY.list.cases.evidenceOnly,
      VIEW_COPY.list.runLinks.openRun,
      VIEW_COPY.detail.header.rawJson,
      VIEW_COPY.detail.caseAuxiliary.explanation,
      ...Object.values(VIEW_COPY.detail.stepTable),
    ];
    const renderedText = [...html.matchAll(/>([^<>]+)</g)].map((match) => match[1]?.trim());
    for (const label of chrome) {
      expect(copy.has(label), label).toBe(true);
      expect(renderedText, label).toContain(label);
    }
  });

  it('returns byte-identical strings for every renderer', () => {
    const listing = readable({ results: [executed()] });
    expect(renderRunList([listing])).toBe(renderRunList([listing]));
    expect(renderRunDetail(listing)).toBe(renderRunDetail(listing));
    expect(renderError('Read failed', 'Reload to retry')).toBe(renderError('Read failed', 'Reload to retry'));
    expect(escapeHtml('&<>')).toBe(escapeHtml('&<>'));
  });
});
