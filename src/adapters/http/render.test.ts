import { describe, expect, it } from 'vitest';
import { OBSERVED_NOTE, REPORT_SCHEMA_VERSION, ReportEnvelope } from '../../report/schema.js';
import { VIEW_COPY } from '../../core/viewer/copy.js';
import type { RunListing } from '../../runtime/view-command.js';
import { escapeHtml, renderError, renderRunDetail, renderRunList } from './render.js';

const runId = '2026-09-23T120000-abc123';
const attackRunId = 'x" onmouseover="alert(1)';
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
const readable = (overrides: Partial<Extract<RunListing, { kind: 'readable' }>['envelope']> = {}, id = runId): Extract<RunListing, { kind: 'readable' }> => {
  // Keep fixture metadata aligned with the version being rendered; non-current versions cannot be exact strict parses.
  const schemaVersion = overrides.schemaVersion ?? REPORT_SCHEMA_VERSION;
  return { kind: 'readable', runId: id, schemaVersion, exact: schemaVersion === REPORT_SCHEMA_VERSION, envelope: { ...envelope, ...overrides } };
};
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
  it.each(['3.6', '3.99'])('omits Schema from a readable %s list row', (schemaVersion) => {
    const html = renderRunList([readable({ schemaVersion })]);
    expect(html).toContain(runId);
    expect(html).not.toContain('Schema');
  });

  it('shows an unsupported version in the Cases column', () => {
    const html = renderRunList([{ kind: 'unreadable', runId, reason: 'unsupported-version', version: '2.0' }]);
    const row = html.match(/<tbody><tr>(.*?)<\/tr><\/tbody>/s)?.[1];
    expect(row).toBeDefined();
    const cells = row?.match(/<td[^>]*>[\s\S]*?<\/td>/g);
    expect(cells).toHaveLength(5);
    expect(cells?.[4]).toContain('Unsupported version 2.0');
  });

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
    for (const [key, cls] of [['failed', 'fail'], ['error', 'fail'], ['passed', 'pass'], ['empty', 'skip'], ['noReport', 'fail'], ['unreadable', 'fail']] as const) {
      expect(html).toContain(`<span class="${cls}">${VIEW_COPY.list.rowStatus[key]}</span>`);
    }
    for (const reason of [VIEW_COPY.list.cases.unreadableReasons.invalidJson, VIEW_COPY.list.cases.unreadableReasons.schemaMismatch, VIEW_COPY.list.cases.unreadableReasons.notRunReport, VIEW_COPY.list.cases.unreadableReasons.readFailed]) expect(html).toContain(reason);
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
  it.each(['persisted', 'failed'] as const)('places the 3.6 schema after Report: %s and before Raw JSON', (reportPersistence) => {
    const html = renderRunDetail(readable({ schemaVersion: '3.6', reportPersistence }));
    expect(html).toContain(`Report: ${reportPersistence}`);
    expect(html).toContain('Started 2026-09-23T12:00:00Z');
    expect(html).toContain('Duration 850 ms');
    expect(html).toContain('12 passed · 2 failed · 1 error');
    expect(html).toMatch(new RegExp(`Report: ${reportPersistence} · Schema 3\\.6 · <a[^>]*>Raw JSON<\\/a>`));
  });

  it('shows a newer 3.x schema and omits the current exact schema from the detail header', () => {
    const future = renderRunDetail(readable({ schemaVersion: '3.99' }));
    expect(future).toMatch(/Report: persisted · Schema 3\.99 · <a[^>]*>Raw JSON<\/a>/);
    const exact = renderRunDetail(readable());
    const header = exact.match(/<h1>[^<]*<\/h1><p>([\s\S]*?)<\/p>/)?.[1];
    expect(header).toBeDefined();
    expect(header).toContain('Report: persisted');
    expect(header).not.toContain('Schema');
  });

  it('shows an unsupported version in unreadable detail and escapes version text in both views', () => {
    const listing: RunListing = { kind: 'unreadable', runId, reason: 'unsupported-version', version: '2.0' };
    expect(renderRunDetail(listing)).toContain('Unsupported version 2.0');
    const attack: RunListing = { kind: 'unreadable', runId, reason: 'unsupported-version', version: '2.0<b>' };
    for (const html of [renderRunList([attack]), renderRunDetail(attack)]) {
      expect(html).toContain('Unsupported version 2.0&lt;b&gt;');
      expect(html).not.toContain('<b>');
    }
  });

  it('uses dark inline style tokens without external references', () => {
    const style = renderRunList([]).match(/<style>([\s\S]*?)<\/style>/)?.[1];
    expect(style).toBeDefined();
    expect(style).toBe('body{background:#181310;color:#F1EBE2;font-family:system-ui,sans-serif;max-width:70rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{padding:.5rem;border-bottom:1px solid #3B332C;text-align:left;overflow-wrap:anywhere}th.num,td.num{text-align:right}p{overflow-wrap:anywhere}a{color:inherit;text-decoration:underline}img{display:block;max-width:100%;height:auto}.shot img{max-height:20rem;width:auto}.pass{color:#7FC8A9}.fail{color:#E8875E}.skip{color:#3D6FA6}.verdigris{color:#7FC8A9}.amber{color:#E8B063}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:24rem;overflow:auto}');
    for (const token of ['#181310', '#F1EBE2', '#3B332C', '#7FC8A9', '#E8875E', '#3D6FA6', '#E8B063']) expect(style).toContain(token);
    for (const token of ['#ddd', '#087e72', '#9a6700', 'http://', 'https://', '@import', 'url(', 'http']) expect(style).not.toContain(token);
    for (const token of ['table-layout:fixed', 'overflow-wrap:anywhere', 'img{display:block;max-width:100%;height:auto}', '.shot img{max-height:20rem;width:auto}', 'p{overflow-wrap:anywhere}', 'pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:24rem;overflow:auto}']) expect(style).toContain(token);
  });

  it('places the exact colgroups immediately after both table openings', () => {
    const list = renderRunList([readable()]);
    const detail = renderRunDetail(readable({ results: [executed({ steps: [{ id: 'one', type: 'assert', target: 'default', status: 'passed' }] })] }));
    expect(list).toContain('<table><colgroup><col style="width:8rem"><col><col style="width:11rem"><col style="width:6rem"><col style="width:12rem"></colgroup>');
    expect(detail).toContain('<table><colgroup><col style="width:3rem"><col><col style="width:6rem"><col style="width:8rem"></colgroup>');
  });

  it('wraps a failed step screenshot in an exact linked thumbnail', () => {
    const ref = 'screenshots/a b&c.png';
    const url = `/runs/${runId}/screenshots/${encodeURIComponent(ref)}`;
    const html = renderRunDetail(readable({ results: [executed({ steps: [{ id: 'assert-1', type: 'assert', target: 'default', status: 'failed', screenshot: ref }] })] }));
    expect(html).toContain(`<a class="shot" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Screenshot of step assert-1" loading="lazy" decoding="async"></a>`);
  });

  it('omits thumbnail markup when a screenshot is marked omitted', () => {
    const html = renderRunDetail(readable({ results: [executed({ steps: [{ id: 'secret', type: 'assert', target: 'default', status: 'error', screenshot: 'secret.png', screenshotOmitted: 'secret-detected' }] })] }));
    expect(html).not.toContain('<a class="shot"');
    expect(html).not.toContain('<img');
  });

  it('omits thumbnail markup for a passed step without a screenshot', () => {
    const html = renderRunDetail(readable({ results: [executed({ steps: [{ id: 'pass', type: 'assert', target: 'default', status: 'passed' }] })] }));
    expect(html).not.toContain('<a class="shot"');
    expect(html).not.toContain('<img');
  });

  it('retains the linked thumbnail for a passed step with a screenshot', () => {
    const ref = 'capture.png';
    const url = `/runs/${runId}/screenshots/${encodeURIComponent(ref)}`;
    const html = renderRunDetail(readable({ results: [executed({ steps: [{ id: 'capture-1', type: 'capture', status: 'passed', screenshot: ref }] })] }));
    expect(html).toContain(`<a class="shot" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Screenshot of step capture-1" loading="lazy" decoding="async"></a>`);
  });

  it('marks only numeric table columns with the num class', () => {
    const list = renderRunList([readable()]);
    expect(list).toContain('<th class="num">Duration</th>');
    expect(list).toMatch(/<td class="num">850 ms<\/td>/);
    for (const label of ['Status', 'Run', 'Cases']) expect(list).toMatch(new RegExp(`<th(?![^>]*class="[^"]*num)[^>]*>${label}</th>`));
    const listCells = list.match(/<tbody><tr>(.*?)<\/tr><\/tbody>/)?.[1]?.match(/<td[^>]*>[\s\S]*?<\/td>/g);
    expect(listCells).toHaveLength(5);
    for (const index of [0, 1, 4]) expect(listCells?.[index]).not.toMatch(/class="[^"]*num/);

    const detail = renderRunDetail(readable({ results: [executed({ steps: [{ id: 'one', type: 'assert', target: 'default', status: 'passed' }] })] }));
    expect(detail).toContain('<th class="num">#</th>');
    const stepCells = detail.match(/<tbody><tr>(.*?)<\/tr>/)?.[1]?.match(/<td[^>]*>[\s\S]*?<\/td>/g);
    expect(stepCells).toHaveLength(4);
    expect(stepCells?.[0]).toBe('<td class="num">1</td>');
    for (const cell of stepCells?.slice(1) ?? []) expect(cell).not.toMatch(/class="[^"]*num/);
    for (const label of ['Step', 'Type', 'Status']) expect(detail).toMatch(new RegExp(`<th(?![^>]*class="[^"]*num)[^>]*>${label}</th>`));
  });

  it('renders status badges in their own step rows and all case contexts', () => {
    const statuses = [
      ['passed', '<span class="pass">✓ Passed</span>'],
      ['failed', '<span class="fail">✗ Failed</span>'],
      ['error', '<span class="fail">! Error</span>'],
      ['skipped', '<span class="skip">– Skipped</span>'],
    ] as const;
    const detail = renderRunDetail(readable({ results: [executed({ steps: statuses.map(([status], index) => ({ id: `step-${index + 1}`, type: 'assert', target: 'default', status })) })] }));
    const rows = [...detail.matchAll(/<tr>(.*?)<\/tr>/gs)].map((match) => match[1]);
    const stepRows = rows.filter((row) => row?.includes('step-'));
    expect(stepRows).toHaveLength(4);
    statuses.forEach(([, badge], index) => expect(stepRows[index]).toContain(`<td>${badge}</td>`));
    expect(detail).not.toMatch(/>(?:failed|passed)</);
    expect(detail).toContain('<h2><span class="fail">✗ Failed</span> · case.test.md');
    expect(renderRunList([readable({ summary: { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 } })])).toContain('<td><span class="pass">✓ Passed</span></td>');
    const oneLiners = renderRunDetail(readable({ results: [
      { id: 'listed', file: 'listed.test.md', status: 'listed' },
      { id: 'skipped', file: 'skipped.test.md', status: 'skipped' },
    ] }));
    expect(oneLiners).toContain('<p><span class="skip">· Listed</span> listed.test.md</p>');
    expect(oneLiners).toContain('<p><span class="skip">– Skipped</span> skipped.test.md</p>');
  });

  it('omits zero counts in detail headers and names an all-zero summary', () => {
    const mixed = renderRunDetail(readable({ summary: { total: 3, passed: 1, failed: 0, errored: 2, skipped: 0 } }));
    expect(mixed).toContain('1 passed · 2 error');
    expect(mixed).not.toContain('0 failed');
    expect(mixed).not.toContain('0 skipped');
    expect(renderRunDetail(readable({ summary: { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0 } }))).toContain('0 cases');
  });
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
    for (const [reason, label] of Object.entries({ 'invalid-json': VIEW_COPY.list.cases.unreadableReasons.invalidJson, 'schema-mismatch': VIEW_COPY.list.cases.unreadableReasons.schemaMismatch, 'not-run-report': VIEW_COPY.list.cases.unreadableReasons.notRunReport, 'read-error': VIEW_COPY.list.cases.unreadableReasons.readFailed }) as [Extract<RunListing, { kind: 'unreadable'; reason: 'invalid-json' | 'schema-mismatch' | 'not-run-report' | 'read-error' }>['reason'], string][]) {
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
    expect(html).toContain('<span class="skip">· Listed</span> listed.test.md');
    expect(html).toContain('<span class="skip">– Skipped</span> skipped.test.md');
    expect(html).not.toContain('<table');
  });
});

