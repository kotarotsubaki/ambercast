import { describe, expect, it } from 'vitest';
import { ERROR_DETAILS_KEY_ORDER, errorDetailEntries } from '#core/report-format/error-details.js';

const CASES = [
  ['EXECUTOR_UNSUPPORTED', { surface: 'browser', missing: ['click'], reason: 'unsupported-action', executor: 'playwright', target: 'local' }, [['target', 'local'], ['executor', 'playwright'], ['reason', 'unsupported-action'], ['missing', '["click"]'], ['surface', 'browser']]],
  ['BROWSER_LAUNCH_FAILED', { engine: 'chromium', reason: 'executable-missing' }, [['reason', 'executable-missing'], ['engine', 'chromium']]],
  ['PROMPT_PATH_INVALID', { reason: 'no-name', path: 'unsafe.test.md' }, [['path', 'unsafe.test.md'], ['reason', 'no-name']]],
  ['AI_RESPONSE_INVALID', { attempts: [{ attempt: 1, code: 'AI_RESPONSE_INVALID' }], issues: [{ code: 'invalid-json', path: ['dynamic\u007f\u0080'] }, { code: 'missing-field', path: ['steps', 0] }] }, [['issues', 'invalid-json @ ["dynamic\u007f\u0080"]; missing-field @ ["steps",0]'], ['attempts', '[{"attempt":1,"code":"AI_RESPONSE_INVALID"}]']]],
  ['AGENTIC_STEP_FAILED', { lastFailedAssertion: { check: 'text-visible' }, targetRejections: 1, failedAssertions: 2, passedAssertions: 1, assertions: 3, actions: 1, stepId: 'recorded-ai' }, [['stepId', 'recorded-ai'], ['actions', '1'], ['assertions', '3'], ['passedAssertions', '1'], ['failedAssertions', '2'], ['targetRejections', '1'], ['lastFailedAssertion', '{"check":"text-visible"}']]],
  ['SECRET_LITERAL_REJECTED', { attempts: [], path: 'generatorMeta.key', detector: 'credential-prefix-sk' }, [['detector', 'credential-prefix-sk'], ['path', 'generatorMeta.key'], ['attempts', '[]']]],
  ['SECRET_ENV_VAR_COLLISION', { refs: ['{{secrets.API_TOKEN}}'], envVar: 'AMBERCAST_SECRET_API_TOKEN' }, [['envVar', 'AMBERCAST_SECRET_API_TOKEN'], ['refs', '["{{secrets.API_TOKEN}}"]']]],
  ['SECRET_CONSENT_REQUIRED', { secrets: [{ name: 'API_TOKEN' }], reason: 'consent-required' }, [['reason', 'consent-required'], ['secrets', '[{"name":"API_TOKEN"}]']]],
  ['SECRET_SYNTAX_REJECTED', { occurrences: [{ kind: 'reference', line: 2 }] }, [['occurrences', '[{"kind":"reference","line":2}]']]],
  ['AI_EXECUTOR_UNAVAILABLE', { attempts: [] }, [['attempts', '[]']]],
  ['UNEXPECTED_CRASH', { cause: { name: 'AbortError' } }, [['cause', '{"name":"AbortError"}']]],
  ['FS_IO_ERROR', { partiallyWritten: ['plan', 'grounding'] }, [['partiallyWritten', '["plan","grounding"]']]],
  ['GROUNDING_UNRESOLVED', { reason: 'missing-target', stepId: 'step-a' }, [['stepId', 'step-a'], ['reason', 'missing-target']]],
  ['CASE_ABORTED', { stepId: 'step-2', reason: 'run-value-missing' }, [['reason', 'run-value-missing'], ['stepId', 'step-2']]],
  ['PROMPT_AMBIGUOUS', { ambiguities: 2 }, [['ambiguities', '2']]],
] as const;

describe('errorDetailEntries', () => {
  it('covers every ordered report code', () => {
    expect(CASES.map(([code]) => code)).toEqual(Object.keys(ERROR_DETAILS_KEY_ORDER));
  });

  it.each(CASES)('projects %s in field order with stringified values', (code, details, expected) => {
    expect(errorDetailEntries(code, details)).toEqual(expected);
  });

  it.each([null, 'opaque', ['not', 'an', 'object']])('ignores non-object details: %s', (details) => {
    expect(errorDetailEntries('CASE_ABORTED', details)).toEqual([]);
  });

  it('ignores an unknown code', () => {
    expect(errorDetailEntries('UNKNOWN_CODE', { reason: 'ignored' })).toEqual([]);
  });
});
