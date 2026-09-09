import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { getReportJsonSchema } from '#report/json-schema.js';
import { ReportEnvelope } from '#report/schema.js';

const REPORT_METADATA = {
  $id: 'https://kotarotsubaki.github.io/ambercast/schemas/report.v3.schema.json',
  title: 'ambercast report schema v3.0',
  description: 'Zod schema for the complete versioned output of a reporting command.',
} as const;

const reportEnvelopeFields = {
  schemaVersion: '3.2',
  startedAt: '2026-09-08T12:34:56Z',
  durationMs: 1,
  summary: { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 },
  errors: [],
} as const;

const reportDocuments = [
  [
    'a valid generate report',
    {
      ...reportEnvelopeFields,
      command: 'generate',
      results: [{
        id: 'generate-case',
        file: 'cases/generate.test.md',
        planFile: 'cases/generate.ambercast.plan.json',
        status: 'generated',
        dryRun: false,
        ambiguities: [],
      }],
    },
    true,
  ],
  [
    'a valid run report',
    {
      ...reportEnvelopeFields,
      command: 'run',
      results: [{
        id: 'run-case',
        file: 'cases/run.test.md',
        planFile: 'cases/run.ambercast.plan.json',
        status: 'passed',
        durationMs: 1,
        steps: [],
        explanation: 'The test passed.',
      }],
      reportPersistence: 'not-attempted',
    },
    true,
  ],
  [
    'a valid check report',
    {
      ...reportEnvelopeFields,
      command: 'check',
      results: [{
        id: 'check-case',
        file: 'cases/check.test.md',
        planFile: 'cases/check.ambercast.plan.json',
        status: 'stale',
        reason: 'The plan inputs changed.',
      }],
    },
    true,
  ],
  [
    'a valid heal report',
    {
      ...reportEnvelopeFields,
      command: 'heal',
      results: [{
        id: 'heal-case',
        file: 'cases/heal.test.md',
        planFile: 'cases/heal.ambercast.plan.json',
        status: 'completed',
        repairOutcome: 'unresolved',
        application: 'no-artifact-change',
        stopReason: 'settled',
        durationMs: 1,
        steps: [],
        explanation: 'The repair was not eligible.',
      }],
    },
    true,
  ],
  [
    'a valid review report',
    {
      ...reportEnvelopeFields,
      command: 'review',
      results: [{
        id: 'review-case',
        file: 'cases/review.test.md',
        planFile: 'cases/review.ambercast.plan.json',
        status: 'sufficient',
        concerns: [],
      }],
    },
    true,
  ],
  [
    'a report with the wrong schema version',
    {
      ...reportEnvelopeFields,
      schemaVersion: '2.0',
      command: 'generate',
      results: [],
    },
    false,
  ],
  [
    'a generate report with a run-shaped result',
    {
      ...reportEnvelopeFields,
      command: 'generate',
      results: [{
        id: 'run-case',
        file: 'cases/run.test.md',
        planFile: 'cases/run.ambercast.plan.json',
        status: 'passed',
        durationMs: 1,
        steps: [],
        explanation: 'The test passed.',
      }],
    },
    false,
  ],
  [
    'a report with an unknown top-level key',
    {
      ...reportEnvelopeFields,
      command: 'generate',
      results: [],
      unexpected: true,
    },
    false,
  ],
  [
    'a report with a negative duration',
    {
      ...reportEnvelopeFields,
      durationMs: -1,
      command: 'generate',
      results: [],
    },
    false,
  ],
] as const;

describe('report JSON Schema document', () => {
  it('derives an equal but independent schema for every call', () => {
    const first = getReportJsonSchema();
    const second = getReportJsonSchema();

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it('returns a strict-compilable JSON Schema 2020-12 document', () => {
    const schema = getReportJsonSchema();

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(() => new Ajv2020({ strict: true }).compile(schema)).not.toThrow();
  });

  it('publishes the exact report schema metadata', () => {
    const schema = getReportJsonSchema();

    expect(schema.$id).toBe(REPORT_METADATA.$id);
    expect(schema.title).toBe(REPORT_METADATA.title);
    expect(schema.description).toBe(REPORT_METADATA.description);
  });

  it.each(reportDocuments)('matches ReportEnvelope for %s', (_name, document, expected) => {
    const validator = new Ajv2020({ strict: true }).compile(getReportJsonSchema());
    const zodVerdict = ReportEnvelope.safeParse(document).success;
    const ajvVerdict = validator(document);

    expect.soft(zodVerdict).toBe(expected);
    expect.soft(ajvVerdict).toBe(expected);
    expect(ajvVerdict).toBe(zodVerdict);
  });
});
