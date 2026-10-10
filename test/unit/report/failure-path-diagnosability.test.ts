import { describe, expect, it, vi } from 'vitest';
import { AmbercastError, type ErrorKind, type ReportableErrorKind } from '#core/errors/types.js';
import { ERROR_EXIT_CODES } from '#core/errors/exit-codes.js';
import { CaseAbortedError } from '#core/errors/case-aborted-error.js';
import { PromptAmbiguousError } from '#core/errors/prompt-ambiguous-error.js';
import { REPORT_ERROR_DETAILS, projectReportErrorDetails, reportError } from '#report/error-mapping.js';
import { REPORT_SCHEMA_VERSION, type ReportError } from '#report/schema.js';
import { summarizeReport } from '#report/summarize.js';
import { assertDiagnosable } from '../../support/report-assertions.js';
import { run, type RunDeps, type RunOutcome } from '#usecases/run.js';
import { heal, type HealOutcome } from '#usecases/heal.js';
import { generate, type GenerateOutcome } from '#usecases/generate.js';
import { buildRunReport } from '#usecases/run-report.js';
import { buildHealReport } from '#usecases/heal-report.js';
import { buildGenerateReport } from '#usecases/generate-report.js';
import { Step } from '#core/ir/schema.js';
import { computeIntentDigest } from '#core/ir/digest.js';
import { SNAPSHOT_INVALID } from '#core/ir/aria-snapshot.js';
import { AgenticTargetRejection } from '#core/errors/agentic-target-rejection.js';
import { AiExecutorUnavailableError } from '#core/errors/ai-executor-unavailable-error.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import type { InstructionCoveredAiAgenticRequest } from '#ports/ai.js';
import { createFakeSecretsProvider } from '../../doubles/fake-secrets-provider.js';
import { elementRefKey } from '../../doubles/fake-browser-session.js';
import type { GroundingDocument } from '#core/ir/schema.js';
import {
  createScenario as createRunScenario, createFakeBrowserSession, writePrompt as writeRunPrompt,
  seedFreshArtifacts as seedRunArtifacts, elementGrounding, liveEntries, aiStep,
  DEFAULT_OPTIONS as RUN_OPTIONS, EMAIL, PASSWORD, SUBMIT, FINGERPRINT, RESOLVED_TARGETS,
  type TestStep,
} from '../../support/run-scenario.js';
import {
  createScenario as createGenerateScenario, writePrompt as writeGeneratePrompt,
  DEFAULT_OPTIONS as GENERATE_OPTIONS,
} from '../../support/generate-scenario.js';
import {
  createScenario as createHealScenario, OPTIONS as HEAL_OPTIONS, SUBMIT as HEAL_SUBMIT,
} from '../../support/heal-scenario.js';

const CASE_ID = 'case-a';
const CASE_FILE = 'case-a.test.md';
const CASE_LOCATION = { scope: 'case' as const, caseId: CASE_ID };
const STARTED_AT = '2026-01-01T00:00:00Z';

class ClassifiedError extends AmbercastError {
  constructor(readonly kind: ErrorKind, message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, details, options);
  }
}

const REPORTABLE_KIND_ORACLE = Object.keys(ERROR_EXIT_CODES).filter(
  (kind): kind is ReportableErrorKind => kind !== 'assertion-failed' && kind !== 'no-tests-found' && kind !== 'port-unavailable',
);

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

type RouteResult = {
  envelope: unknown;
  exitCode: number;
  caseId: string | undefined;
  error: AmbercastError | undefined;
  stage3Error?: AmbercastError | undefined;
  repairTrace?: readonly unknown[] | undefined;
  steps?: readonly { expected?: string | undefined; actual?: string | undefined }[] | undefined;
};
type RouteRow = {
  id: string;
  run: () => Promise<RouteResult>;
  expectCode: string | undefined;
  expectDetails?: Record<string, unknown>;
  expectExit: number;
};

function runReport(outcome: RunOutcome): RouteResult {
  const report = buildRunReport({ startedAt: STARTED_AT, durationMs: 0, options: { allowEmpty: false, list: false }, outcome });
  return { ...report, caseId: outcome.results[0]?.result.id, error: outcome.results[0]?.error, steps: outcome.results[0]?.result.steps };
}

