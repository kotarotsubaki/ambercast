import { expect, vi } from 'vitest';
import { createCallIdAllocator } from '#core/ai/call-id-allocator.js';
import { promptTemplateFingerprint } from '#core/ai/prompt-envelope.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { computeInputsDigest, computeIntentDigest, computePlanDigest } from '#core/ir/digest.js';
import { planProducerBundleFingerprint } from '#core/ai/plan-producer-bundle.js';
import { normalizeTestMd } from '#core/ir/normalize.js';
import { GroundingDocument, type ElementRef, type Fingerprint, type JsonValueT, type PlanDocument, Step } from '#core/ir/schema.js';
import { createLayoutResolver } from '#core/layout/resolve.js';
import type { BrowserSession } from '#ports/browser.js';
import type { StorageAdapter } from '#ports/storage.js';
import { run, type RunDeps, type RunOptions } from '#usecases/run.js';
import { CaseAbortedError, type CaseAbortReason } from '#core/errors/case-aborted-error.js';
import { buildRunReport } from '#usecases/run-report.js';
import { assertDiagnosable } from './report-assertions.js';
import { createFixedClock } from '../doubles/create-fixed-clock.js';
import { createInMemoryStorage } from '../doubles/create-in-memory-storage.js';
import { createRecordingEventSink } from '../doubles/create-recording-event-sink.js';
import { createFakeUiExecutor } from '../doubles/fake-ui-executor.js';
import { createFakeBrowserSession as createRawFakeBrowserSession, elementRefKey, type FakeBrowserSessionOptions, type FakeBrowserSessionEntry } from '../doubles/fake-browser-session.js';
import { createFakeSecretsProvider } from '../doubles/fake-secrets-provider.js';

export const TEST_DIR = '/workspace/tests';
export const RUNS_DIR = '/workspace/tests/.runs';
export const TARGETS = { web: { surface: 'web', baseUrl: 'https://example.test', executor: { kind: 'playwright', browser: 'chromium' } } } as const;
export const RESOLVED_TARGETS = { web: { ...TARGETS.web, healReplayIsolation: 'stateful' as const, resolveTimeoutMs: 5000 } } as const;
export const PROMPT = '# Sign in\n\nWhen I submit valid credentials, I reach the dashboard.\n';
export const DEFAULT_INSTRUCTION_COVERAGE = [{
  id: 'dashboard-reached',
  kind: 'success' as const,
  sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 56 },
}] as const;
export const FINGERPRINT: Fingerprint = { algorithm: 'a11y-neighborhood-v2', hash: 'a'.repeat(64) };
export const EMAIL: ElementRef = { strategy: 'accessibility', role: 'textbox', name: 'Email' };
export const PASSWORD: ElementRef = { strategy: 'accessibility', role: 'textbox', name: 'Password' };
export const SUBMIT: ElementRef = { strategy: 'accessibility', role: 'button', name: 'Submit' };
export const DEFAULT_OPTIONS: RunOptions = {
  files: [],
  resolve: true,
  updateCache: false,
  allowEmpty: false,
  list: false,
  stale: 'fail',
};
export function createFakeBrowserSession(
  entries: Map<string, FakeBrowserSessionEntry>,
  options: FakeBrowserSessionOptions = {},
) {
  return createRawFakeBrowserSession(entries, {
    baseUrl: TARGETS.web.baseUrl,
    currentUrl: TARGETS.web.baseUrl,
    ...options,
  });
}

export interface RecordingStorage {
  readonly storage: StorageAdapter;
  readonly reads: string[];
  readonly exists: string[];
  readonly writes: Array<{ readonly path: string; readonly text: string }>;
}

export interface Scenario {
  readonly deps: RunDeps;
  readonly uiExecutor: ReturnType<typeof vi.fn<RunDeps['uiExecutor']>>;
  readonly events: ReturnType<typeof createRecordingEventSink>;
  readonly recordingStorage: RecordingStorage;
  readonly sessionFactory: ReturnType<typeof vi.fn<() => BrowserSession>>;
  readonly resolveAiExecutor: ReturnType<typeof vi.fn<RunDeps['resolveAiExecutor']>>;
}

export type TestStep = Step extends infer Branch
  ? Branch extends Step
    ? 'intent' extends keyof Branch
      ? Omit<Branch, 'target'> & { target?: string | ElementRef; element?: ElementRef }
      : Omit<Branch, 'target'> & { target?: string }
    : never
  : never;

