import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ReportEnvelope, REPORT_SCHEMA_VERSION, GroundingUnresolvedDetails } from '#report/schema.js';
import { getReportJsonSchema } from '#report/json-schema.js';
import { groundingUnresolvedHint, reportError } from '#report/error-mapping.js';
import { GroundingUnresolvedError } from '#core/errors/grounding-unresolved-error.js';
import { loadCorpus } from '../../support/corpus.js';
import { assertNoSecretDisclosure } from '../../support/report-assertions.js';

const validate = new Ajv2020({ strict: true }).compile(getReportJsonSchema());
function envelope(warnings?: unknown[]) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION, command: 'run', startedAt: '2026-11-26T00:00:00Z',
    durationMs: 0, summary: { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 }, errors: [],
    reportPersistence: 'persisted',
    results: [{ id: 'case-a', file: 'case-a.test.md', planFile: 'case-a.ambercast.plan.json',
      status: 'passed', durationMs: 0, steps: [], sessions: {}, explanation: 'The test passed.', ...(warnings ? { warnings } : {}) }],
  };
}
describe('neighbor-name notice public contract', () => {
  it('accepts the unchanged report fixture before adding notice fields', () => {
    expect(ReportEnvelope.safeParse(envelope()).success).toBe(true);
    expect(validate(envelope())).toBe(true);
  });
  it.each(loadCorpus(new URL('../../fixtures/corpus/report/neighbor-name-warning.jsonl', import.meta.url),
    { value: z.object({ names: z.unknown(), saved: z.unknown() }), expected: z.boolean() }))(
    'line $line: $note', ({ value, expected }) => {
      const document = envelope([{ kind: 'neighbor-name-ignored', stepId: 'submit', ...value }]);
      const runtime = ReportEnvelope.safeParse(document).success;
      const publicSchema = validate(document);
      expect({ runtime, publicSchema }).toEqual({ runtime: expected, publicSchema: expected });
    });
  it.each([
    { names: ['parent'], saved: true, unexpected: 'page text' },
    { names: ['parent'] },
    { saved: true },
    { names: ['parent'], saved: true, stepId: '' },
    { names: ['parent'], saved: true, stepId: 3 },
  ])('rejects malformed warning fields in both schemas: %j', (fields) => {
    const document = envelope([{ kind: 'neighbor-name-ignored', stepId: 'submit', ...fields }]);
    expect(ReportEnvelope.safeParse(document).success).toBe(false);
    expect(validate(document)).toBe(false);
  });
  it.each(['3.13', '3.12'])('accepts only the current output version: %s', (schemaVersion) => {
    const document = { ...envelope(), schemaVersion };
    expect({ runtime: ReportEnvelope.safeParse(document).success, publicSchema: validate(document) })
      .toEqual({ runtime: schemaVersion === '3.13', publicSchema: schemaVersion === '3.13' });
  });
  it('publishes the new output version', () => {
    expect(REPORT_SCHEMA_VERSION).toBe('3.13');
  });
});
const currentHint = 'Run `ambercast run --resolve` to allow AI resolution for grounding misses.';
const neighborHint = 'If that text changes on every run, such as a date or a counter, run `ambercast run --resolve` again; ambercast then stops comparing it for this step. If it should not have changed, check that the page shows the record you expect.';
describe('grounding difference diagnostics', () => {
  it.each([
    { verification: 'fingerprint-mismatch' as const, difference: 'neighbor-names' as const, changedNames: ['parent', 'siblingAfter'] as const },
    { verification: 'fingerprint-mismatch' as const, difference: 'structure' as const },
    { verification: 'fingerprint-mismatch' as const },
    { verification: 'element-not-found' as const },
    { verification: 'ambiguous-match' as const },
    { verification: 'snapshot-invalid' as const },
    { verification: 'secret-contaminated' as const },
  ])('preserves precisely the applicable diagnostic fields: %j', (diagnostics) => {
    const details = { stepId: 'submit', reason: 'recoverable-miss' as const, ...diagnostics };
    const error = new GroundingUnresolvedError('The binding could not be verified.', details);
    const output = reportError(error, { scope: 'case', caseId: 'case-a' });
    if (output.scope !== 'case' || output.code !== 'GROUNDING_UNRESOLVED') throw new Error('Unexpected report classification.');
    expect(output.details).toEqual(details);
    expect(Object.keys(output.details ?? {}).sort()).toEqual(Object.keys(details).sort());
    expect(output.hint).toBe('difference' in diagnostics && diagnostics.difference === 'neighbor-names' ? neighborHint : currentHint);
    assertNoSecretDisclosure({ secrets: { screen: 'Sensitive page text', token: 'secret-token-720' }, report: output });
  });
  it.each(loadCorpus(new URL('../../fixtures/corpus/report/neighbor-name-hints.jsonl', import.meta.url), {
    value: z.object({ difference: z.enum(['neighbor-names', 'structure']).optional() }), expected: z.string(),
  }))('line $line: $note', ({ value, expected }) => {
    expect(groundingUnresolvedHint('recoverable-miss', value.difference)).toBe(expected);
  });
  it('keeps candidate-changed evidence unchanged', () => {
    const details = { stepId: 'submit', reason: 'candidate-changed' as const, verification: 'fingerprint-mismatch' as const };
    expect(reportError(new GroundingUnresolvedError('The candidate changed.', details), { scope: 'case', caseId: 'case-a' }))
      .toMatchObject({ details, hint: 'Quote the UI text in the prompt or run `ambercast heal` to update the binding.' });
  });
  it.each([{ difference: 'neighbor-names' }, { difference: 'structure' }, { changedNames: ['parent'] }])(
    'validates diagnostic values independently of stop-point combinations: %j', (fields) => {
      const details = { stepId: 'submit', reason: 'missing', ...fields };
      expect(GroundingUnresolvedDetails.safeParse(details).success).toBe(true);
    });
  it.each([{ difference: null }, { difference: 'other' }, { changedNames: [] }, { changedNames: ['parent', 'parent'] },
    { changedNames: ['siblingAfter', 'parent'] }, { changedNames: null }])('rejects invalid individual evidence: %j', (fields) => {
      expect(GroundingUnresolvedDetails.safeParse({ stepId: 'submit', reason: 'recoverable-miss', ...fields }).success).toBe(false);
    });
});