async function runScenario(steps: readonly TestStep[], overrides: Partial<RunDeps> = {}, entries = {}): Promise<RouteResult> {
  const scenario = createRunScenario(overrides);
  const path = await writeRunPrompt(scenario.recordingStorage.storage);
  await seedRunArtifacts(scenario.recordingStorage.storage, path, steps, entries);
  return runReport(await run(scenario.deps, RUN_OPTIONS));
}

function generateReport(outcome: GenerateOutcome): RouteResult {
  const report = buildGenerateReport({ startedAt: STARTED_AT, durationMs: 0, options: GENERATE_OPTIONS, outcome });
  return { ...report, caseId: outcome.results[0]?.file, error: outcome.results[0]?.error };
}

function healReport(outcome: HealOutcome): RouteResult {
  const row = outcome.results[0];
  const report = buildHealReport({ startedAt: STARTED_AT, durationMs: 0, options: { allowEmpty: false, list: false },
    outcome: { ...outcome, results: outcome.results.map((entry) => ({ ...entry, application: 'no-artifact-change' as const })) },
  });
  return { ...report, caseId: row?.file, error: row?.stage3Error ?? row?.finalReplayError,
    stage3Error: row?.stage3Error, repairTrace: row?.repairTrace };
}

const INTENT_SPAN = { startLine: 3, startColumn: 1, endLine: 3, endColumn: 56 };
const QUOTED_PROMPT = '# Sign in\n\nWhen I "Submit" with "Password", I reach the dashboard.\n';
const SUBMIT_INTENT = { description: 'Submit button', roleHint: 'button', sourceSpan: INTENT_SPAN };
const SUBMIT_QUOTED_INTENT = { ...SUBMIT_INTENT, quote: { text: 'Submit', sourceSpan: { startLine: 3, startColumn: 9, endLine: 3, endColumn: 15 } } };
const EMAIL_INTENT = { description: 'Email textbox', roleHint: 'textbox', sourceSpan: INTENT_SPAN };
const PASSWORD_INTENT = { description: 'Password textbox', roleHint: 'textbox', sourceSpan: INTENT_SPAN };
const BLANK_ACTUAL = 'The browser returned no diagnostic.';

async function runReference(value: string): Promise<RouteResult> {
  const steps: TestStep[] = [{ id: 'fill-reference', kind: 'action', action: 'fill', target: EMAIL, intent: EMAIL_INTENT, value }];
  const session = createFakeBrowserSession(liveEntries([EMAIL]));
  const scenario = createRunScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
  const path = await writeRunPrompt(scenario.recordingStorage.storage);
  await seedRunArtifacts(scenario.recordingStorage.storage, path, steps, elementGrounding(['fill-reference']));
  return runReport(await run(scenario.deps, RUN_OPTIONS));
}

async function runAgentic(executeAgentic: (request: InstructionCoveredAiAgenticRequest) => Promise<{ outcome: 'success' | 'failure' }>): Promise<RouteResult> {
  return runScenario([aiStep()], { resolveAiExecutor: async () => createFakeAiExecutor({ executeAgentic }) });
}

async function runTargetRejection(exhausted: boolean): Promise<RouteResult> {
  const session = createFakeBrowserSession(liveEntries([SUBMIT]));
  vi.spyOn(session, 'resolveGrounded').mockResolvedValue({ kind: 'miss', reason: 'element-not-found' });
  return runScenario([aiStep()], {
    uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    resolveAiExecutor: async () => createFakeAiExecutor({ async executeAgentic(request) {
      for (let index = 0; index < (exhausted ? 4 : 1); index += 1) {
        try { await request.controller.perform({ type: 'click', element: SUBMIT }); }
        catch (error) {
          if (!(error instanceof AgenticTargetRejection)) throw error;
          if (!exhausted || index === 3) throw exhausted ? new AgenticTargetRejection(error.tool, error.reason, true) : error;
        }
      }
      throw new Error('The target rejection fixture did not reject.');
    } }),
  });
}

