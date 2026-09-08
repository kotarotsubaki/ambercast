import { describe, expect, it } from 'vitest';
import { AmbercastError, type ErrorKind } from '#core/errors/types.js';
import * as errorMapping from '#report/error-mapping.js';
import { InterruptedError } from '#core/errors/interrupted-error.js';
import { FsIoError } from '#core/errors/fs-io-error.js';
import { AiExecutorUnavailableError } from '#core/errors/ai-executor-unavailable-error.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { SecretGrantUnattributableError } from '#core/errors/secret-grant-unattributable-error.js';
import { UnexpectedCrashError } from '#core/errors/unexpected-crash-error.js';
import { assertNoLiteralSecrets } from '#usecases/generator-secret-policy.js';
import { ReportError } from '#report/schema.js';
import { CAUSE_NAMES } from './cause-name-fixtures.js';

const EXPECTED_REPORT_ERROR_DETAILS = {
  'config-invalid': { kind: 'usage', code: 'CONFIG_INVALID' },
  'secret-unresolved': { kind: 'usage', code: 'SECRET_UNRESOLVED' },
  'target-unresolved': { kind: 'usage', code: 'TARGET_UNRESOLVED' },
  'secret-literal-rejected': { kind: 'usage', code: 'SECRET_LITERAL_REJECTED' },
  'secret-grant-unattributable': { kind: 'usage', code: 'SECRET_GRANT_UNATTRIBUTABLE' },
  'missing-plan': { kind: 'usage', code: 'MISSING_PLAN' },
  'stale-ir': { kind: 'usage', code: 'STALE_PLAN' },
  'integrity-violation': { kind: 'usage', code: 'INTEGRITY_VIOLATION' },
  'browser-launch-failed': { kind: 'environment', code: 'BROWSER_LAUNCH_FAILED' },
  'ai-executor-unavailable': { kind: 'environment', code: 'AI_EXECUTOR_UNAVAILABLE' },
  'ai-response-invalid': { kind: 'environment', code: 'AI_RESPONSE_INVALID' },
  'fs-io-error': { kind: 'environment', code: 'FS_IO_ERROR' },
  'unexpected-crash': { kind: 'environment', code: 'UNEXPECTED_CRASH' },
  'interrupted': { kind: 'environment', code: 'INTERRUPTED' },
} as const;

type ReportableErrorKind = keyof typeof EXPECTED_REPORT_ERROR_DETAILS;

const REPORTABLE_ERROR_DETAILS = Object.entries(EXPECTED_REPORT_ERROR_DETAILS) as ReadonlyArray<readonly [
  ReportableErrorKind,
  (typeof EXPECTED_REPORT_ERROR_DETAILS)[ReportableErrorKind],
]>;

class ClassifiedError extends AmbercastError {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.kind = kind;
  }
}

describe('REPORT_ERROR_DETAILS', () => {
  it('exports the complete stable ErrorKind-to-report-kind-and-code mapping', () => {
    expect(errorMapping.REPORT_ERROR_DETAILS).toEqual(EXPECTED_REPORT_ERROR_DETAILS);
  });
});

