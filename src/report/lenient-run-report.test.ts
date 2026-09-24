import { describe, expect, it } from 'vitest';
import { OBSERVED_NOTE, ReportEnvelope, REPORT_SCHEMA_VERSION } from './schema.js';
import { LenientRunReportEnvelope } from './lenient-run-report.js';

// Legacy run reports may omit target and sessions and retain unknown fields;
// outcome vocabulary, required evidence, and case error identity remain strict.
function legacyReport() {
  return {
    schemaVersion: '3.6',
    command: 'run',
    startedAt: '2026-09-23T06:40:12Z',
    durationMs: 42,
    summary: { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 },
    errors: [] as Record<string, unknown>[],
    reportPersistence: 'persisted',
    results: [{
      id: 'case', file: 'case.test.md', planFile: 'case.ambercast.plan.json',
      status: 'passed', durationMs: 42, explanation: 'Completed.',
      steps: [{ id: 'step', type: 'assert', status: 'passed' } as Record<string, unknown>],
    }],
  };
}

describe('LenientRunReportEnvelope', () => {
  it('accepts a 3.6 report without target or sessions', () => {
    expect(LenientRunReportEnvelope.safeParse(legacyReport()).success).toBe(true);
  });

  it('accepts a 3.3 step with kind, observed evidence, and screenshot', () => {
    const report = legacyReport();
    report.schemaVersion = '3.3';
    report.results[0]!.steps[0] = {
      ...report.results[0]!.steps[0], kind: 'assertion',
      observed: { note: OBSERVED_NOTE, accessibilitySnapshot: '{}' },
      screenshot: '.runs/example/case/step.png',
    };
    expect(LenientRunReportEnvelope.safeParse(report).success).toBe(true);
  });

  it('accepts a 3.5 error with hint and arbitrary details', () => {
    const report = legacyReport();
    report.schemaVersion = '3.5';
    report.errors.push({ scope: 'case', kind: 'environment', code: 'LEGACY_FAILURE', caseId: 'case', message: 'Failure', hint: 'Retry', details: { cause: ['legacy'] } });
    expect(LenientRunReportEnvelope.safeParse(report).success).toBe(true);
  });

  it('accepts a strict 3.7 run report', () => {
    const report = legacyReport();
    report.schemaVersion = REPORT_SCHEMA_VERSION;
    report.results[0]!.steps[0]!.target = 'default';
    expect(LenientRunReportEnvelope.safeParse(ReportEnvelope.parse({
      ...report,
      results: [{ ...report.results[0]!, sessions: {} }],
    })).success).toBe(true);
  });

  it.each([
    ['summary count is a string', (report: ReturnType<typeof legacyReport>) => ({ ...report, summary: { ...report.summary, passed: '1' } })],
    ['result status is unknown', (report: ReturnType<typeof legacyReport>) => ({ ...report, results: [{ ...report.results[0]!, status: 'bogus' }] })],
    ['observed note is changed', (report: ReturnType<typeof legacyReport>) => ({ ...report, results: [{ ...report.results[0]!, steps: [{ ...report.results[0]!.steps[0]!, observed: { note: 'changed', accessibilitySnapshot: '{}' } }] }] })],
    ['explanation is absent', (report: ReturnType<typeof legacyReport>) => ({ ...report, results: [{ id: 'case', file: 'case.test.md', planFile: 'case.ambercast.plan.json', status: 'passed', durationMs: 42, steps: report.results[0]!.steps }] })],
  ])('rejects a report when %s', (_name, change) => {
    expect(LenientRunReportEnvelope.safeParse(change(legacyReport())).success).toBe(false);
  });

  it('retains one unknown key at each loose boundary', () => {
    const report = legacyReport();
    report.errors.push({ scope: 'run', kind: 'environment', code: 'LEGACY_FAILURE', message: 'Failure', legacyError: true });
    const parsed = LenientRunReportEnvelope.parse({
      ...report,
      legacyEnvelope: true,
      results: [{ ...report.results[0]!, legacyResult: true, steps: [{ ...report.results[0]!.steps[0]!, legacyStep: true }] }],
    });
    expect(parsed).toMatchObject({
      legacyEnvelope: true,
      results: [{ legacyResult: true, steps: [{ legacyStep: true }] }],
      errors: [{ legacyError: true }],
    });
  });

  it('requires caseId on case-scoped errors', () => {
    const report = legacyReport();
    report.errors.push({ scope: 'case', kind: 'usage', code: 'LEGACY_FAILURE', message: 'Failure' });
    expect(LenientRunReportEnvelope.safeParse(report).success).toBe(false);
  });

  it('allows a run-scoped error without caseId', () => {
    const report = legacyReport();
    report.errors.push({ scope: 'run', kind: 'usage', code: 'LEGACY_FAILURE', message: 'Failure' });
    expect(LenientRunReportEnvelope.safeParse(report).success).toBe(true);
  });
});