async function runAssertion(check: 'text-equals' | 'text-visible' | 'url-matches', message: string): Promise<RouteResult> {
  const session = createFakeBrowserSession(check === 'text-equals' ? liveEntries([SUBMIT]) : new Map(), {
    assertOutcome: { passed: false, message },
    snapshot: { accessibilityTree: { role: 'root', name: '', children: check === 'text-equals'
      ? [{ role: 'button', name: 'Submit', children: [] }] : [] }, screenshot: new Uint8Array() },
  });
  const step: TestStep = check === 'url-matches'
    ? { id: 'assert-dashboard', kind: 'assert', check, pattern: '/dashboard/.*', timeoutMs: 0 }
    : check === 'text-visible'
      ? { id: 'assert-dashboard', kind: 'assert', check, text: 'Dashboard', timeoutMs: 0 }
      : { id: 'assert-dashboard', kind: 'assert', check, target: SUBMIT, intent: SUBMIT_QUOTED_INTENT, text: 'Dashboard', timeoutMs: 0 };
  if (check !== 'text-equals') return runScenario([step], { uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
  const scenario = createRunScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
  const path = await writeRunPrompt(scenario.recordingStorage.storage, 'login.test.md', QUOTED_PROMPT);
  await seedRunArtifacts(scenario.recordingStorage.storage, path, [step], elementGrounding(['assert-dashboard']));
  return runReport(await run(scenario.deps, RUN_OPTIONS));
}

async function runClick(options: { resolve?: boolean; launchFailure?: boolean; invalidSnapshot?: boolean } = {}): Promise<RouteResult> {
  const session = createFakeBrowserSession(liveEntries([SUBMIT], options.invalidSnapshot ? { algorithm: 'a11y-neighborhood-v2', hash: 'b'.repeat(64) } : FINGERPRINT),
    options.invalidSnapshot ? { snapshot: { accessibilityTree: SNAPSHOT_INVALID, screenshot: new Uint8Array() } } : {});
  if (options.invalidSnapshot) vi.spyOn(session, 'accessibilitySnapshot')
    .mockResolvedValueOnce({ tree: SNAPSHOT_INVALID, rawYaml: '', scalarValues: [] })
    .mockResolvedValue({ tree: { role: 'root', name: 'recapture', children: [] }, rawYaml: '', scalarValues: [] });
  const scenario = createRunScenario({ uiExecutor: vi.fn(() => options.launchFailure
    ? { ...createFakeUiExecutor(() => session), async launch() { throw new Error('Chromium is unavailable.'); } }
    : createFakeUiExecutor(() => session)) });
  const path = await writeRunPrompt(scenario.recordingStorage.storage);
  const steps: TestStep[] = [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT, intent: SUBMIT_INTENT }];
  await seedRunArtifacts(scenario.recordingStorage.storage, path, steps);
  const deps = options.invalidSnapshot ? { ...scenario.deps, config: { ...scenario.deps.config,
    targets: { web: { ...RESOLVED_TARGETS.web, resolveTimeoutMs: 0 } } } } : scenario.deps;
  return runReport(await run(deps, { ...RUN_OPTIONS, resolve: options.resolve ?? options.invalidSnapshot ?? false }));
}

async function generateFailure(kind: 'unavailable' | 'invalid' | 'ambiguous'): Promise<RouteResult> {
  const ambiguities = ['Unclear target Alpha', 'Unclear target Beta'];
  const scenario = createGenerateScenario({ resolveAiExecutor: async () => createFakeAiExecutor({
    execute: async () => {
      if (kind === 'unavailable') throw new AiExecutorUnavailableError('Provider unavailable.');
      if (kind === 'invalid') throw new AiResponseInvalidError('Invalid response.');
      return { data: { steps: [], ambiguities }, raw: '{}' };
    },
  }) });
  await writeGeneratePrompt(scenario.recordingStorage.storage);
  return generateReport(await generate(scenario.deps, GENERATE_OPTIONS));
}

async function runSecretFillIncomplete(): Promise<RouteResult> {
  const secretRef = '{{secrets.ISSUE_167_REPLAY_ABORT}}';
  const session = createFakeBrowserSession(liveEntries([PASSWORD]), { onFillSecret() { throw new Error('Secret fill failed.'); } });
  const scenario = createRunScenario({
    uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    secrets: createFakeSecretsProvider(new Map([[secretRef, 'resolved-at-run-time']])),
  });
  const path = await writeRunPrompt(scenario.recordingStorage.storage);
  const trace = { events: [{ type: 'fill-secret', element: PASSWORD, secretRef }],
    verification: [{ type: 'assert', check: 'text-visible', text: 'Cached dashboard' }],
    verificationCoverage: { 'dashboard-reached': 0 } };
  await seedRunArtifacts(scenario.recordingStorage.storage, path, [aiStep('recorded-ai', [secretRef])],
    { 'recorded-ai': { kind: 'ai', trace } } as unknown as GroundingDocument['entries']);
  return runReport(await run(scenario.deps, RUN_OPTIONS));
}

async function runGroundingSecretContaminated(): Promise<RouteResult> {
  const secretRef = '{{secrets.classification}}';
  const secretValue = 'CLASSIFICATION_SECRET_VALUE';
  const session = createFakeBrowserSession(new Map([
    [elementRefKey(PASSWORD), { exists: true, currentFingerprint: FINGERPRINT }],
    [elementRefKey(SUBMIT), { exists: true, currentFingerprint: { algorithm: 'a11y-neighborhood-v2' as const, hash: 'b'.repeat(64) } }],
  ]), { snapshot: { accessibilityTree: { role: 'root', name: secretValue, children: [{ role: 'button', name: 'Submit', children: [] }] }, screenshot: new Uint8Array() } });
  const scenario = createRunScenario({
    uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: { confirmed: true }, raw: '{"confirmed":true}' }) }),
  });
  const path = await writeRunPrompt(scenario.recordingStorage.storage, 'login.test.md', QUOTED_PROMPT);
  const steps: TestStep[] = [
    { id: 'fill-password-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, intent: PASSWORD_INTENT, secretRef },
    { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT, intent: SUBMIT_QUOTED_INTENT },
  ];
  await seedRunArtifacts(scenario.recordingStorage.storage, path, steps,
    elementGrounding(['fill-password-secret'], {}, FINGERPRINT, { 'fill-password-secret': computeIntentDigest({ stepKind: 'action', operation: 'fill-secret', intent: PASSWORD_INTENT }) }));
  return runReport(await run(scenario.deps, RUN_OPTIONS));
}