export function createRecordingStorage(): RecordingStorage {
  const backing = createInMemoryStorage();
  const reads: string[] = [];
  const exists: string[] = [];
  const writes: Array<{ readonly path: string; readonly text: string }> = [];

  return {
    reads,
    exists,
    writes,
    storage: {
      ...backing,
      async readText(path) {
        reads.push(path);
        return backing.readText(path);
      },
      async exists(path) {
        exists.push(path);
        return backing.exists(path);
      },
      async writeText(path, text) {
        writes.push({ path, text });
        return backing.writeText(path, text);
      },
    },
  };
}

export function createScenario(overrides: Partial<RunDeps> = {}): Scenario {
  const recordingStorage = createRecordingStorage();
  const events = createRecordingEventSink();
  const sessionFactory = vi.fn<() => BrowserSession>(() => createFakeBrowserSession(new Map()));
  const driver = createFakeUiExecutor(sessionFactory);
  const uiExecutor = vi.fn<RunDeps['uiExecutor']>(() => driver);
  const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => {
    throw new Error('The scenario did not permit an AI fallback.');
  });
  const deps: RunDeps = {
    storage: recordingStorage.storage,
    layout: createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR }),
    clock: createFixedClock(new Date('2026-08-09T00:00:00.000Z'), 0),
    runId: '2026-08-09T000000Z-550e8400-e29b-41d4-a716-446655440000',
    uiExecutor,
    secrets: createFakeSecretsProvider(new Map()),
    resolveAiExecutor,
    events: events.sink,
    discoverTestFiles: vi.fn(async () => ['login.test.md']),
    isCI: false,
    config: {
      testDir: TEST_DIR,
      testMatch: ['**/*.test.md'],
      testIgnore: ['**/.runs/**'],
      targets: RESOLVED_TARGETS,
      defaultTarget: 'web',
      ai: { provider: 'codex', timeoutMs: 120_000, maxGenerateAttempts: 2 },
      ci: { heal: false, updateGroundingCache: false },
      grounding: { repositoryPolicy: 'committed', localWriteBack: 'auto' },
      secrets: { allow: '*' },
    },
    ...overrides,
    allocateCallId: overrides.allocateCallId ?? createCallIdAllocator(),
  };

  return { deps, uiExecutor, events, recordingStorage, sessionFactory, resolveAiExecutor };
}

export function elementGrounding(stepIds: readonly string[], locators: Readonly<Record<string, ElementRef>> = {}, fingerprint: Fingerprint = FINGERPRINT, intentDigests: Readonly<Record<string, string>> = {}): GroundingDocument['entries'] {
  return Object.fromEntries(stepIds.map((id) => [id, {
    kind: 'element',
    locator: locators[id] ?? (/capture-second/.test(id) ? SUBMIT : /assert-path-a-account|assert-after-pipelines|assert-after-trace-replay|password|secret/.test(id) ? PASSWORD : /email|capture|name|prefix|reference|first|host|token/.test(id) ? EMAIL : SUBMIT),
    fingerprint,
    intentDigest: intentDigests[id] ?? 'a'.repeat(64),
    provenance: 'quoted-match',
  }])) as GroundingDocument['entries'];
}

export function intentDigestsFor(steps: readonly TestStep[]): Readonly<Record<string, string>> {
  return Object.fromEntries(steps.flatMap((step) => {
    if ((step.kind !== 'action' && step.kind !== 'capture') || !('intent' in step)) return [];
    return [[step.id, computeIntentDigest({ stepKind: step.kind, operation: step.kind === 'capture' ? 'capture' : step.action, intent: step.intent })]];
  }));
}

export function liveEntries(
  refs: readonly ElementRef[],
  currentFingerprint: Fingerprint = FINGERPRINT,
): Map<string, FakeBrowserSessionEntry> {
  return new Map(refs.map((ref) => [elementRefKey(ref), { exists: true, currentFingerprint }]));
}

export async function writePrompt(storage: StorageAdapter, relativePath = 'login.test.md', contents = PROMPT): Promise<string> {
  const path = `${TEST_DIR}/${relativePath}`;
  await storage.writeText(path, contents);
  return path;
}

