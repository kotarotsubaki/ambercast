import { describe, expect, it } from 'vitest';
import { AmbercastError, type ErrorKind, type ReportableErrorKind } from '#core/errors/types.js';
import { CaseAbortedError, type CaseAbortReason } from '#core/errors/case-aborted-error.js';
import { PromptAmbiguousError } from '#core/errors/prompt-ambiguous-error.js';
import { REPORT_ERROR_DETAILS, projectReportErrorDetails, reportError } from '#report/error-mapping.js';
import { REPORT_SCHEMA_VERSION, type ReportError } from '#report/schema.js';
import { summarizeReport } from '#report/summarize.js';
import { assertDiagnosable } from '../../support/report-assertions.js';

const CASE_ID = 'case-a';
const CASE_FILE = 'case-a.test.md';
const CASE_LOCATION = { scope: 'case' as const, caseId: CASE_ID };
const STARTED_AT = '2026-01-01T00:00:00Z';

class ClassifiedError extends AmbercastError {
  constructor(readonly kind: ErrorKind, message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, details, options);
  }
}

const REPORTABLE_KIND_ORACLE = [
  'config-invalid', 'secret-unresolved', 'target-unresolved', 'prompt-path-invalid',
  'secret-literal-rejected', 'secret-env-var-collision', 'secret-consent-required',
  'secret-syntax-rejected', 'missing-plan', 'stale-ir', 'integrity-violation',
  'grounding-unresolved', 'browser-launch-failed', 'executor-unsupported',
  'ai-executor-unavailable', 'agentic-step-failed', 'ai-response-invalid',
  'fs-io-error', 'unexpected-crash', 'interrupted', 'case-aborted', 'prompt-ambiguous',
] as const satisfies readonly ReportableErrorKind[];

function representativeError(kind: ReportableErrorKind): AmbercastError {
  if (kind === 'case-aborted') return new CaseAbortedError('Case stopped at step-a.', 'run-value-missing', 'step-a');
  if (kind === 'prompt-ambiguous') return new PromptAmbiguousError('Prompt has unresolved choices.', 2);
  return new ClassifiedError(kind, `A classified ${kind} failure occurred.`,
    kind === 'agentic-step-failed'
      ? { stepId: 'step-a', actions: 0, assertions: 0, passedAssertions: 0, failedAssertions: 0, targetRejections: 0 }
      : undefined);
}

function runRow(status: 'error' | 'failed', steps: readonly unknown[] = []): Record<string, unknown> {
  return {
    id: CASE_ID, file: CASE_FILE, planFile: 'case-a.ambercast.plan.json',
    status, durationMs: 1, aiCalls: 0, steps, sessions: {}, explanation: 'The case stopped.',
  };
}

function reportWithError(command: 'run' | 'generate' | 'heal', error: ReportError): unknown {
  const errors = [error];
  if (command === 'run') {
    const results = [runRow('error')];
    return {
      schemaVersion: REPORT_SCHEMA_VERSION, command, startedAt: STARTED_AT, durationMs: 1,
      summary: summarizeReport({ command, results: results as never, errors }), errors, results,
      reportPersistence: 'not-attempted',
    };
  }
  if (command === 'generate') {
    const results = [{ id: CASE_ID, file: CASE_FILE, status: 'failed' as const, dryRun: false }];
    return {
      schemaVersion: REPORT_SCHEMA_VERSION, command, startedAt: STARTED_AT, durationMs: 1,
      summary: summarizeReport({ command, results, errors }), errors, results,
    };
  }
  const results = [{
    ...runRow('error'), status: 'completed' as const, repairOutcome: 'unresolved' as const,
    application: 'not-eligible' as const, stopReason: 'settled' as const,
  }];
  return {
    schemaVersion: REPORT_SCHEMA_VERSION, command, startedAt: STARTED_AT, durationMs: 1,
    summary: summarizeReport({ command, results: results as never, errors }), errors, results,
  };
}