async function runInterrupted(): Promise<RouteResult> {
  const controller = new AbortController();
  const session = createFakeBrowserSession(new Map(), { onClose: () => controller.abort(new Error('Stop after this case.')) });
  const scenario = createRunScenario({ signal: controller.signal,
    uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    discoverTestFiles: async () => ['login.test.md', 'second.test.md'],
  });
  const first = await writeRunPrompt(scenario.recordingStorage.storage);
  const second = await writeRunPrompt(scenario.recordingStorage.storage, 'second.test.md');
  await seedRunArtifacts(scenario.recordingStorage.storage, first, [{ id: 'open-first', kind: 'action', action: 'navigate', url: '/first' }]);
  await seedRunArtifacts(scenario.recordingStorage.storage, second, [{ id: 'open-second', kind: 'action', action: 'navigate', url: '/second' }]);
  return runReport(await run(scenario.deps, RUN_OPTIONS));
}

const EXPECTED_ROUTE_IDS = [
  'run/case-abort/run-reference-invalid', 'run/case-abort/run-value-missing',
  'run/case-abort/secret-fill-incomplete', 'run/case-abort/agentic-no-terminal-evidence',
  'run/case-abort/agentic-coverage-inexact', 'run/case-abort/agentic-proof-invalid',
  'run/case-abort/grounding-secret-contaminated', 'run/case-abort/grounding-snapshot-invalid',
  'run/target-rejection/not-exhausted', 'run/target-rejection/exhausted',
  'run/unclassified/error', 'run/unclassified/type-error', 'run/interrupted',
  'run/assertion-failed', 'run/blank-actual/text-equals', 'run/blank-actual/text-visible',
  'run/blank-actual/url-matches', 'run/agentic-declared-failure', 'run/grounding-unresolved',
  'run/browser-launch-failed', 'generate/ai-executor-unavailable', 'generate/ai-response-invalid',
  'generate/prompt-ambiguous', 'heal/stage3/ai-response-invalid', 'heal/stage3/prompt-ambiguous',
  'heal/final-replay/case-abort', 'heal/final-replay/target-rejection',
  'heal/final-replay/unclassified', 'heal/final-replay/agentic-declared-failure',
  'heal/final-replay/grounding-unresolved',
] as const;

const HEAL_AI_STEP = Step.parse({ id: 'ai-step', kind: 'ai', target: 'web', instruction: 'Click Submit',
  instructionCoverage: [{ id: 'dashboard-reached', kind: 'success', sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 56 } }],
});