export async function createFreshPlan(
  storage: StorageAdapter,
  testPath: string,
  steps: readonly TestStep[] = [],
  targetDefinitions: PlanDocument['targets'] = TARGETS,
): Promise<PlanDocument> {
  const planTargets = Object.fromEntries(Object.entries(targetDefinitions).map(([name, definition]) => [
    name,
    { surface: 'web', baseUrl: definition.baseUrl, ...(definition.secretSinkOrigins === undefined ? {} : { secretSinkOrigins: definition.secretSinkOrigins }) },
  ])) as PlanDocument['targets'];
  // SPEC-9/10: v4 binds each Plan step to a named Target. Legacy fixture
  // locators used `target`; keep their element meaning while migrating them.
  const committedSteps = steps.map((step) => {
    const legacy = step as unknown as Record<string, unknown>;
    const target = typeof legacy.target === 'string' ? legacy.target : Object.keys(targetDefinitions)[0];
    const element = legacy.intent === undefined && typeof legacy.target === 'object' && legacy.target !== null
      ? { element: legacy.target }
      : {};
    return Step.parse({ ...legacy, ...element, target });
  });
  const normalizedTestMd = normalizeTestMd(await storage.readText(testPath));
  const inputsDigest = computeInputsDigest({
    normalizedTestMd,
    schemaVersion: 5,
    generatorPromptTemplateFingerprint: promptTemplateFingerprint(),
    planProducerBundleFingerprint: planProducerBundleFingerprint(),
    targetDefinitions: planTargets,
  });
  const plan = {
    schemaVersion: 5,
    source: { inputsDigest },
    targets: planTargets,
    steps: committedSteps,
  } as unknown as PlanDocument;
  const layout = createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR });

  await storage.writeText(layout.planPathFor(testPath), toCanonicalArtifactText(plan as unknown as JsonValueT));
  return plan;
}

export async function seedFreshArtifacts(
  storage: StorageAdapter,
  testPath: string,
  steps: readonly TestStep[] = [],
  entries: GroundingDocument['entries'] = {},
  targetDefinitions: PlanDocument['targets'] = TARGETS,
): Promise<PlanDocument> {
  const plan = await createFreshPlan(storage, testPath, steps, targetDefinitions);
  const layout = createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR });
  const grounding: GroundingDocument = {
    schemaVersion: 3,
    planDigest: computePlanDigest(plan),
    entries,
  };

  await storage.writeText(layout.groundingPathFor(testPath), toCanonicalArtifactText(grounding as unknown as JsonValueT));
  return plan;
}

export function aiStep(id?: string): Extract<Step, { kind: 'ai' }>;
export function aiStep(id: string, secrets: readonly string[]): Extract<Step, { kind: 'ai' }>;
export function aiStep(id = 'recorded-ai', secrets?: readonly string[]): TestStep {
  const base = {
    id,
    kind: 'ai' as const,
    instruction: 'Complete the sign-in flow and verify the dashboard.',
    instructionCoverage: DEFAULT_INSTRUCTION_COVERAGE,
  };

  return (secrets === undefined ? base : { ...base, secrets: secrets.map((ref) => ({ ref })) }) as unknown as TestStep;
}

export function expectStopgapOutcome(
  outcome: Awaited<ReturnType<typeof run>>,
  abortingStepId: string,
  skippedStepId: string,
  reason: CaseAbortReason,
  completedStepId?: string,
): void {
  expect(outcome.results).toHaveLength(1);
  expect(outcome.results[0]?.error).toBeInstanceOf(CaseAbortedError);
  expect(outcome.results[0]?.error).toMatchObject({ kind: 'case-aborted', exitCode: 3, details: {
    reason, stepId: abortingStepId,
  } });
  expect(outcome.results[0]?.result).toMatchObject({
    status: 'error',
    steps: [
      ...(completedStepId === undefined ? [] : [{ id: completedStepId, status: 'passed' }]),
      { id: abortingStepId, status: 'error', kind: 'environment' },
      { id: skippedStepId, status: 'skipped' },
    ],
  });
  const report = buildRunReport({
    startedAt: '2026-10-07T00:00:00Z', durationMs: 0,
    options: { allowEmpty: false, list: false }, outcome,
  });
  expect(report.exitCode).toBe(3);
  expect(report.envelope.errors).toEqual([{
    scope: 'case', kind: 'environment', code: 'CASE_ABORTED',
    caseId: outcome.results[0]!.result.id,
    message: outcome.results[0]!.result.explanation,
    details: { reason, stepId: abortingStepId },
  }]);
  expect(report.envelope.errors[0]).not.toHaveProperty('hint');
  assertDiagnosable(report.envelope);
}
