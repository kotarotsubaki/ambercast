/**
 * Reader-only validation for persisted 3.x run reports, including older 3.3,
 * 3.5, and 3.6 artifacts. The emission contract remains ReportEnvelope at
 * REPORT_SCHEMA_VERSION; relaxing it would change newly written reports.
 * This reader schema must not enter generate-json-schema.ts or the public JSON Schema.
 */
import { z } from 'zod';
import { OBSERVED_NOTE, Summary, SessionResult, NonWhitespaceString, NonNegativeInteger } from './schema.js';

/** Keeps the 3.7 observation payload required while retaining unknown legacy fields without treating them as display or admission evidence. */
export const LenientObserved = z.looseObject({
  note: z.literal(OBSERVED_NOTE),
  accessibilitySnapshot: z.string(),
});
export type LenientObserved = z.infer<typeof LenientObserved>;

/** Target is required in 3.7, but this reader permits its absence in older 3.x reports. Unknown fields survive parsing but never authorize rendering or classification; the remaining step constraints still apply. */
export const LenientStepResult = z.looseObject({
  id: NonWhitespaceString,
  type: z.enum(['action', 'assert', 'capture', 'ai']),
  status: z.enum(['passed', 'failed', 'error', 'skipped']),
  target: NonWhitespaceString.optional(),
  variable: NonWhitespaceString.optional(),
  kind: z.enum(['assertion', 'environment']).optional(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  screenshot: z.string().optional(),
  screenshotOmitted: z.literal('secret-detected').optional(),
  observed: LenientObserved.optional(),
}).superRefine((step, context) => {
  if (step.type !== 'capture' && step.variable !== undefined) {
    context.addIssue({ code: 'custom', path: ['variable'], message: 'Only capture steps may have a variable.' });
  }
});
export type LenientStepResult = z.infer<typeof LenientStepResult>;

/** Sessions are required in 3.7, but this reader permits their absence in 3.x reports. Case identity, outcome, steps, and explanation remain required. Unknown fields are retained without becoming viewer evidence. */
export const LenientExecutedRunResult = z.looseObject({
  id: NonWhitespaceString,
  file: NonWhitespaceString,
  planFile: NonWhitespaceString,
  status: z.enum(['passed', 'failed', 'error']),
  durationMs: NonNegativeInteger,
  aiCalls: NonNegativeInteger.optional(),
  steps: z.array(LenientStepResult),
  sessions: z.record(NonWhitespaceString, SessionResult).optional(),
  explanation: z.string(),
});
export type LenientExecutedRunResult = z.infer<typeof LenientExecutedRunResult>;

/** Preserves the 3.7 listed-case identity and status while tolerating unrecognized persisted metadata that the viewer does not use. */
export const LenientListedRunResult = z.looseObject({
  id: NonWhitespaceString,
  file: NonWhitespaceString,
  status: z.literal('listed'),
});
export type LenientListedRunResult = z.infer<typeof LenientListedRunResult>;

/** Preserves the 3.7 skipped-case identity and status while tolerating unrecognized persisted metadata that the viewer does not use. */
export const LenientSkippedResult = z.looseObject({
  id: NonWhitespaceString,
  file: NonWhitespaceString,
  status: z.literal('skipped'),
});
export type LenientSkippedResult = z.infer<typeof LenientSkippedResult>;

/** Keeps the 3.7 status branches distinct so legacy tolerance cannot turn an invalid outcome into a different case shape. */
export const LenientRunResult = z.discriminatedUnion('status', [LenientExecutedRunResult, LenientListedRunResult, LenientSkippedResult]);
export type LenientRunResult = z.infer<typeof LenientRunResult>;

const LenientRunErrorMessageFields = { message: z.string(), hint: z.string().optional() };

/** Accepts nonblank legacy codes outside the 3.7 enum without discarding them. As in the 3.7 run and case error branches, only case-scoped errors require caseId; unknown fields are retained but not interpreted. */
export const LenientReportError = z.union([
  z.looseObject({ scope: z.literal('run'), kind: z.literal('usage'), code: NonWhitespaceString, ...LenientRunErrorMessageFields, details: z.unknown().optional() }),
  z.looseObject({ scope: z.literal('run'), kind: z.literal('environment'), code: NonWhitespaceString, ...LenientRunErrorMessageFields, details: z.unknown().optional() }),
  z.looseObject({ scope: z.literal('case'), kind: z.literal('usage'), code: NonWhitespaceString, ...LenientRunErrorMessageFields, caseId: NonWhitespaceString, details: z.unknown().optional() }),
  z.looseObject({ scope: z.literal('case'), kind: z.literal('environment'), code: NonWhitespaceString, ...LenientRunErrorMessageFields, caseId: NonWhitespaceString, details: z.unknown().optional() }),
]);
export type LenientReportError = z.infer<typeof LenientReportError>;

/** Accepts persisted 3.x run envelopes while keeping the 3.7 run command and display-critical fields required. Unknown keys remain available in parsed data but cannot establish readability or drive the viewer. */
export const LenientRunReportEnvelope = z.looseObject({
  schemaVersion: z.string().regex(/^3\.\d+$/),
  command: z.literal('run'),
  startedAt: z.string(),
  durationMs: NonNegativeInteger,
  summary: Summary,
  errors: z.array(LenientReportError),
  results: z.array(LenientRunResult),
  reportPersistence: z.enum(['persisted', 'failed', 'not-attempted']),
});
export type LenientRunReportEnvelope = z.infer<typeof LenientRunReportEnvelope>;