function healCandidate() {
  return { steps: [{ id: 'ai-step', kind: 'ai', target: 'web', instruction: 'Click Submit',
    instructionCoverage: [{ id: 'dashboard-reached', kind: 'success', startAnchor: 'L3', startColumn: 1,
      endAnchor: 'L3', endColumn: 56, citation: 'When I submit valid credentials, I reach the dashboard.' }],
    verificationIntent: [{ criterionId: 'dashboard-reached', assertion: { type: 'assert', check: 'text-visible', text: 'Dashboard' } }],
  }], ambiguities: [] };
}

function healStage2OrStage3(request: { readonly context?: unknown }, stage3: unknown) {
  if (request.context !== null && typeof request.context === 'object' && 'accessibilityTree' in request.context) {
    return { data: { proposal: { outcome: 'ambiguous' } }, raw: '{"proposal":{"outcome":"ambiguous"}}' };
  }
  const frontier = (request.context as { trustedInputs?: { frontier?: unknown } } | undefined)?.trustedInputs?.frontier;
  return { data: frontier === undefined ? stage3 : { steps: [{ id: 'wrong-id', kind: 'action', target: 'web', action: 'navigate', url: '/ignored' }], ambiguities: [] }, raw: '{}' };
}

async function healStage3(kind: 'invalid' | 'ambiguous'): Promise<RouteResult> {
  const executor = createFakeAiExecutor({ execute: async (request) => healStage2OrStage3(request,
    kind === 'invalid' ? { steps: 'not-an-array', ambiguities: [] }
      : { steps: [], ambiguities: ['Unclear target Alpha', 'Unclear target Beta'] }),
  });
  const scenario = await createHealScenario({ grounding: {}, aiExecutor: executor });
  return healReport((await heal(scenario.deps, HEAL_OPTIONS)).outcome);
}