describe('reportError', () => {
  it.each(REPORTABLE_ERROR_DETAILS.filter(([kind]) => kind !== 'interrupted'))('serializes a %s classified error at case scope', (kind, details) => {
    const error = new ClassifiedError(kind as ErrorKind, `The ${kind} failure occurred.`);

    expect(errorMapping.reportError(error, { scope: 'case', caseId: 'login-succeeds' })).toEqual({
      scope: 'case',
      ...details,
      caseId: 'login-succeeds',
      message: error.message,
      ...(kind === 'unexpected-crash' ? { details: { cause: { name: 'Error' } } } : {}),
    });
  });

  it('serializes a classified error at run scope without a case identifier', () => {
    const error = new ClassifiedError('browser-launch-failed', 'Chromium could not launch.');

    expect(errorMapping.reportError(error, { scope: 'run' })).toEqual({
      scope: 'run',
      kind: 'environment',
      code: 'BROWSER_LAUNCH_FAILED',
      message: 'Chromium could not launch.',
    });
  });

  it('throws when an unmapped and unreportable assertion-failed error is serialized', () => {
    const error = new ClassifiedError('assertion-failed', 'The assertion did not hold.');

    expect(() => errorMapping.reportError(error, { scope: 'run' }))
      .toThrow('Error kind assertion-failed cannot be serialized as a report error.');
  });

  it('serializes interruption only at run scope', () => {
    const error = new InterruptedError();

    expect(errorMapping.reportError(error, { scope: 'run' })).toMatchObject({
      scope: 'run', kind: 'environment', code: 'INTERRUPTED',
    });
    expect(() => errorMapping.reportError(error, { scope: 'case', caseId: 'case-a' })).toThrow();
  });

  it.each([
    { partiallyWritten: [] },
    { partiallyWritten: ['plan'] },
    { partiallyWritten: ['grounding'] },
    { partiallyWritten: ['plan', 'grounding'] },
  ] as const)('preserves valid FsIoError partial-write evidence $partiallyWritten at case scope', ({ partiallyWritten }) => {
    const error = new FsIoError('write failed', { partiallyWritten });

    expect(errorMapping.reportError(error, { scope: 'case', caseId: 'login-succeeds' })).toEqual({
      scope: 'case',
      kind: 'environment',
      code: 'FS_IO_ERROR',
      caseId: 'login-succeeds',
      message: 'write failed',
      details: { partiallyWritten: [...partiallyWritten] },
    });
  });

  it('omits details when an FsIoError has no partiallyWritten evidence', () => {
    const error = new FsIoError('write failed');

    expect(errorMapping.reportError(error, { scope: 'case', caseId: 'login-succeeds' })).toEqual({
      scope: 'case',
      kind: 'environment',
      code: 'FS_IO_ERROR',
      caseId: 'login-succeeds',
      message: 'write failed',
    });
  });

  it.each([
    { partiallyWritten: 'plan' },
    { partiallyWritten: ['cache'] },
    { partiallyWritten: ['plan', 'cache'] },
    { partiallyWritten: [1] },
  ])('omits the entire details object for invalid FsIoError partiallyWritten evidence $partiallyWritten', ({ partiallyWritten }) => {
    const error = new FsIoError('write failed', { partiallyWritten });

    expect(errorMapping.reportError(error, { scope: 'case', caseId: 'login-succeeds' })).toEqual({
      scope: 'case',
      kind: 'environment',
      code: 'FS_IO_ERROR',
      caseId: 'login-succeeds',
      message: 'write failed',
    });
  });

  it('omits FsIoError details at run scope', () => {
    const error = new FsIoError('write failed', { partiallyWritten: ['plan'] });

    expect(errorMapping.reportError(error, { scope: 'run' })).toEqual({
      scope: 'run',
      kind: 'environment',
      code: 'FS_IO_ERROR',
      message: 'write failed',
    });
  });

  it('never adds details to a non-fs-io error even if its runtime shape carries them', () => {
    const error = new ClassifiedError('browser-launch-failed', 'browser failed', {
      partiallyWritten: ['plan'],
    });

    expect(errorMapping.reportError(error, { scope: 'case', caseId: 'login-succeeds' })).toEqual({
      scope: 'case',
      kind: 'environment',
      code: 'BROWSER_LAUNCH_FAILED',
      caseId: 'login-succeeds',
      message: 'browser failed',
    });
  });

  it.each(REPORTABLE_ERROR_DETAILS)('copies a string hint for every reportable %s scope and code', (kind) => {
    const error = new ClassifiedError(kind, 'failed', { hint: 'Use the documented remediation.' });
    const location = kind === 'interrupted' ? { scope: 'run' as const } : { scope: 'case' as const, caseId: 'case-a' };

    expect(errorMapping.reportError(error, location as never)).toMatchObject({ hint: 'Use the documented remediation.' });
  });

  it.each([
    [new AiResponseInvalidError('invalid response', { issues: [{ code: 'invalid-json', path: [] }], attempts: [{ attempt: 1, code: 'AI_RESPONSE_INVALID' }] }), { issues: [{ code: 'invalid-json', path: [] }], attempts: [{ attempt: 1, code: 'AI_RESPONSE_INVALID' }] }],
    [new ClassifiedError('secret-literal-rejected', 'literal', { detector: 'credential-prefix-sk', path: 'generatorMeta.apiKey', attempts: [] }), { detector: 'credential-prefix-sk', path: 'generatorMeta.apiKey', attempts: [] }],
    [new SecretGrantUnattributableError('grant', { reason: 'citation-not-found', secretRef: '{{secrets.API_TOKEN}}', stepId: 'step-a', hint: 'repair' }), { reason: 'citation-not-found', secretRef: '{{secrets.API_TOKEN}}', stepId: 'step-a' }],
    [new AiExecutorUnavailableError('unavailable', { attempts: [] }), { attempts: [] }],
  ] as const)('projects normalized details for %s', (error, details) => {
    const report = errorMapping.reportError(error, { scope: 'run' });
    expect(report).toMatchObject({ details });
    expect(ReportError.safeParse(report).success).toBe(true);
  });

  it('projects an unexpected crash cause name from error.cause rather than details', () => {
    class AbortFailure extends Error { override name = 'AbortError'; }
    const error = new UnexpectedCrashError('crashed', { cause: { name: 'wrong-source' } }, { cause: new AbortFailure('aborted') });

    expect(errorMapping.reportError(error, { scope: 'run' })).toMatchObject({ details: { cause: { name: 'AbortError' } } });
    expect(errorMapping.projectCauseName(new Error('plain'))).toBe('Error');
    expect(errorMapping.projectCauseName({})).toBe('Error');
    expect(errorMapping.projectCauseName(undefined)).toBe('Error');
  });

  it.each(CAUSE_NAMES)('projects the allowlisted %s Error name', (name) => {
    const cause = Object.assign(new Error('crashed'), { name });

    expect(errorMapping.projectCauseName(cause)).toBe(name);
  });

  it('falls back for a plain object that mimics an allowlisted Error name', () => {
    expect(errorMapping.projectCauseName({ name: 'TypeError' })).toBe('Error');
  });

  it('projects a missing unexpected-crash cause as the generic Error detail', () => {
    const error = new UnexpectedCrashError('crashed');

    expect(errorMapping.reportError(error, { scope: 'run' }))
      .toMatchObject({ details: { cause: { name: 'Error' } } });
  });

  it('falls back safely when reading a crash cause name throws', () => {
    const cause = Object.defineProperty(new Error('crashed'), 'name', { get() { throw new Error('hostile name'); } });
    const error = new UnexpectedCrashError('crashed', undefined, { cause });

    expect(errorMapping.projectCauseName(cause)).toBe('Error');
    expect(errorMapping.reportError(error, { scope: 'run' })).toMatchObject({ details: { cause: { name: 'Error' } } });
  });

  it('omits malformed details rather than throwing or serializing them', () => {
    const error = new ClassifiedError('ai-response-invalid', 'invalid', { issues: [{ code: 'other', path: [] }] });

    expect(errorMapping.reportError(error, { scope: 'run' })).not.toHaveProperty('details');
  });

  it('preserves a real literal-secret rejection through report serialization', () => {
    let caught: unknown;
    try {
      assertNoLiteralSecrets({ generatorMeta: { apiKey: 'sk-test-literal' } });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AmbercastError);
    const report = errorMapping.reportError(caught as AmbercastError, { scope: 'run' });
    expect(report).toMatchObject({ details: { detector: 'credential-prefix-sk', path: 'generatorMeta.apiKey' } });
    expect(ReportError.safeParse(report).success).toBe(true);
  });
});