const CASE_ABORT_REASONS = [
  'run-reference-invalid', 'run-value-missing', 'secret-fill-incomplete',
  'agentic-no-terminal-evidence', 'agentic-coverage-inexact', 'agentic-proof-invalid',
  'grounding-secret-contaminated', 'grounding-snapshot-invalid',
] as const satisfies readonly CaseAbortReason[];

const AGENTIC_DETAILS = {
  stepId: 'step-a', actions: 0, assertions: 0, passedAssertions: 0,
  failedAssertions: 0, targetRejections: 1,
};

// These rows exercise report projection for each planned path. The usecase
// tests drive the actual run, generate, and heal branches through their doubles.
const FAILURE_PATHS = [
  ...CASE_ABORT_REASONS.map((reason) => ({
    name: `run CaseAbort ${reason}`, command: 'run' as const,
    error: new CaseAbortedError('Case stopped at step-a.', reason, 'step-a'),
    code: 'CASE_ABORTED', details: { reason, stepId: 'step-a' },
  })),
  { name: 'run target rejection before exhaustion', command: 'run' as const,
    error: new ClassifiedError('agentic-step-failed', 'The AI provider call failed.', AGENTIC_DETAILS),
    code: 'AGENTIC_STEP_FAILED', details: AGENTIC_DETAILS },
  { name: 'run target rejection at exhaustion', command: 'run' as const,
    error: new ClassifiedError('agentic-step-failed', 'The AI provider call failed.', { ...AGENTIC_DETAILS, targetRejections: 4 }),
    code: 'AGENTIC_STEP_FAILED', details: { ...AGENTIC_DETAILS, targetRejections: 4 } },
  { name: 'run unclassified caught error', command: 'run' as const,
    error: new ClassifiedError('unexpected-crash', 'The case crashed.', undefined, { cause: new TypeError('private') }),
    code: 'UNEXPECTED_CRASH', details: { cause: { name: 'TypeError' } } },
  { name: 'run unclassified thrown value', command: 'run' as const,
    error: new ClassifiedError('unexpected-crash', 'The case crashed.', undefined, { cause: { name: 'private-name' } }),
    code: 'UNEXPECTED_CRASH', details: { cause: { name: 'Error' } } },
  { name: 'run declarative agentic failure', command: 'run' as const,
    error: new ClassifiedError('agentic-step-failed', 'The AI-directed interaction did not complete successfully.', AGENTIC_DETAILS),
    code: 'AGENTIC_STEP_FAILED', details: AGENTIC_DETAILS },
  { name: 'run unresolved grounding', command: 'run' as const,
    error: new ClassifiedError('grounding-unresolved', 'Grounding was unresolved.', { stepId: 'step-a', reason: 'recoverable-miss' }),
    code: 'GROUNDING_UNRESOLVED', details: { stepId: 'step-a', reason: 'recoverable-miss' } },
  { name: 'run browser launch failure', command: 'run' as const,
    error: new ClassifiedError('browser-launch-failed', 'Chromium could not launch.'),
    code: 'BROWSER_LAUNCH_FAILED' },
  { name: 'generate ambiguous prompt', command: 'generate' as const,
    error: new PromptAmbiguousError('Prompt has unresolved choices.', 2),
    code: 'PROMPT_AMBIGUOUS', details: { ambiguities: 2 } },
  { name: 'generate invalid response', command: 'generate' as const,
    error: new ClassifiedError('ai-response-invalid', 'Provider response was invalid.', { issues: [{ code: 'invalid-json', path: [] }] }),
    code: 'AI_RESPONSE_INVALID', details: { issues: [{ code: 'invalid-json', path: [] }] } },
  { name: 'generate unavailable executor', command: 'generate' as const,
    error: new ClassifiedError('ai-executor-unavailable', 'Provider is unavailable.'),
    code: 'AI_EXECUTOR_UNAVAILABLE' },
  ...(['stage3', 'final-replay'] as const).flatMap((stage) => [
    { name: `heal ${stage} invalid response`, command: 'heal' as const,
      error: new ClassifiedError('ai-response-invalid', 'Provider response was invalid.', { issues: [{ code: 'invalid-json', path: [] }] }),
      code: 'AI_RESPONSE_INVALID', details: { issues: [{ code: 'invalid-json', path: [] }] } },
    { name: `heal ${stage} unavailable executor`, command: 'heal' as const,
      error: new ClassifiedError('ai-executor-unavailable', 'Provider is unavailable.'),
      code: 'AI_EXECUTOR_UNAVAILABLE' },
  ]),
];