async function healFinal(kind: 'case-abort' | 'target-rejection' | 'unclassified' | 'agentic-declared-failure' | 'grounding-unresolved'): Promise<RouteResult> {
  const session = createFakeBrowserSession(liveEntries([SUBMIT]));
  if (kind === 'target-rejection') vi.spyOn(session, 'resolveGrounded').mockResolvedValue({ kind: 'miss', reason: 'element-not-found' });
  const executor = createFakeAiExecutor({
    execute: async (request) => healStage2OrStage3(request, kind === 'grounding-unresolved'
      ? { steps: [{ id: 'click-submit', kind: 'action', target: 'web', action: 'click', intent: { description: 'Submit', roleHint: 'button', startAnchor: 'L3', startColumn: 8, endAnchor: 'L3', endColumn: 14, citation: 'submit' } }], ambiguities: [] }
      : healCandidate()),
    async executeAgentic(request) {
      if (kind === 'unclassified') throw new Error('Provider failed.');
      if (kind === 'agentic-declared-failure') return { outcome: 'failure' };
      if (kind === 'target-rejection') await request.controller.perform({ type: 'click', element: HEAL_SUBMIT });
      return { outcome: 'success' };
    },
  });
  const scenario = await createHealScenario(kind === 'grounding-unresolved'
    ? { grounding: {}, aiExecutor: executor }
    : { steps: [HEAL_AI_STEP], grounding: {}, aiExecutor: executor,
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
  const result = healReport((await heal(scenario.deps, HEAL_OPTIONS)).outcome);
  expect(result.stage3Error).toBeUndefined();
  expect(result.repairTrace).toContainEqual(expect.objectContaining({ stage: 'stage3', outcome: 'not-passing' }));
  if (kind !== 'grounding-unresolved') {
    const errors = (result.envelope as { errors: ReportError[] }).errors;
    expect(errors.some((error) => error.code === 'GROUNDING_UNRESOLVED')).toBe(false);
  }
  return result;
}

const FAILURE_PATH_ROWS: readonly RouteRow[] = [
  { id: 'run/case-abort/run-reference-invalid', run: () => runReference('before {{run.profile.name}} after'), expectCode: 'CASE_ABORTED', expectDetails: { reason: 'run-reference-invalid' }, expectExit: 3 },
  { id: 'run/case-abort/run-value-missing', run: () => runReference('before {{run.missing}} after'), expectCode: 'CASE_ABORTED', expectDetails: { reason: 'run-value-missing' }, expectExit: 3 },
  { id: 'run/case-abort/secret-fill-incomplete', run: runSecretFillIncomplete, expectCode: 'CASE_ABORTED', expectDetails: { reason: 'secret-fill-incomplete' }, expectExit: 3 },
  { id: 'run/case-abort/agentic-no-terminal-evidence', run: () => runAgentic(async () => ({ outcome: 'success' })), expectCode: 'CASE_ABORTED', expectDetails: { reason: 'agentic-no-terminal-evidence' }, expectExit: 3 },
  { id: 'run/case-abort/agentic-coverage-inexact', run: () => runAgentic(async (request) => { await request.controller.evaluateAssert({ type: 'assert', check: 'text-visible', text: 'Dashboard' }, 'unlisted-criterion'); return { outcome: 'success' }; }), expectCode: 'CASE_ABORTED', expectDetails: { reason: 'agentic-coverage-inexact' }, expectExit: 3 },
  { id: 'run/case-abort/agentic-proof-invalid', run: () => runAgentic(async (request) => { await request.controller.evaluateAssert({ type: 'assert', check: 'text-visible', text: 'Dashboard' }); await request.controller.perform({ type: 'navigate', url: '/dashboard' }); await request.controller.evaluateAssert({ type: 'assert', check: 'text-visible', text: 'Dashboard' }, 'dashboard-reached'); return { outcome: 'success' }; }), expectCode: 'CASE_ABORTED', expectDetails: { reason: 'agentic-proof-invalid' }, expectExit: 3 },
  { id: 'run/case-abort/grounding-secret-contaminated', run: runGroundingSecretContaminated, expectCode: 'CASE_ABORTED', expectDetails: { reason: 'grounding-secret-contaminated' }, expectExit: 3 },
  { id: 'run/case-abort/grounding-snapshot-invalid', run: () => runClick({ invalidSnapshot: true }), expectCode: 'CASE_ABORTED', expectDetails: { reason: 'grounding-snapshot-invalid' }, expectExit: 3 },
  { id: 'run/target-rejection/not-exhausted', run: () => runTargetRejection(false), expectCode: 'AGENTIC_STEP_FAILED', expectDetails: { targetRejections: 1 }, expectExit: 3 },
  { id: 'run/target-rejection/exhausted', run: () => runTargetRejection(true), expectCode: 'AGENTIC_STEP_FAILED', expectDetails: { targetRejections: 4 }, expectExit: 3 },
  { id: 'run/unclassified/error', run: () => runAgentic(async () => { throw new Error('Provider failed.'); }), expectCode: 'UNEXPECTED_CRASH', expectDetails: { cause: { name: 'Error' } }, expectExit: 3 },
  { id: 'run/unclassified/type-error', run: () => runAgentic(async () => { throw new TypeError('Provider failed.'); }), expectCode: 'UNEXPECTED_CRASH', expectDetails: { cause: { name: 'TypeError' } }, expectExit: 3 },
  { id: 'run/interrupted', run: runInterrupted, expectCode: undefined, expectExit: 3 },
  { id: 'run/assertion-failed', run: () => runAssertion('text-visible', 'Observed text'), expectCode: undefined, expectExit: 1 },
  { id: 'run/blank-actual/text-equals', run: () => runAssertion('text-equals', ''), expectCode: undefined, expectExit: 1 },
  { id: 'run/blank-actual/text-visible', run: () => runAssertion('text-visible', ''), expectCode: undefined, expectExit: 1 },
  { id: 'run/blank-actual/url-matches', run: () => runAssertion('url-matches', ''), expectCode: undefined, expectExit: 1 },
  { id: 'run/agentic-declared-failure', run: () => runAgentic(async () => ({ outcome: 'failure' })), expectCode: 'AGENTIC_STEP_FAILED', expectExit: 3 },
  { id: 'run/grounding-unresolved', run: () => runClick(), expectCode: 'GROUNDING_UNRESOLVED', expectExit: 4 },
  { id: 'run/browser-launch-failed', run: () => runClick({ launchFailure: true }), expectCode: 'BROWSER_LAUNCH_FAILED', expectExit: 3 },
  { id: 'generate/ai-executor-unavailable', run: () => generateFailure('unavailable'), expectCode: 'AI_EXECUTOR_UNAVAILABLE', expectExit: 3 },
  { id: 'generate/ai-response-invalid', run: () => generateFailure('invalid'), expectCode: 'AI_RESPONSE_INVALID', expectExit: 3 },
  { id: 'generate/prompt-ambiguous', run: () => generateFailure('ambiguous'), expectCode: 'PROMPT_AMBIGUOUS', expectDetails: { ambiguities: 2 }, expectExit: 2 },
  { id: 'heal/stage3/ai-response-invalid', run: () => healStage3('invalid'), expectCode: 'AI_RESPONSE_INVALID', expectExit: 3 },
  { id: 'heal/stage3/prompt-ambiguous', run: () => healStage3('ambiguous'), expectCode: 'PROMPT_AMBIGUOUS', expectDetails: { ambiguities: 2 }, expectExit: 2 },
  { id: 'heal/final-replay/case-abort', run: () => healFinal('case-abort'), expectCode: 'CASE_ABORTED', expectExit: 1 },
  { id: 'heal/final-replay/target-rejection', run: () => healFinal('target-rejection'), expectCode: 'AGENTIC_STEP_FAILED', expectExit: 1 },
  { id: 'heal/final-replay/unclassified', run: () => healFinal('unclassified'), expectCode: 'UNEXPECTED_CRASH', expectExit: 1 },
  { id: 'heal/final-replay/agentic-declared-failure', run: () => healFinal('agentic-declared-failure'), expectCode: 'AGENTIC_STEP_FAILED', expectExit: 1 },
  { id: 'heal/final-replay/grounding-unresolved', run: () => healFinal('grounding-unresolved'), expectCode: 'GROUNDING_UNRESOLVED', expectExit: 4 },
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

  it('contains exactly the 30 fixed route IDs in both directions', () => {
    const actual = FAILURE_PATH_ROWS.map(({ id }) => id);
    expect(actual).toHaveLength(30);
    expect(new Set(actual).size).toBe(actual.length);
    expect(new Set(actual)).toEqual(new Set(EXPECTED_ROUTE_IDS));
    expect(new Set(EXPECTED_ROUTE_IDS)).toEqual(new Set(actual));
  });

  it.each(FAILURE_PATH_ROWS)('$id is diagnosable through the production route', async ({ id, run: execute, expectCode, expectDetails, expectExit }) => {
    const result = await execute();
    expect(assertDiagnosable(result.envelope)).toBeUndefined();
    const envelope = result.envelope as { errors: ReportError[] };
    const caseErrors = envelope.errors.filter((error) => error.scope === 'case');
    const matchingErrors = caseErrors.filter((error) => error.code === expectCode);
    if (expectCode === undefined) {
      expect(caseErrors).toEqual([]);
      if (id === 'run/interrupted') expect(envelope.errors).toEqual([expect.objectContaining({ scope: 'run', code: 'INTERRUPTED' })]);
    } else {
      expect(matchingErrors).toHaveLength(1);
      expect(matchingErrors[0]).toMatchObject({ scope: 'case', code: expectCode, caseId: result.caseId });
    }
    if (expectCode !== undefined && ['CASE_ABORTED', 'PROMPT_AMBIGUOUS', 'AGENTIC_STEP_FAILED', 'UNEXPECTED_CRASH', 'GROUNDING_UNRESOLVED'].includes(expectCode)) {
      const error = result.error;
      expect(error).toBeInstanceOf(AmbercastError);
      expect(matchingErrors[0]).toHaveProperty('details');
      if (expectDetails !== undefined) expect(matchingErrors[0]).toMatchObject({ details: expectDetails });
      expect(projectReportErrorDetails(error!, { scope: 'case', caseId: result.caseId! })).toMatchObject({ ok: true });
    }
    if (id === 'run/assertion-failed') {
      expect(typeof result.steps?.[0]?.expected).toBe('string');
      expect(result.steps?.[0]?.expected?.trim()).not.toBe('');
      expect(typeof result.steps?.[0]?.actual).toBe('string');
      expect(result.steps?.[0]?.actual?.trim()).not.toBe('');
    }
    if (id === 'run/blank-actual/text-equals') expect(result.steps?.[0]?.actual).toBe('The element text was empty.');
    if (id === 'run/blank-actual/text-visible' || id === 'run/blank-actual/url-matches') expect(result.steps?.[0]?.actual).toBe(BLANK_ACTUAL);
    expect(result.exitCode).toBe(expectExit);
  });
});