describe('HTML injection boundaries', () => {
  it('escapes quote-bearing run IDs and screenshot references in identical thumbnail URLs', () => {
    const ref = 'shot" onerror="alert(1).png';
    const url = `/runs/${escapeHtml(attackRunId)}/screenshots/${escapeHtml(encodeURIComponent(ref))}`;
    const detail = renderRunDetail(readable({ results: [executed({ steps: [{ id: 'step', type: 'capture', status: 'passed', screenshot: ref }] })] }, attackRunId));
    expect(url).toContain('&quot;');
    expect(url).toContain('%22');
    expect(detail).toContain(`<a class="shot" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Screenshot of step step" loading="lazy" decoding="async"></a>`);
    expect(detail).not.toContain('" onmouseover="');
    expect(detail).not.toContain('" onerror="');
  });
  it('escapes the readable run ID in the Open run link', () => {
    const listing = readable({ results: [executed({ steps: [{ id: 'step', type: 'capture', status: 'passed', screenshot: 'step.png' }] })] }, attackRunId);
    const list = renderRunList([listing]);
    expect(list).toContain('<a href="/runs/x&quot; onmouseover=&quot;alert(1)"');
    expect(list).not.toContain('" onmouseover="');
  });

  it('escapes the readable run ID in the Raw JSON link', () => {
    const listing = readable({ results: [executed({ steps: [{ id: 'step', type: 'capture', status: 'passed', screenshot: 'step.png' }] })] }, attackRunId);
    const detail = renderRunDetail(listing);
    expect(detail).toContain('href="/runs/x&quot; onmouseover=&quot;alert(1)/report.json"');
    expect(detail).not.toContain('" onmouseover="');
  });

  it('escapes the readable run ID in the screenshot source', () => {
    const listing = readable({ results: [executed({ steps: [{ id: 'step', type: 'capture', status: 'passed', screenshot: 'step.png' }] })] }, attackRunId);
    const detail = renderRunDetail(listing);
    expect(detail).toContain('<img src="/runs/x&quot; onmouseover=&quot;alert(1)/screenshots/step.png"');
    expect(detail).not.toContain('" onmouseover="');
  });

  it('escapes the unreadable run ID in the list Raw JSON link', () => {
    const listing: RunListing = { kind: 'unreadable', runId: attackRunId, reason: 'invalid-json' };
    const list = renderRunList([listing]);
    expect(list).toContain('href="/runs/x&quot; onmouseover=&quot;alert(1)/report.json"');
    expect(list).not.toContain('" onmouseover="');
  });

  it('escapes the unreadable run ID in the detail Raw JSON link', () => {
    const listing: RunListing = { kind: 'unreadable', runId: attackRunId, reason: 'invalid-json' };
    const detail = renderRunDetail(listing);
    expect(detail).toContain('href="/runs/x&quot; onmouseover=&quot;alert(1)/report.json"');
    expect(detail).not.toContain('" onmouseover="');
  });

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
      + renderRunDetail(readable({ results: [executed(),
        { id: 'listed', file: 'listed.test.md', status: 'listed' },
        { id: 'skipped', file: 'skipped.test.md', status: 'skipped' },
      ] }));
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