describe('failure-path report projection', () => {
  it('pins every reportable kind independently of the runtime mapping', () => {
    expect(new Set(REPORTABLE_KIND_ORACLE)).toEqual(new Set(Object.keys(REPORT_ERROR_DETAILS)));
    expect(new Set(REPORTABLE_KIND_ORACLE).size).toBe(REPORTABLE_KIND_ORACLE.length);
  });

  it.each(REPORTABLE_KIND_ORACLE)('has a diagnosable representative for %s', (kind) => {
    const error = representativeError(kind);
    const location = kind === 'interrupted' || kind === 'prompt-path-invalid' ? { scope: 'run' as const } : CASE_LOCATION;
    const reported = location.scope === 'run' ? reportError(error, location) : reportError(error, location);
    if (location.scope === 'case') {
      expect(reported.scope).toBe('case');
      expect(assertDiagnosable(reportWithError('run', reported))).toBeUndefined();
    } else {
      expect(reported.scope).toBe('run');
      const errors = [reported];
      expect(assertDiagnosable({
        schemaVersion: REPORT_SCHEMA_VERSION, command: 'run', startedAt: STARTED_AT,
        durationMs: 1, summary: summarizeReport({ command: 'run', results: [], errors }),
        errors, results: [], reportPersistence: 'not-attempted',
      })).toBeUndefined();
    }
  });

  it.each(FAILURE_PATHS)('retains mapped case evidence for $name', ({ command, error, code, details }) => {
    const reported = reportError(error, CASE_LOCATION);
    expect(reported).toMatchObject({ scope: 'case', caseId: CASE_ID, code });
    expect(assertDiagnosable(reportWithError(command, reported))).toBeUndefined();
    if (details !== undefined) {
      expect(reported).toHaveProperty('details');
      expect(reported).toMatchObject({ details });
      expect(projectReportErrorDetails(error, CASE_LOCATION)).toMatchObject({ ok: true, details });
    }
  });

  it.each([
    ['ordinary failed assertion', 'Expected text', 'Observed text'],
    ['empty actual string', 'Expected text', 'No matching element was found.'],
    ['whitespace actual string', 'Expected text', 'No matching element was found.'],
  ])('%s has sufficient report assertion evidence without a case error', (_name, expected, actual) => {
    const step = { id: 'step-a', type: 'assert', target: 'web', status: 'failed', kind: 'assertion', expected, actual };
    const results = [runRow('failed', [step])];
    const errors: ReportError[] = [];
    const report = {
      schemaVersion: REPORT_SCHEMA_VERSION, command: 'run', startedAt: STARTED_AT,
      durationMs: 1, summary: summarizeReport({ command: 'run', results: results as never, errors }),
      errors, results, reportPersistence: 'not-attempted',
    };
    expect(step.expected.trim()).not.toBe('');
    expect(step.actual.trim()).not.toBe('');
    expect(report.errors).toEqual([]);
    expect(assertDiagnosable(report)).toBeUndefined();
  });

  it('keeps interruption at run scope without inventing a case error', () => {
    const errors = [reportError(new ClassifiedError('interrupted', 'The run was interrupted.'), { scope: 'run' })];
    const results = [runRow('error', [{ id: 'step-a', type: 'action', target: 'web', status: 'error', kind: 'environment' }])];
    const report = {
      schemaVersion: REPORT_SCHEMA_VERSION, command: 'run', startedAt: STARTED_AT,
      durationMs: 1, summary: summarizeReport({ command: 'run', results: results as never, errors }),
      errors, results, reportPersistence: 'not-attempted',
    };
    expect(errors).toEqual([expect.objectContaining({ scope: 'run', code: 'INTERRUPTED' })]);
    expect(errors.some((error) => error.scope === 'case')).toBe(false);
    expect(assertDiagnosable(report)).toBeUndefined();
  });
});
