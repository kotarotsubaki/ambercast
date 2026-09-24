import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createFsStorage } from '#adapters/storage/fs-storage.js';
import { createCallIdAllocator } from '#core/ai/call-id-allocator.js';
import { promptTemplateFingerprint } from '#core/ai/prompt-envelope.js';
import * as planInputProvenance from '#core/ai/plan-input-provenance.js';
import { BrowserLaunchFailedError } from '#core/errors/browser-launch-failed-error.js';
import { AiExecutorUnavailableError } from '#core/errors/ai-executor-unavailable-error.js';
import { AgenticTargetRejection } from '#core/errors/agentic-target-rejection.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { BoundElementRejectedError } from '#core/errors/bound-element-rejected-error.js';
import { FsIoError } from '#core/errors/fs-io-error.js';
import { GroundingUnresolvedError } from '#core/errors/grounding-unresolved-error.js';
import { IntegrityViolationError } from '#core/errors/integrity-violation-error.js';
import { MissingPlanError } from '#core/errors/missing-plan-error.js';
import { SecretConsentRequiredError } from '#core/errors/secret-consent-required-error.js';
import { SecretEnvVarCollisionError } from '#core/errors/secret-env-var-collision-error.js';
import { SecretSyntaxRejectedError } from '#core/errors/secret-syntax-rejected-error.js';
import { SecretUnresolvedError } from '#core/errors/secret-unresolved-error.js';
import { StaleIrError } from '#core/errors/stale-ir-error.js';
import { PromptPathInvalidError } from '#core/errors/prompt-path-invalid-error.js';
import { TargetUnresolvedError } from '#core/errors/target-unresolved-error.js';
import { ERROR_EXIT_CODES } from '#core/errors/exit-codes.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { computeInputsDigest, computePlanDigest } from '#core/ir/digest.js';
import { planProducerBundleFingerprint } from '#core/ai/plan-producer-bundle.js';
import { computeAccessibilityFingerprint } from '#core/ir/fingerprint.js';
import {
  extractDiscardedScalarValues,
  parseAriaSnapshot,
  SNAPSHOT_INVALID,
} from '#core/ir/aria-snapshot.js';
import { normalizeTestMd } from '#core/ir/normalize.js';
import {
  GroundingDocument,
  type ElementRef,
  type Fingerprint,
  type JsonValueT,
  type PlanDocument,
  Step,
  type TraceAssert,
  type TraceEntry,
  type TraceRecord,
} from '#core/ir/schema.js';
import { createLayoutResolver } from '#core/layout/resolve.js';
import type { AiAgenticRequest, InstructionCoveredAiAgenticRequest } from '#ports/ai.js';
import type { BrowserSession, GroundedResolution, PerformableAction } from '#ports/browser.js';
import type { StorageAdapter } from '#ports/storage.js';
import type { Clock, RunEvent } from '#ports/system.js';
import { classifyBrowserLaunchFailure, PlanNavigationResolutionError, run, type RunDeps, type RunOptions } from '#usecases/run.js';
import { BatchInterruptionTracker } from '#usecases/batch-interruption.js';
import { validateCommittedInstructionCoverage } from '#usecases/instruction-coverage-policy.js';
import { buildRunReport } from '#usecases/run-report.js';
import { reportError } from '#report/error-mapping.js';
import { OBSERVED_NOTE, RunResult } from '#report/schema.js';
import { baseUrlSecretPolicy } from '../../doubles/base-url-secret-policy.js';
import { boundTarget } from '../../doubles/bound-target.js';
import { createFixedClock } from '../../doubles/create-fixed-clock.js';
import { createInMemoryStorage } from '../../doubles/create-in-memory-storage.js';
import { createRecordingEventSink } from '../../doubles/create-recording-event-sink.js';
import { expectSecretSinkOriginViolation } from '../../doubles/expect-secret-sink-origin-violation.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import {
  createFakeBrowserSession as createRawFakeBrowserSession,
  awaitElementPresenceCalls,
  elementRefKey,
  scheduleFakeAppearance,
  setFakeCurrentUrl,
  type FakeBrowserSessionOptions,
  type FakeBrowserSessionEntry,
} from '../../doubles/fake-browser-session.js';
import { createFakeSecretsProvider } from '../../doubles/fake-secrets-provider.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';

const groundingModeAccesses = vi.hoisted(() => ({ accesses: [] as string[] }));
const requestConstructionFailure = vi.hoisted(() => ({ enabled: false }));

vi.mock('#core/ai/ai-deadline.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#core/ai/ai-deadline.js')>();
  return {
    ...actual,
    composeAiDeadline(...args: Parameters<typeof actual.composeAiDeadline>) {
      const deadline = actual.composeAiDeadline(...args);
      if (!requestConstructionFailure.enabled) return deadline;
      return new Proxy(deadline, {
        get(target, property, receiver) {
          if (property === 'signal') throw new Error('request construction failed');
          return Reflect.get(target, property, receiver);
        },
      });
    },
  };
});

vi.mock('#core/ir/grounding-recovery-mode.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#core/ir/grounding-recovery-mode.js')>();
  const observeTable = <T extends object>(table: T, prefix: string): T => new Proxy(table, {
    get(target, property, receiver) {
      if (typeof property === 'string') groundingModeAccesses.accesses.push(`${prefix}.${property}`);
      return Reflect.get(target, property, receiver);
    },
  });
  return {
    ...actual,
    ACTION_GROUNDING_MODE: observeTable(actual.ACTION_GROUNDING_MODE, 'action'),
    ASSERT_GROUNDING_MODE: observeTable(actual.ASSERT_GROUNDING_MODE, 'assert'),
    groundingRecoveryModeForStep: (step: Parameters<typeof actual.groundingRecoveryModeForStep>[0]) => {
      groundingModeAccesses.accesses.push(`mode.${step.id}`);
      return actual.groundingRecoveryModeForStep(step);
    },
  };
});

const TEST_DIR = '/workspace/tests';
const RUNS_DIR = '/workspace/tests/.runs';
const TARGETS = { web: { surface: 'web', baseUrl: 'https://example.test', executor: { kind: 'playwright', browser: 'chromium' } } } as const;
const RESOLVED_TARGETS = { web: { ...TARGETS.web, healReplayIsolation: 'stateful' as const, resolveTimeoutMs: 5000 } } as const;
const PROMPT = '# Sign in\n\nWhen I submit valid credentials, I reach the dashboard.\n';
const DEFAULT_INSTRUCTION_COVERAGE = [{
  id: 'dashboard-reached',
  kind: 'success' as const,
  sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 56 },
}] as const;
const FINGERPRINT: Fingerprint = { algorithm: 'a11y-neighborhood-v2', hash: 'a'.repeat(64) };
const DIFFERENT_FINGERPRINT: Fingerprint = { algorithm: 'a11y-neighborhood-v2', hash: 'b'.repeat(64) };
const EMAIL: ElementRef = { strategy: 'accessibility', role: 'textbox', name: 'Email' };
const PASSWORD: ElementRef = { strategy: 'accessibility', role: 'textbox', name: 'Password' };
const SUBMIT: ElementRef = { strategy: 'accessibility', role: 'button', name: 'Submit' };
const DEFAULT_OPTIONS: RunOptions = {
  files: [],
  resolve: true,
  updateCache: false,
  allowEmpty: false,
  list: false,
  stale: 'fail',
};
const AI_TIMEOUT_MESSAGE = 'The AI provider did not respond within the configured timeout.';
const GENERIC_ABORT_EXPLANATION = 'The browser session could not complete this case and no deterministic fallback is available.';
const HIGH_ENTROPY_TOKEN_LITERAL = 'Zx9Qp2Lm7Vt4Rk8Ns3Wc6Yb1Hd5Jf0Ea';

describe('classifyBrowserLaunchFailure', () => {
  const engine = 'chromium';
  const executor = { kind: 'playwright', browser: engine } as const;

  it('TEST-6a keeps the MCP-free controller rejection budget out of the case abort', async () => {
    const session = createFakeBrowserSession(liveEntries([SUBMIT]));
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            await request.controller.perform({ type: 'press', element: SUBMIT, key: 'Enter' });
          } catch {
            // The executor deliberately retries only to prove the usecase has no MCP budget.
          }
        }
        return { outcome: 'failure' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    vi.spyOn(session, 'perform').mockRejectedValue(new AgenticTargetRejection('ambercast_perform', 'element-not-found'));
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.explanation).toBe('The AI-directed interaction did not complete successfully.');
  });

  it('TEST-6d gives a capture-time integrity failure precedence over a target rejection', async () => {
    const integrity = new IntegrityViolationError('Failure evidence violated an integrity boundary.');
    const session = createFakeBrowserSession(new Map());
    vi.spyOn(session, 'accessibilitySnapshot').mockRejectedValue(integrity);
    const executor = createFakeAiExecutor({
      async executeAgentic() {
        throw new AgenticTargetRejection('ambercast_perform', 'element-not-found', true);
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.explanation).toBe(integrity.message);
  });

  it.each([
    ['detects the executable-missing needle at the start', new Error("Executable doesn't exist at /path/to/chromium"), 'executable-missing'],
    ['detects the executable-missing needle in the middle of a message', new Error("Host system is missing dependencies.\nExecutable doesn't exist at /path"), 'executable-missing'],
    ['rejects a case-mismatched executable-missing needle', new Error("executable doesn't exist at /path"), 'launch-failed'],
    ['rejects alternate executable-missing wording', new Error('Executable does not exist at /path'), 'launch-failed'],
    ['requires the trailing space in the executable-missing needle', new Error("Executable doesn't exist at"), 'launch-failed'],
  ] as const)('%s', (_name, error, reason) => {
    expect(classifyBrowserLaunchFailure(error, executor)).toEqual({ reason, engine });
  });

  describe('SPEC-1 agentic target-rejection mapping', () => {
    const computeMissReasons = [
      'element-not-found',
      'ambiguous-match',
      'snapshot-invalid',
      'secret-contaminated',
    ] as const;
    const postBindReasons = [
      'navigation-stale',
      'fingerprint-verification-failed',
      'element-detached',
    ] as const;

    async function requestTargetRejection(
      invoke: (request: AiAgenticRequest) => Promise<void>,
      session: BrowserSession,
      step = aiStep(),
      secrets = createFakeSecretsProvider(new Map()),
    ): Promise<{ readonly caught: unknown; readonly outcome: Awaited<ReturnType<typeof run>>; readonly session: BrowserSession }> {
      let caught: unknown;
      const executor = createFakeAiExecutor({
        async executeAgentic(request) {
          try {
            await invoke(request);
          } catch (error) {
            caught = error;
          }
          return { outcome: 'failure' };
        },
      });
      const { deps, recordingStorage } = createScenario({
        uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
        resolveAiExecutor: async () => executor,
        secrets,
      });
      const testPath = await writePrompt(recordingStorage.storage);
      await seedFreshArtifacts(recordingStorage.storage, testPath, [step]);
      const outcome = await run(deps, DEFAULT_OPTIONS);
      return { caught, outcome, session };
    }

    it.each(computeMissReasons)('TEST-1a maps perform compute bind miss %s without journaling the action', async (reason) => {
      const session = createFakeBrowserSession(liveEntries([SUBMIT]));
      vi.spyOn(session, 'resolveGrounded').mockResolvedValue({ kind: 'miss', reason });
      const result = await requestTargetRejection(
        (request) => request.controller.perform({ type: 'press', element: SUBMIT, key: 'Enter' }),
        session,
      );

      expect(result.caught).toMatchObject({ tool: 'ambercast_perform', reason, exhausted: false });
      expect(result.caught).toBeInstanceOf(AgenticTargetRejection);
      expect(session.operations().filter((operation) => operation.type === 'perform')).toEqual([]);
    });

    it.each(computeMissReasons)('TEST-1b maps evaluateAssert compute bind miss %s', async (reason) => {
      const session = createFakeBrowserSession(liveEntries([SUBMIT]));
      vi.spyOn(session, 'resolveGrounded').mockResolvedValue({ kind: 'miss', reason });
      const result = await requestTargetRejection(
        (request) => request.controller.evaluateAssert({ type: 'assert', check: 'element-visible', element: SUBMIT }).then(() => undefined),
        session,
      );

      expect(result.caught).toMatchObject({ tool: 'ambercast_evaluate_assert', reason, exhausted: false });
      expect(result.caught).toBeInstanceOf(AgenticTargetRejection);
    });

    it.each(postBindReasons)('TEST-1c maps post-bind perform rejection %s', async (reason) => {
      const session = createFakeBrowserSession(liveEntries([SUBMIT]));
      vi.spyOn(session, 'perform').mockRejectedValue(new BoundElementRejectedError(reason, `rejected: ${reason}`));
      const result = await requestTargetRejection(
        (request) => request.controller.perform({ type: 'press', element: SUBMIT, key: 'Enter' }),
        session,
      );

      expect(result.caught).toMatchObject({ tool: 'ambercast_perform', reason, exhausted: false });
      expect(result.caught).toBeInstanceOf(AgenticTargetRejection);
    });

    it.each(postBindReasons)('TEST-1d maps post-bind evaluateAssert rejection %s', async (reason) => {
      const session = createFakeBrowserSession(liveEntries([SUBMIT]));
      vi.spyOn(session, 'evaluateAssert').mockRejectedValue(new BoundElementRejectedError(reason, `rejected: ${reason}`));
      const result = await requestTargetRejection(
        (request) => request.controller.evaluateAssert({ type: 'assert', check: 'element-visible', element: SUBMIT }).then(() => undefined),
        session,
      );

      expect(result.caught).toMatchObject({ tool: 'ambercast_evaluate_assert', reason, exhausted: false });
      expect(result.caught).toBeInstanceOf(AgenticTargetRejection);
    });

    it('TEST-1e maps a fill-secret generation rejection without exposing the resolved value', async () => {
      const secretRef = '{{secrets.AMBERCAST_SECRET_DUMMY_TARGET_REJECTION}}';
      const secretValue = 'AMBERCAST_SECRET_DUMMY_TARGET_REJECTION_VALUE';
      const session = createFakeBrowserSession(liveEntries([PASSWORD]));
      vi.spyOn(session, 'fillSecret').mockRejectedValue(new BoundElementRejectedError('navigation-stale', `rejected ${secretValue}`));
      const result = await requestTargetRejection(
        (request) => request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef }),
        session,
        aiStep('recorded-ai', [secretRef]),
        createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      );

      expect(result.caught).toMatchObject({ tool: 'ambercast_perform', reason: 'navigation-stale', exhausted: false });
      expect(result.caught).toBeInstanceOf(AgenticTargetRejection);
      expect(result.caught instanceof Error ? result.caught.message : String(result.caught)).not.toContain(secretValue);
    });

    it.each([
      ['perform', (request: AiAgenticRequest) => request.controller.perform({ type: 'press', element: SUBMIT, key: 'Enter' })],
      ['evaluateAssert', (request: AiAgenticRequest) => request.controller.evaluateAssert({ type: 'assert', check: 'element-visible', element: SUBMIT }).then(() => undefined)],
    ] as const)('TEST-1f preserves provenance-invalid as a non-recoverable %s error', async (_operation, invoke) => {
      const session = createFakeBrowserSession(liveEntries([SUBMIT]));
      if (_operation === 'perform') {
        vi.spyOn(session, 'perform').mockRejectedValue(new BoundElementRejectedError('provenance-invalid', 'invalid provenance'));
      } else {
        vi.spyOn(session, 'evaluateAssert').mockRejectedValue(new BoundElementRejectedError('provenance-invalid', 'invalid provenance'));
      }
      const result = await requestTargetRejection(invoke, session);

      expect(result.caught).toBeInstanceOf(Error);
      expect(result.caught).not.toBeInstanceOf(AgenticTargetRejection);
    });
  });

  it.each([
    [true, 'The AI-directed interaction exhausted its browser target budget: ambercast_perform was rejected (element-not-found) after 3 recoverable rejections.'],
    [false, 'The AI-directed interaction was rejected by a browser target it could not resolve (ambercast_perform: element-not-found).'],
  ] as const)('TEST-6b/c selects the case explanation for exhausted=%s', async (exhausted, explanation) => {
    const executor = createFakeAiExecutor({
      async executeAgentic() {
        throw new AgenticTargetRejection('ambercast_perform', 'element-not-found', exhausted);
      },
    });
    const { deps, recordingStorage } = createScenario({ resolveAiExecutor: async () => executor });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error', explanation, steps: [{ id: 'recorded-ai', status: 'error', kind: 'environment' }],
    });
    expect(outcome.results[0]?.error).toBeUndefined();
  });

  it.each([
    'Executable doesn\'t exist at /path',
    {},
    undefined,
    { message: "Executable doesn't exist at /path" },
  ])('falls back for a non-Error thrown value: %j', (error) => {
    expect(classifyBrowserLaunchFailure(error, executor)).toEqual({ reason: 'launch-failed', engine });
  });

  it('falls back when an Error message is not a string', () => {
    const error = Object.defineProperty(new Error('ignored'), 'message', { value: 42 });
    expect(classifyBrowserLaunchFailure(error, executor)).toEqual({ reason: 'launch-failed', engine });
  });

  it('falls back when an Error message getter throws', () => {
    class HostileMessageError extends Error {
      constructor() {
        super('ignored');
        Object.defineProperty(this, 'message', { get() { throw new Error('hostile message getter'); } });
      }
    }
    expect(classifyBrowserLaunchFailure(new HostileMessageError(), executor)).toEqual({ reason: 'launch-failed', engine });
  });

  it('falls back when the Error instanceof check throws', () => {
    const error = new Proxy({}, { getPrototypeOf() { throw new Error('hostile prototype getter'); } });
    expect(classifyBrowserLaunchFailure(error, executor)).toEqual({ reason: 'launch-failed', engine });
  });

  it('does not inspect a cause chain', () => {
    const error = new Error('generic launch failure', { cause: new Error("Executable doesn't exist at /path") });
    expect(classifyBrowserLaunchFailure(error, executor)).toEqual({ reason: 'launch-failed', engine });
  });
});
const CREDENTIAL_LITERALS = [
  ['an sk prefix', 'sk-live-secret-value', 'credential-prefix-sk'],
  ['a GitHub token prefix', 'ghp_secret-value', 'credential-prefix-ghp'],
  ['an AWS access key prefix', 'AKIASECRET123456789', 'credential-prefix-aws-access-key'],
  ['a high-entropy token', HIGH_ENTROPY_TOKEN_LITERAL, 'high-entropy-token'],
] as const;

function createFakeBrowserSession(
  entries: Map<string, FakeBrowserSessionEntry>,
  options: FakeBrowserSessionOptions = {},
) {
  return createRawFakeBrowserSession(entries, {
    baseUrl: TARGETS.web.baseUrl,
    currentUrl: TARGETS.web.baseUrl,
    ...options,
  });
}

interface RecordingStorage {
  readonly storage: StorageAdapter;
  readonly reads: string[];
  readonly exists: string[];
  readonly writes: Array<{ readonly path: string; readonly text: string }>;
}

interface Scenario {
  readonly deps: RunDeps;
  readonly uiExecutor: ReturnType<typeof vi.fn<RunDeps['uiExecutor']>>;
  readonly events: ReturnType<typeof createRecordingEventSink>;
  readonly recordingStorage: RecordingStorage;
  readonly sessionFactory: ReturnType<typeof vi.fn<() => BrowserSession>>;
  readonly resolveAiExecutor: ReturnType<typeof vi.fn<RunDeps['resolveAiExecutor']>>;
}

type TestStep = Step extends infer Branch
  ? Branch extends Step
    ? 'element' extends keyof Branch
      ? Omit<Branch, 'target' | 'element'> & { target?: string | ElementRef; element?: ElementRef }
      : Omit<Branch, 'target'> & { target?: string }
    : never
  : never;

function createRecordingStorage(): RecordingStorage {
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

function createScenario(overrides: Partial<RunDeps> = {}): Scenario {
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

function elementGrounding(stepIds: readonly string[]): GroundingDocument['entries'] {
  return Object.fromEntries(stepIds.map((id) => [id, { kind: 'element', fingerprint: FINGERPRINT }])) as GroundingDocument['entries'];
}

function liveEntries(
  refs: readonly ElementRef[],
  currentFingerprint: Fingerprint = FINGERPRINT,
): Map<string, FakeBrowserSessionEntry> {
  return new Map(refs.map((ref) => [elementRefKey(ref), { exists: true, currentFingerprint }]));
}

async function writePrompt(storage: StorageAdapter, relativePath = 'login.test.md', contents = PROMPT): Promise<string> {
  const path = `${TEST_DIR}/${relativePath}`;
  await storage.writeText(path, contents);
  return path;
}

async function createFreshPlan(
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
    const element = typeof legacy.target === 'object' && legacy.target !== null
      ? { element: legacy.target }
      : {};
    return Step.parse({ ...legacy, ...element, target });
  });
  const normalizedTestMd = normalizeTestMd(await storage.readText(testPath));
  const inputsDigest = computeInputsDigest({
    normalizedTestMd,
    schemaVersion: 4,
    generatorPromptTemplateFingerprint: promptTemplateFingerprint(),
    planProducerBundleFingerprint: planProducerBundleFingerprint(),
    targetDefinitions: planTargets,
  });
  const plan = {
    schemaVersion: 4,
    source: { inputsDigest },
    targets: planTargets,
    steps: committedSteps,
  } as unknown as PlanDocument;
  const layout = createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR });

  await storage.writeText(layout.planPathFor(testPath), toCanonicalArtifactText(plan as unknown as JsonValueT));
  return plan;
}

async function seedFreshArtifacts(
  storage: StorageAdapter,
  testPath: string,
  steps: readonly TestStep[] = [],
  entries: GroundingDocument['entries'] = {},
  targetDefinitions: PlanDocument['targets'] = TARGETS,
): Promise<PlanDocument> {
  const plan = await createFreshPlan(storage, testPath, steps, targetDefinitions);
  const layout = createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR });
  const grounding: GroundingDocument = {
    schemaVersion: 2,
    planDigest: computePlanDigest(plan),
    entries,
  };

  await storage.writeText(layout.groundingPathFor(testPath), toCanonicalArtifactText(grounding as unknown as JsonValueT));
  return plan;
}

function legacyTrace(events: readonly TraceEntry[], verification: readonly TraceAssert[]): TraceRecord {
  return { events: [...events], verification: [...verification] };
}

function coveredTrace(
  events: readonly TraceEntry[],
  verification: readonly TraceAssert[],
  verificationCoverage: Readonly<Record<string, number>> = { 'dashboard-reached': 0 },
): TraceRecord {
  return { events: [...events], verification: [...verification], verificationCoverage } as TraceRecord;
}

function aiGrounding(traceRecord: TraceRecord): GroundingDocument['entries'] {
  // SPEC-3/15: historical trace fixtures named their locator `target`.
  // Normalize fixture data at the cache boundary to the v4 `element` field.
  const migrate = (entry: TraceEntry | TraceAssert) => {
    const legacy = entry as unknown as Record<string, unknown>;
    if (typeof legacy.target !== 'object' || legacy.target === null) return entry;
    const { target: element, ...rest } = legacy;
    return { ...rest, element };
  };
  return { 'recorded-ai': { kind: 'ai', trace: {
    ...traceRecord,
    events: traceRecord.events.map(migrate),
    verification: traceRecord.verification.map(migrate),
  } as TraceRecord } };
}

function passingText(text: string): TraceAssert {
  return { type: 'assert', check: 'text-visible', text };
}

function evaluateTerminalAssert(
  request: InstructionCoveredAiAgenticRequest,
  assertion: TraceAssert,
  criterionId = 'dashboard-reached',
) {
  return request.controller.evaluateAssert(assertion, criterionId);
}

function aiCalls(events: ReturnType<typeof createRecordingEventSink>): readonly Extract<RunEvent, { type: 'ai-call' }>[] {
  return events.emitted().filter((event): event is Extract<RunEvent, { type: 'ai-call' }> => event.type === 'ai-call');
}

function aiResults(events: ReturnType<typeof createRecordingEventSink>): readonly Extract<RunEvent, { type: 'ai-result' }>[] {
  return events.emitted().filter((event): event is Extract<RunEvent, { type: 'ai-result' }> => event.type === 'ai-result');
}

function expectedAiCall(
  callId: string,
  stepId: string,
  file = `${TEST_DIR}/login.test.md`,
): Extract<RunEvent, { type: 'ai-call' }> {
  return { type: 'ai-call', callId, file, attempt: 1, attemptLimit: 1, stepId };
}

function pathBAccessibilityTree(statusName = 'Resolution status'): JsonValueT {
  return {
    role: 'root',
    name: '',
    children: [{
      role: 'main',
      name: 'Application',
      children: [
        {
          role: 'form',
          name: 'Sign in',
          children: [
            { role: 'textbox', name: 'Email', children: [] },
            { role: 'button', name: 'Submit', children: [] },
          ],
        },
        { role: 'status', name: statusName, children: [] },
      ],
    }],
  };
}

function pathBSnapshot(statusName?: string): { readonly accessibilityTree: JsonValueT; readonly screenshot: Uint8Array } {
  return {
    accessibilityTree: pathBAccessibilityTree(statusName),
    screenshot: new Uint8Array([1, 2, 3]),
  };
}

function pathBFingerprint(tree: JsonValueT = pathBAccessibilityTree(), ref: ElementRef = SUBMIT): Fingerprint {
  const result = computeAccessibilityFingerprint(tree, ref, []);
  if (result.kind !== 'ok') {
    throw new Error('The Path-B fixture must contain exactly one matching target.');
  }

  return result.fingerprint;
}

async function readGrounding(storage: StorageAdapter, testPath: string): Promise<GroundingDocument> {
  const layout = createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR });
  return GroundingDocument.parse(JSON.parse(await storage.readText(layout.groundingPathFor(testPath))));
}

function aiStep(id?: string): Extract<Step, { kind: 'ai' }>;
function aiStep(id: string, secrets: readonly string[]): Extract<Step, { kind: 'ai' }>;
function aiStep(id = 'recorded-ai', secrets?: readonly string[]): TestStep {
  const base = {
    id,
    kind: 'ai' as const,
    instruction: 'Complete the sign-in flow and verify the dashboard.',
    instructionCoverage: DEFAULT_INSTRUCTION_COVERAGE,
  };

  return (secrets === undefined ? base : { ...base, secrets: secrets.map((ref) => ({ ref })) }) as unknown as TestStep;
}

function configWithAiTimeout(timeoutMs: number): RunDeps['config'] {
  return {
    testDir: TEST_DIR,
    testMatch: ['**/*.test.md'],
    testIgnore: ['**/.runs/**'],
    targets: RESOLVED_TARGETS,
    defaultTarget: 'web',
    ai: { provider: 'codex', timeoutMs, maxGenerateAttempts: 2 },
    ci: { heal: false, updateGroundingCache: false },
    grounding: { repositoryPolicy: 'committed', localWriteBack: 'auto' },
    secrets: { allow: [] },
  };
}

function expectAiTimeoutOutcome(outcome: Awaited<ReturnType<typeof run>>, stepId: string): void {
  expect(outcome.results[0]?.error).toBeInstanceOf(AiExecutorUnavailableError);
  expect(outcome.results[0]?.error).toMatchObject({
    kind: 'ai-executor-unavailable',
    message: AI_TIMEOUT_MESSAGE,
  });
  expect(outcome.results[0]?.result).toMatchObject({
    status: 'error',
    steps: [{ id: stepId, status: 'error', kind: 'environment' }],
    explanation: AI_TIMEOUT_MESSAGE,
  });
}

function expectCallerAbortOutcome(
  outcome: Awaited<ReturnType<typeof run>>,
  stepId: string,
): void {
  expect(outcome.results[0]?.error).toBeUndefined();
  // SPEC-16: caller cancellation is the interrupted case path.
  expect(outcome.results[0]?.result).toMatchObject({
    status: 'error',
    steps: [{ id: stepId, status: 'error', kind: 'environment' }],
    explanation: 'The run was interrupted.',
  });
}

function runWithinAiTimeoutTestWindow(deps: RunDeps): Promise<Awaited<ReturnType<typeof run>>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('The run did not settle after the configured AI timeout elapsed.'));
    }, 1_000);
    void run(deps, DEFAULT_OPTIONS).then(
      (outcome) => {
        clearTimeout(timer);
        resolve(outcome);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function expectStopgapOutcome(
  outcome: Awaited<ReturnType<typeof run>>,
  abortingStepId: string,
  skippedStepId: string,
  completedStepId?: string,
): void {
  expect(outcome.results).toHaveLength(1);
  expect(outcome.results[0]?.error).toBeUndefined();
  expect(outcome.results[0]?.result).toMatchObject({
    status: 'error',
    steps: [
      ...(completedStepId === undefined ? [] : [{ id: completedStepId, status: 'passed' }]),
      { id: abortingStepId, status: 'error', kind: 'environment' },
      { id: skippedStepId, status: 'skipped' },
    ],
  });
}

async function runFailureEvidenceScenario(
  session: BrowserSession,
  secretValues: ReadonlyMap<string, string>,
): Promise<Awaited<ReturnType<typeof run>>> {
  const secretRefs = [...secretValues.keys()];
  const { deps, recordingStorage } = createScenario({
    uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    secrets: createFakeSecretsProvider(secretValues),
  });
  const testPath = await writePrompt(
    recordingStorage.storage,
    'login.test.md',
    PROMPT,
  );
  const fillSteps: TestStep[] = secretRefs.map((secretRef, index) => ({
    id: `fill-secret-${index}`,
    kind: 'action',
    action: 'fill-secret',
    target: PASSWORD,
    secretRef,
  }));
  await seedFreshArtifacts(
    recordingStorage.storage,
    testPath,
    [
      ...fillSteps,
      { id: 'assert-dashboard', kind: 'assert', check: 'text-visible', text: 'Dashboard' },
    ],
    elementGrounding(fillSteps.map(({ id }) => id)),
  );

  return run(deps, DEFAULT_OPTIONS);
}

describe('run', () => {
  it('keeps the shared run success-span fixture locally re-extractable', () => {
    expect(validateCommittedInstructionCoverage(
      DEFAULT_INSTRUCTION_COVERAGE,
      normalizeTestMd(PROMPT),
    )).toEqual({
      success: true,
      data: [expect.objectContaining({ text: 'When I submit valid credentials, I reach the dashboard.' })],
    });
  });

  it('reports a missing plan as exit-4 failure before resolving a browser driver', async () => {
    const { deps, uiExecutor, recordingStorage } = createScenario();
    await writePrompt(recordingStorage.storage);

    const outcome = await run({ ...deps, config: { ...deps.config, secrets: { allow: [] } } }, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(MissingPlanError);
    expect(outcome.results[0]?.error).toMatchObject({ kind: 'missing-plan', exitCode: 4 });
    expect(uiExecutor).not.toHaveBeenCalled();
  });

  it.each([
    ['parseable non-canonical JSON', async (storage: StorageAdapter, testPath: string) => {
      await createFreshPlan(storage, testPath);
      const planPath = `${TEST_DIR}/login.ambercast.plan.json`;
      const canonical = await storage.readText(planPath);
      await storage.writeText(planPath, `${JSON.stringify(JSON.parse(canonical), null, 4)}\n`);
    }],
    ['unparseable JSON', async (storage: StorageAdapter) => {
      await storage.writeText(`${TEST_DIR}/login.ambercast.plan.json`, '{ malformed');
    }],
    ['schema-invalid JSON', async (storage: StorageAdapter) => {
      await storage.writeText(`${TEST_DIR}/login.ambercast.plan.json`, JSON.stringify({ schemaVersion: 2, steps: [{ id: 'missing-kind' }] }));
    }],
  ] as const)('reports %s as an integrity violation before resolving a browser driver', async (_description, arrangePlan) => {
    const { deps, uiExecutor, recordingStorage } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    await arrangePlan(recordingStorage.storage, testPath);

    const outcome = await run({ ...deps, config: { ...deps.config, secrets: { allow: [] } } }, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(outcome.results[0]?.error).toMatchObject({ kind: 'integrity-violation', exitCode: 4 });
    expect(uiExecutor).not.toHaveBeenCalled();
  });

  it('reports a canonical plan with an old inputs digest as stale before resolving a browser driver', async () => {
    const { deps, uiExecutor, recordingStorage } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    const plan = await createFreshPlan(recordingStorage.storage, testPath, [
      { id: 'open-dashboard', kind: 'action', action: 'navigate', url: '/dashboard' },
    ]);
    await recordingStorage.storage.writeText(
      `${TEST_DIR}/login.ambercast.plan.json`,
      toCanonicalArtifactText({ ...plan, source: { inputsDigest: 'f'.repeat(64) } } as unknown as JsonValueT),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(StaleIrError);
    expect(outcome.results[0]?.error).toMatchObject({ kind: 'stale-ir', exitCode: 4 });
    expect(uiExecutor).not.toHaveBeenCalled();
  });

  it('rejects legacy secret syntax before target resolution or browser launch', async () => {
    const { deps, uiExecutor, recordingStorage } = createScenario();
    await writePrompt(recordingStorage.storage, 'login.test.md', `${PROMPT}\n@ambercast-${'secret'} {{secrets.FOO}}\n`);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    // SPEC-C1 C1-12
    expect(outcome.results[0]?.error).toBeInstanceOf(SecretSyntaxRejectedError);
    expect(outcome.results[0]?.error).toMatchObject({
      details: { hint: 'Delete the offending line(s) and re-run `ambercast generate`.' },
    });
    expect(outcome.results[0]?.error).not.toBeInstanceOf(TargetUnresolvedError);
    expect(uiExecutor).not.toHaveBeenCalled();
  });

  it('rejects legacy secret syntax with no browser or provider calls', async () => {
    const { deps, uiExecutor, recordingStorage, resolveAiExecutor } = createScenario();
    await writePrompt(recordingStorage.storage, 'login.test.md', `${PROMPT}\n{{secrets.FOO}}\n`);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(SecretSyntaxRejectedError);
    expect(uiExecutor).not.toHaveBeenCalled();
    expect(resolveAiExecutor).not.toHaveBeenCalled();
  });

  it('requires configured consent for committed secret uses before browser launch', async () => {
    const { deps, uiExecutor, recordingStorage, resolveAiExecutor } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{
      id: 'fill-password', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef: '{{secrets.LOGIN_PASSWORD}}',
    }]);

    const outcome = await run({ ...deps, config: { ...deps.config, secrets: { allow: [] } } }, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(SecretConsentRequiredError);
    expect(uiExecutor).not.toHaveBeenCalled();
    expect(resolveAiExecutor).not.toHaveBeenCalled();
  });

  it('denies committed secret uses when the optional consent dependency is absent', async () => {
    const { deps, uiExecutor, recordingStorage } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{
      id: 'fill-password', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef: '{{secrets.LOGIN_PASSWORD}}',
    }]);
    const { secrets: _secrets, ...configWithoutSecrets } = deps.config;

    const outcome = await run({ ...deps, config: configWithoutSecrets }, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(SecretConsentRequiredError);
    expect(uiExecutor).not.toHaveBeenCalled();
  });

  it('accepts every committed secret use when consent allows all names', async () => {
    const scenario = createScenario();
    const { deps, uiExecutor, recordingStorage } = scenario;
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{
      id: 'fill-password', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef: '{{secrets.LOGIN_PASSWORD}}',
    }]);

    const outcome = await run({ ...deps, config: { ...deps.config, secrets: { allow: '*' } } }, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).not.toBeInstanceOf(SecretConsentRequiredError);
    expect(uiExecutor).toHaveBeenCalled();
  });

  it('rejects committed secret refs that collide in environment-variable space before browser launch', async () => {
    const { deps, uiExecutor, recordingStorage, resolveAiExecutor } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'first', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef: '{{secrets.FOO_BAR}}' },
      { id: 'second', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef: '{{secrets.FOO.BAR}}' },
    ]);

    const outcome = await run({ ...deps, config: { ...deps.config, secrets: { allow: '*' } } }, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(SecretEnvVarCollisionError);
    expect(uiExecutor).not.toHaveBeenCalled();
    expect(resolveAiExecutor).not.toHaveBeenCalled();
  });

  it('rejects a v2 committed secret-span field at the strict plan-read boundary', async () => {
    const { deps, uiExecutor, recordingStorage } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    const plan = await createFreshPlan(recordingStorage.storage, testPath, []);
    await recordingStorage.storage.writeText(`${TEST_DIR}/login.ambercast.plan.json`, toCanonicalArtifactText({
      ...plan,
      steps: [{ id: 'fill-password', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef: '{{secrets.FOO}}', ['secretGrant' + 'Span']: { startLine: 1, endLine: 1 } }],
    } as unknown as JsonValueT));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(uiExecutor).not.toHaveBeenCalled();
  });

  it('replays normally when every fill-secret and AI-step secret ref is allowed', async () => {
    const secretRef = '{{secrets.LOGIN_PASSWORD}}';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]));
    const uiExecutor = vi.fn(() => createFakeUiExecutor(() => session));
    const { deps, events: _events, recordingStorage, resolveAiExecutor: _resolveAiExecutor } = createScenario({
      uiExecutor,
      secrets: createFakeSecretsProvider(new Map([[secretRef, 'resolved-at-run-time']])),
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'fill-password', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
        aiStep('recorded-ai', [secretRef]),
      ],
      {
        ...elementGrounding(['fill-password']),
        ...aiGrounding(coveredTrace([], [passingText('Dashboard')])),
      },
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result).toMatchObject({ status: 'passed', aiCalls: 0 });
    expect(outcome.results[0]?.error).toBeUndefined();
    expect(uiExecutor).toHaveBeenCalledTimes(1);
  });

  // SPEC-9/10: run has no selected Target; Plan targets define execution.
  it('reports a source prompt read failure as a pre-dispatch filesystem error', async () => {
    const { deps, uiExecutor, recordingStorage } = createScenario();
    await writePrompt(recordingStorage.storage);
    vi.spyOn(recordingStorage.storage, 'readText').mockRejectedValueOnce(new Error('prompt volume unavailable'));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(FsIoError);
    expect(outcome.results[0]?.error).toMatchObject({ kind: 'fs-io-error', exitCode: 3 });
    expect(outcome.results[0]?.result).toMatchObject({ status: 'error', steps: [] });
    expect(uiExecutor).not.toHaveBeenCalled();
  });

  it('SPEC-10 rejects a plan target missing from config before digest comparison', async () => {
    const { deps, uiExecutor, recordingStorage } = createScenario({
      config: {
        testDir: TEST_DIR,
        testMatch: ['**/*.test.md'],
        testIgnore: [],
        targets: RESOLVED_TARGETS,
        ai: { provider: 'codex', timeoutMs: 120_000, maxGenerateAttempts: 2 },
        ci: { heal: false, updateGroundingCache: false },
        grounding: { repositoryPolicy: 'committed', localWriteBack: 'auto' },
      },
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await createFreshPlan(recordingStorage.storage, testPath, [
      { id: 'open-dashboard', kind: 'action', action: 'navigate', target: 'not-configured', url: '/dashboard' },
    ], { 'not-configured': { surface: 'web', baseUrl: 'https://other.example.test' } });

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(TargetUnresolvedError);
    expect(outcome.results[0]?.error).toMatchObject({ kind: 'target-unresolved', exitCode: 2, details: { target: 'not-configured' } });
    expect(uiExecutor).not.toHaveBeenCalled();
  });

  it('reports aiCalls zero for a full grounding-cache hit and emits no AI lifecycle event', async () => {
    const closed = vi.fn();
    const session = createFakeBrowserSession(liveEntries([SUBMIT, EMAIL]), { onClose: closed });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    const steps: TestStep[] = [
      { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
      { id: 'fill-email', kind: 'action', action: 'fill', target: EMAIL, value: 'person@example.test' },
    ];
    await seedFreshArtifacts(recordingStorage.storage, testPath, steps, elementGrounding(['click-submit', 'fill-email']));
    const derive = vi.spyOn(planInputProvenance, 'deriveCurrentPlanInputProvenance');

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result).toMatchObject({ status: 'passed', aiCalls: 0 });
    expect(derive).toHaveBeenCalled();
    expect(events.emitted()).toEqual([
      { type: 'step-start', stepId: 'click-submit' },
      { type: 'step-result', stepId: 'click-submit', via: 'grounding' },
      { type: 'step-start', stepId: 'fill-email' },
      { type: 'step-result', stepId: 'fill-email', via: 'grounding' },
    ]);
    expect(aiCalls(events)).toEqual([]);
    expect(aiResults(events)).toEqual([]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('materializes ordinary actions through BrowserSession.perform and secret values through fillSecret', async () => {
    const performed: PerformableAction[] = [];
    const filled: unknown[] = [];
    const session = createFakeBrowserSession(liveEntries([SUBMIT, EMAIL, PASSWORD]), {
      onPerform(action) {
        performed.push(action);
      },
      onFillSecret(action) {
        filled.push(action);
      },
    });
    const secretRef = '{{secrets.auth.password}}';
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, 'not-in-the-plan']])),
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    const steps: TestStep[] = [
      { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
      { id: 'open-dashboard', kind: 'action', action: 'navigate', url: '/dashboard' },
      { id: 'press-enter', kind: 'action', action: 'press', target: EMAIL, key: 'Enter' },
      { id: 'fill-email', kind: 'action', action: 'fill', target: EMAIL, value: 'person@example.test' },
      { id: 'fill-password', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
    ];
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      steps,
      elementGrounding(['click-submit', 'press-enter', 'fill-email', 'fill-password']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(performed).toEqual([
      { type: 'click', target: boundTarget(SUBMIT, FINGERPRINT) },
      { type: 'navigate', url: '/dashboard' },
      { type: 'press', target: boundTarget(EMAIL, FINGERPRINT), key: 'Enter' },
      { type: 'fill', target: boundTarget(EMAIL, FINGERPRINT), value: 'person@example.test' },
    ]);
    expect(filled).toEqual([{
      type: 'fill-secret',
      target: boundTarget(PASSWORD, FINGERPRINT),
      value: 'not-in-the-plan',
      policy: baseUrlSecretPolicy(secretRef, TARGETS.web),
    }]);
  });

  it('rejects a cross-origin deterministic navigate before it reaches the browser', async () => {
    const session = createFakeBrowserSession(new Map());
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'leave-target', kind: 'action', action: 'navigate', url: 'https://evil.test/phish' },
    ]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(outcome.results[0]?.error).not.toBeInstanceOf(PlanNavigationResolutionError);
    expect(session.operations()).toEqual([]);
  });

  it('rejects a same-origin-looking blob: deterministic navigate before it reaches the browser', async () => {
    const session = createFakeBrowserSession(new Map());
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'leave-target', kind: 'action', action: 'navigate', url: 'blob:https://example.test/guard-test' },
    ]);

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error).not.toBeInstanceOf(PlanNavigationResolutionError);
    expect(error?.message).toBe('A navigation URL must use the replay target\'s HTTP(S) scheme.');
    expect(session.operations()).toEqual([]);
  });

  it('allows same-origin absolute and relative deterministic navigate URLs', async () => {
    const session = createFakeBrowserSession(new Map());
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'open-same-origin', kind: 'action', action: 'navigate', url: 'https://example.test/ok' },
      { id: 'open-relative', kind: 'action', action: 'navigate', url: '/relative' },
    ]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(session.operations()).toEqual([
      { type: 'perform', action: { type: 'navigate', url: 'https://example.test/ok' } },
      { type: 'perform', action: { type: 'navigate', url: '/relative' } },
    ]);
  });

  it('preserves the repairable class for an unresolvable deterministic navigate URL through redaction', async () => {
    const session = createFakeBrowserSession(new Map());
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'open-malformed', kind: 'action', action: 'navigate', url: 'https://[::1' },
    ]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(PlanNavigationResolutionError);
    expect(session.operations()).toEqual([]);
  });

  it('keeps an unresolvable fresh agentic navigate URL fail-closed as the base integrity class', async () => {
    const session = createFakeBrowserSession(new Map());
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'navigate', url: 'https://[::1' });
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error).not.toBeInstanceOf(PlanNavigationResolutionError);
    expect(session.operations()).toEqual([]);
  });

  it('does not retain a captured hostname in a rejected deterministic navigate result', async () => {
    const capturedHost = 'SENTINEL-HOST';
    const session = createFakeBrowserSession(liveEntries([EMAIL]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: capturedHost, value: 'unused' }]]),
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'capture-host', kind: 'capture', target: EMAIL, variable: 'captured' },
        { id: 'leave-target', kind: 'action', action: 'navigate', url: 'https://{{run.captured}}.evil.test' },
      ],
      elementGrounding(['capture-host']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const serializedResult = JSON.stringify(outcome.results[0]);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(serializedResult).not.toContain(capturedHost);
    expect(serializedResult).not.toContain(capturedHost.toLowerCase());
  });

  it('captures text and interpolates it in the middle of a later action value', async () => {
    const performed: PerformableAction[] = [];
    const session = createFakeBrowserSession(liveEntries([EMAIL, SUBMIT]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: 'Ari', value: 'wrong-mode' }]]),
      onPerform(action) {
        performed.push(action);
      },
    });
    const captureValue = vi.spyOn(session, 'captureValue');
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    const steps: TestStep[] = [
      { id: 'capture-name', kind: 'capture', target: EMAIL, variable: 'name' },
      { id: 'fill-greeting', kind: 'action', action: 'fill', target: SUBMIT, value: 'Hello, {{run.name}}!' },
    ];
    await seedFreshArtifacts(recordingStorage.storage, testPath, steps, elementGrounding(['capture-name', 'fill-greeting']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(captureValue).toHaveBeenCalledWith(boundTarget(EMAIL, FINGERPRINT), 'text');
    expect(performed).toEqual([{ type: 'fill', target: boundTarget(SUBMIT, FINGERPRINT), value: 'Hello, Ari!' }]);
  });

  it.each([
    ['an uncaptured single-segment reference', 'before {{run.missing}} after'],
    ['a multi-segment reference', 'before {{run.profile.name}} after'],
  ] as const)('aborts %s before consulting grounding and closes the session', async (_description, value) => {
    const closed = vi.fn();
    const session = createFakeBrowserSession(liveEntries([EMAIL]), { onClose: closed });
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded');
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    const steps: TestStep[] = [
      { id: 'before-reference', kind: 'action', action: 'navigate', url: '/before' },
      { id: 'fill-reference', kind: 'action', action: 'fill', target: EMAIL, value },
      { id: 'after-reference', kind: 'action', action: 'navigate', url: '/after' },
    ];
    await seedFreshArtifacts(recordingStorage.storage, testPath, steps, elementGrounding(['fill-reference']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expectStopgapOutcome(outcome, 'fill-reference', 'after-reference', 'before-reference');
    expect(resolveGrounded).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('resolves a fill-secret immediately before fillSecret without exposing the secret to the plan', async () => {
    const calls: string[] = [];
    const secretRef = '{{secrets.auth.password}}';
    const secrets = createFakeSecretsProvider(new Map([[secretRef, 'resolved-at-run-time']]));
    const resolve = vi.spyOn(secrets, 'resolve').mockImplementation((ref) => {
      calls.push(`secret:${ref}`);
      return 'resolved-at-run-time';
    });
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      onFillSecret() {
        calls.push('fillSecret');
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    const steps: TestStep[] = [{ id: 'fill-password', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef }];
    await seedFreshArtifacts(recordingStorage.storage, testPath, steps, elementGrounding(['fill-password']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(resolve).toHaveBeenCalledWith(secretRef);
    expect(calls).toEqual([`secret:${secretRef}`, 'fillSecret']);
  });

  it('fails closed for an unresolved fill-secret without calling fillSecret and closes the session', async () => {
    const closed = vi.fn();
    const fillSecret = vi.fn();
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), { onFillSecret: fillSecret, onClose: closed });
    const secretRef = '{{secrets.auth.password}}';
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map()),
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    const steps: TestStep[] = [
      { id: 'fill-password', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'after-password', kind: 'action', action: 'navigate', url: '/after' },
    ];
    await seedFreshArtifacts(recordingStorage.storage, testPath, steps, elementGrounding(['fill-password']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(SecretUnresolvedError);
    expect(outcome.results[0]?.error).toMatchObject({ kind: 'secret-unresolved', exitCode: 2 });
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      steps: [
        { id: 'fill-password', status: 'error', kind: 'environment' },
        { id: 'after-password', status: 'skipped' },
      ],
    });
    expect(fillSecret).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  describe('secret-sink origins', () => {
    const SECRET_REF = '{{secrets.auth.password}}';
    const SECRET_VALUE = 'resolved-at-run-time';
    const FILL_STEP: TestStep = {
      id: 'fill-password',
      kind: 'action',
      action: 'fill-secret',
      target: PASSWORD,
      secretRef: SECRET_REF,
    };
    const DENY_EVERYWHERE_TARGETS: RunDeps['config']['targets'] = {
      web: {
        ...RESOLVED_TARGETS.web,
        secretSinkOrigins: { [SECRET_REF]: [] },
      },
    };
    const DENY_EVERYWHERE_TARGET_DEFINITIONS: PlanDocument['targets'] = {
      web: {
        ...TARGETS.web,
        secretSinkOrigins: { [SECRET_REF]: [] },
      },
    };
    const IDP_ONLY_TARGETS: RunDeps['config']['targets'] = {
      web: {
        ...RESOLVED_TARGETS.web,
        secretSinkOrigins: { [SECRET_REF]: ['https://idp.example.test'] },
      },
    };
    const IDP_ONLY_TARGET_DEFINITIONS: PlanDocument['targets'] = {
      web: {
        ...TARGETS.web,
        secretSinkOrigins: { [SECRET_REF]: ['https://idp.example.test'] },
      },
    };

    it('never resolves a deterministic secret when its sink origin is denied', async () => {
      const session = createFakeBrowserSession(liveEntries([PASSWORD]));
      const secrets = createFakeSecretsProvider(new Map([[SECRET_REF, SECRET_VALUE]]));
      const resolve = vi.spyOn(secrets, 'resolve');
      const { deps, recordingStorage } = createScenario({
        uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
        config: { ...createScenario().deps.config, targets: DENY_EVERYWHERE_TARGETS },
        secrets,
      });
      const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
      await seedFreshArtifacts(recordingStorage.storage, testPath, [FILL_STEP], elementGrounding([FILL_STEP.id]), DENY_EVERYWHERE_TARGET_DEFINITIONS);

      const outcome = await run(deps, DEFAULT_OPTIONS);

      expectSecretSinkOriginViolation(outcome.results[0]?.error, {
        secretRef: SECRET_REF,
        allowedOrigins: [],
        source: 'configured',
      });
      expect(resolve).not.toHaveBeenCalled();
      expect(session.operations()).toEqual([]);
    });

    it('never resolves an agentic secret when its sink origin is denied', async () => {
      const session = createFakeBrowserSession(liveEntries([PASSWORD]));
      const secrets = createFakeSecretsProvider(new Map([[SECRET_REF, SECRET_VALUE]]));
      const resolve = vi.spyOn(secrets, 'resolve');
      const executor = createFakeAiExecutor({
        async executeAgentic(request) {
          await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef: SECRET_REF });
          return { outcome: 'success' };
        },
      });
      const { deps, recordingStorage } = createScenario({
        uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
        config: { ...createScenario().deps.config, targets: DENY_EVERYWHERE_TARGETS },
        resolveAiExecutor: async () => executor,
        secrets,
      });
      const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
      await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep('recorded-ai', [SECRET_REF])], {}, DENY_EVERYWHERE_TARGET_DEFINITIONS);

      const outcome = await run(deps, DEFAULT_OPTIONS);

      expectSecretSinkOriginViolation(outcome.results[0]?.error, {
        secretRef: SECRET_REF,
        allowedOrigins: [],
        source: 'configured',
      });
      expect(resolve).not.toHaveBeenCalled();
      expect(session.operations()).toEqual([]);
    });

    it.each([
      ['allows the default policy at the base URL origin', RESOLVED_TARGETS, TARGETS, TARGETS.web.baseUrl, true],
      ['denies the default policy at a different origin', RESOLVED_TARGETS, TARGETS, 'https://idp.example.test/login', false],
    ] as const)('%s', async (_description, targets, targetDefinitions, currentUrl, allowed) => {
      const session = createFakeBrowserSession(liveEntries([PASSWORD]), { currentUrl });
      const { deps, recordingStorage } = createScenario({
        uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
        config: { ...createScenario().deps.config, targets },
        secrets: createFakeSecretsProvider(new Map([[SECRET_REF, SECRET_VALUE]])),
      });
      const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
      await seedFreshArtifacts(recordingStorage.storage, testPath, [FILL_STEP], elementGrounding([FILL_STEP.id]), targetDefinitions);

      const outcome = await run(deps, DEFAULT_OPTIONS);

      if (allowed) {
        expect(outcome.results[0]?.result.status).toBe('passed');
        expect(session.operations()).toContainEqual({
          type: 'fill-secret',
          target: boundTarget(PASSWORD, FINGERPRINT),
          value: SECRET_VALUE,
          policy: baseUrlSecretPolicy(SECRET_REF, targets.web),
        });
      } else {
        expectSecretSinkOriginViolation(outcome.results[0]?.error, baseUrlSecretPolicy(SECRET_REF, targets.web));
        expect(session.operations().filter((operation) => operation.type === 'fill-secret')).toEqual([]);
      }
    });

    it('allows an explicit IdP origin while denying the target base URL as a replacement policy', async () => {
      const allowedSession = createFakeBrowserSession(liveEntries([PASSWORD]));
      setFakeCurrentUrl(allowedSession, 'https://idp.example.test/login');
      const allowedScenario = createScenario({
        uiExecutor: vi.fn(() => createFakeUiExecutor(() => allowedSession)),
        config: { ...createScenario().deps.config, targets: IDP_ONLY_TARGETS },
        discoverTestFiles: vi.fn(async () => ['allowed.test.md']),
        secrets: createFakeSecretsProvider(new Map([[SECRET_REF, SECRET_VALUE]])),
      });
      const allowedPath = await writePrompt(allowedScenario.recordingStorage.storage, 'allowed.test.md', PROMPT);
      await seedFreshArtifacts(allowedScenario.recordingStorage.storage, allowedPath, [FILL_STEP], elementGrounding([FILL_STEP.id]), IDP_ONLY_TARGET_DEFINITIONS);

      const allowedOutcome = await run(allowedScenario.deps, DEFAULT_OPTIONS);

      expect(allowedOutcome.results[0]?.result.status).toBe('passed');
      expect(allowedSession.operations()).toContainEqual({
        type: 'fill-secret',
        target: boundTarget(PASSWORD, FINGERPRINT),
        value: SECRET_VALUE,
        policy: {
          secretRef: SECRET_REF,
          allowedOrigins: ['https://idp.example.test'],
          source: 'configured',
        },
      });

      const deniedSession = createFakeBrowserSession(liveEntries([PASSWORD]));
      const deniedScenario = createScenario({
        uiExecutor: vi.fn(() => createFakeUiExecutor(() => deniedSession)),
        config: { ...createScenario().deps.config, targets: IDP_ONLY_TARGETS },
        discoverTestFiles: vi.fn(async () => ['denied.test.md']),
        secrets: createFakeSecretsProvider(new Map([[SECRET_REF, SECRET_VALUE]])),
      });
      const deniedPath = await writePrompt(deniedScenario.recordingStorage.storage, 'denied.test.md', PROMPT);
      await seedFreshArtifacts(deniedScenario.recordingStorage.storage, deniedPath, [FILL_STEP], elementGrounding([FILL_STEP.id]), IDP_ONLY_TARGET_DEFINITIONS);

      const deniedOutcome = await run(deniedScenario.deps, DEFAULT_OPTIONS);

      expectSecretSinkOriginViolation(deniedOutcome.results[0]?.error, {
        secretRef: SECRET_REF,
        allowedOrigins: ['https://idp.example.test'],
        source: 'configured',
      });
      expect(deniedSession.operations().filter((operation) => operation.type === 'fill-secret')).toEqual([]);
    });

    it('keeps trace priming while rejecting the replayed fill before the browser and agentic fallback', async () => {
      const session = createFakeBrowserSession(liveEntries([PASSWORD]), { currentUrl: 'https://idp.example.test/login' });
      const secrets = createFakeSecretsProvider(new Map([[SECRET_REF, SECRET_VALUE]]));
      const resolve = vi.spyOn(secrets, 'resolve');
      const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => createFakeAiExecutor({
        async executeAgentic() {
          throw new Error('A rejected trace must not start a fresh agentic fallback.');
        },
      }));
      const { deps, recordingStorage } = createScenario({
        uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
        resolveAiExecutor,
        secrets,
      });
      const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
      await seedFreshArtifacts(
        recordingStorage.storage,
        testPath,
        [aiStep('recorded-ai', [SECRET_REF])],
        aiGrounding(coveredTrace([{ type: 'fill-secret', element: PASSWORD, secretRef: SECRET_REF }], [passingText('Dashboard')])),
      );

      const outcome = await run(deps, DEFAULT_OPTIONS);

      expectSecretSinkOriginViolation(outcome.results[0]?.error, baseUrlSecretPolicy(SECRET_REF, TARGETS.web));
      expect(resolve).toHaveBeenCalledWith(SECRET_REF);
      expect(session.operations().filter((operation) => operation.type === 'fill-secret')).toEqual([]);
      expect(resolveAiExecutor).not.toHaveBeenCalled();
    });

    it('uses live config rather than a forged plan target snapshot in either direction', async () => {
      const narrowSession = createFakeBrowserSession(liveEntries([PASSWORD]), { currentUrl: 'https://idp.example.test/login' });
      const narrowSecrets = createFakeSecretsProvider(new Map([[SECRET_REF, SECRET_VALUE]]));
      const narrowResolve = vi.spyOn(narrowSecrets, 'resolve');
      const narrowSessionFactory = vi.fn(() => narrowSession);
      const narrowDriver = vi.fn<RunDeps['uiExecutor']>(() => createFakeUiExecutor(narrowSessionFactory));
      const narrowCurrentUrl = vi.spyOn(narrowSession, 'currentUrl');
      const narrowScenario = createScenario({
        uiExecutor: narrowDriver,
        discoverTestFiles: vi.fn(async () => ['narrow.test.md']),
        secrets: narrowSecrets,
      });
      const narrowPath = await writePrompt(narrowScenario.recordingStorage.storage, 'narrow.test.md', PROMPT);
      const narrowPlan = await createFreshPlan(narrowScenario.recordingStorage.storage, narrowPath, [FILL_STEP]);
      const narrowLayout = createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR });
      await narrowScenario.recordingStorage.storage.writeText(
        narrowLayout.planPathFor(narrowPath),
        toCanonicalArtifactText({
          ...narrowPlan,
          targets: {
            web: {
              ...narrowPlan.targets.web!,
              secretSinkOrigins: { [SECRET_REF]: ['https://idp.example.test'] },
            },
          },
        } as unknown as JsonValueT),
      );

      const narrowOutcome = await run(narrowScenario.deps, DEFAULT_OPTIONS);

      expectSecretSinkOriginViolation(narrowOutcome.results[0]?.error, baseUrlSecretPolicy(SECRET_REF, TARGETS.web));
      expect(narrowDriver).toHaveBeenCalled();
      expect(narrowSessionFactory).toHaveBeenCalledOnce();
      expect(narrowCurrentUrl).toHaveBeenCalledOnce();
      expect(narrowResolve).not.toHaveBeenCalled();
      expect(narrowSession.operations().filter((operation) => operation.type === 'fill-secret')).toEqual([]);

      const wideSnapshot = {
        accessibilityTree: {
          role: 'root',
          name: '',
          children: [{
            role: 'main',
            name: 'Application',
            children: [{ role: 'textbox', name: 'Password', children: [] }],
          }],
        },
        screenshot: new Uint8Array(),
      };
      const wideFingerprint = pathBFingerprint(wideSnapshot.accessibilityTree, PASSWORD);
      const wideSession = createFakeBrowserSession(liveEntries([PASSWORD], wideFingerprint), {
        currentUrl: 'https://idp.example.test/login',
        snapshot: wideSnapshot,
      });
      const wideTargets: RunDeps['config']['targets'] = {
        web: { ...RESOLVED_TARGETS.web, secretSinkOrigins: { [SECRET_REF]: ['https://idp.example.test'] } },
      };
      const wideTargetDefinitions: PlanDocument['targets'] = {
        web: { ...TARGETS.web, secretSinkOrigins: { [SECRET_REF]: ['https://idp.example.test'] } },
      };
      const wideScenario = createScenario({
        uiExecutor: vi.fn(() => createFakeUiExecutor(() => wideSession)),
        config: { ...createScenario().deps.config, targets: wideTargets },
        discoverTestFiles: vi.fn(async () => ['wide.test.md']),
        resolveAiExecutor: async () => createFakeAiExecutor({
          execute: async () => ({ data: { confirmed: true }, raw: '{"confirmed":true}' }),
        }),
        secrets: createFakeSecretsProvider(new Map([[SECRET_REF, SECRET_VALUE]])),
      });
      const widePath = await writePrompt(wideScenario.recordingStorage.storage, 'wide.test.md', PROMPT);
      const widePlan = await createFreshPlan(wideScenario.recordingStorage.storage, widePath, [FILL_STEP], wideTargetDefinitions);
      const wideLayout = createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR });
      await wideScenario.recordingStorage.storage.writeText(
        wideLayout.planPathFor(widePath),
        toCanonicalArtifactText({
          ...widePlan,
          targets: { web: { ...widePlan.targets.web!, secretSinkOrigins: { [SECRET_REF]: [] } } },
        } as unknown as JsonValueT),
      );

      const wideOutcome = await run(wideScenario.deps, DEFAULT_OPTIONS);

      expect(wideOutcome.results[0]?.result.status).toBe('passed');
      expect(wideSession.operations()).toContainEqual({
        type: 'fill-secret',
        target: boundTarget(PASSWORD, wideFingerprint),
        value: SECRET_VALUE,
        policy: {
          secretRef: SECRET_REF,
          allowedOrigins: ['https://idp.example.test'],
          source: 'configured',
        },
      });
    });

    it('keeps explicit navigate origin enforcement independent from a secret-sink allow-list', async () => {
      const session = createFakeBrowserSession(new Map());
      const { deps, recordingStorage } = createScenario({
        uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
        config: { ...createScenario().deps.config, targets: IDP_ONLY_TARGETS },
      });
      const testPath = await writePrompt(recordingStorage.storage);
      await seedFreshArtifacts(
        recordingStorage.storage,
        testPath,
        [{ id: 'leave-target', kind: 'action', action: 'navigate', url: 'https://idp.example.test/login' }],
        {},
        IDP_ONLY_TARGET_DEFINITIONS,
      );

      const outcome = await run(deps, DEFAULT_OPTIONS);

      expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
      expect(outcome.results[0]?.error).toMatchObject({ exitCode: 4 });
      expect(session.operations()).toEqual([]);
    });
  });

  it('records an assertion failure as results-only evidence and skips later steps', async () => {
    const closed = vi.fn();
    const session = createFakeBrowserSession(liveEntries([SUBMIT]), {
      assertOutcome: { passed: false, message: 'Submit was not visible.' },
      onClose: closed,
    });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    const steps: TestStep[] = [
      { id: 'assert-submit', kind: 'assert', check: 'element-visible', target: SUBMIT },
      { id: 'after-assertion', kind: 'action', action: 'navigate', url: '/after' },
    ];
    await seedFreshArtifacts(recordingStorage.storage, testPath, steps, elementGrounding(['assert-submit']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    // error-code-correspondence.test.ts owns the invariant that assertion-failed
    // is never serialized through reportError(); replay therefore retains no
    // classified error for this result-only failure.
    expect(outcome.results[0]?.error).toBeUndefined();
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'failed',
      steps: [
        { id: 'assert-submit', type: 'assert', status: 'failed', kind: 'assertion' },
        { id: 'after-assertion', status: 'skipped' },
      ],
    });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(events.emitted()).toEqual([
      { type: 'step-start', stepId: 'assert-submit' },
    ]);
  });

  it('aborts a browser-launch failure before any step has execution evidence', async () => {
    const sessionFactory = vi.fn<() => BrowserSession>(() => createFakeBrowserSession(new Map()));
    const driver = createFakeUiExecutor(sessionFactory);
    const launch = vi.spyOn(driver, 'launch').mockRejectedValue(new BrowserLaunchFailedError('Chromium could not launch.'));
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => driver),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'open-home', kind: 'action', action: 'navigate', url: '/' }]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(BrowserLaunchFailedError);
    // SPEC-14/25: launch fails before a session opens, while the attempted step records the error.
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      steps: [{ id: 'open-home', status: 'error', kind: 'environment', target: 'web' }],
      sessions: { web: { state: 'not-opened' } },
    });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(sessionFactory).not.toHaveBeenCalled();
  });

  it('classifies a generic browser-launch rejection and retains the resolved engine', async () => {
    const driver = createFakeUiExecutor(() => createFakeBrowserSession(new Map()));
    vi.spyOn(driver, 'launch').mockRejectedValue(new Error("Executable doesn't exist at /path/to/chromium"));
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => driver) });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'open-home', kind: 'action', action: 'navigate', url: '/' }]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toMatchObject({
      kind: 'browser-launch-failed',
      details: { reason: 'executable-missing', engine: 'chromium' },
    });
    expect(outcome.results[0]?.error?.details?.engine).toBe('chromium');
  });

  it('reports a grounding-unresolved error for a cold AI step in cache-only mode and closes the session', async () => {
    const closed = vi.fn();
    const session = createFakeBrowserSession(new Map(), { onClose: closed });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    const steps: TestStep[] = [
      { id: 'before-ai', kind: 'action', action: 'navigate', url: '/before' },
      {
        id: 'recorded-ai',
        kind: 'ai',
        instruction: 'Open the account settings.',
        instructionCoverage: DEFAULT_INSTRUCTION_COVERAGE,
      } as unknown as TestStep,
      { id: 'after-ai', kind: 'action', action: 'navigate', url: '/after' },
    ];
    await seedFreshArtifacts(recordingStorage.storage, testPath, steps);

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve: false });

    expect(outcome.results[0]?.error).toMatchObject({
      kind: 'grounding-unresolved',
      details: { stepId: 'recorded-ai', reason: 'missing' },
    });
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      steps: [
        { id: 'before-ai', status: 'passed' },
        { id: 'recorded-ai', status: 'error', kind: 'environment' },
        { id: 'after-ai', status: 'skipped' },
      ],
    });
    expect(outcome.results[0]?.result.aiCalls).toBe(0);
    expect(aiCalls(events)).toEqual([]);
    expect(aiResults(events)).toEqual([]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('reports a missing preflight miss for the first leading AI step before browser startup', async () => {
    const { deps, uiExecutor, recordingStorage, resolveAiExecutor } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep('first-ai')]);

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve: false });

    expect(outcome.results[0]?.error).toMatchObject({
      kind: 'grounding-unresolved',
      details: { stepId: 'first-ai', reason: 'missing' },
    });
    expect(uiExecutor).toHaveBeenCalledOnce();
    expect(resolveAiExecutor).not.toHaveBeenCalled();
  });

  it('attributes a leading legacy preflight miss to its own step after later resolvable AI steps', async () => {
    const { deps, uiExecutor, recordingStorage, resolveAiExecutor } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('first-ai'), aiStep('second-ai'), aiStep('third-ai')],
      {
        'first-ai': { kind: 'ai', trace: legacyTrace([], [passingText('Cached dashboard')]) },
        'second-ai': { kind: 'ai', trace: coveredTrace([], [passingText('Cached dashboard')]) },
        'third-ai': { kind: 'ai', trace: coveredTrace([], [passingText('Cached dashboard')]) },
      },
    );

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve: false });

    expect(outcome.results[0]?.error).toMatchObject({
      kind: 'grounding-unresolved',
      details: { stepId: 'first-ai', reason: 'recoverable-miss' },
    });
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      steps: [
        { id: 'first-ai', status: 'error', kind: 'environment' },
        { id: 'second-ai', status: 'skipped' },
        { id: 'third-ai', status: 'skipped' },
      ],
    });
    expect(uiExecutor).toHaveBeenCalledOnce();
    expect(resolveAiExecutor).not.toHaveBeenCalled();
  });

  it.each([
    ['no grounding entry', {} as GroundingDocument['entries'], 'missing'],
    ['a legacy cache miss', aiGrounding(legacyTrace([], [passingText('Cached dashboard')])), 'recoverable-miss'],
    ['a post-replay miss', aiGrounding(coveredTrace([], [passingText('Cached dashboard')])), 'recoverable-miss'],
  ] as const)('reports a case-scoped grounding-unresolved error for %s when resolve is false', async (_description, entries, reason) => {
    const session = createFakeBrowserSession(new Map(), {
      assertOutcome: { passed: false, message: 'Cached dashboard is absent.' },
    });
    const { deps, events, recordingStorage, resolveAiExecutor } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    const steps: TestStep[] = [
      { id: 'before-ai', kind: 'action', action: 'navigate', url: '/before' },
      aiStep(),
      { id: 'after-ai', kind: 'action', action: 'navigate', url: '/after' },
    ];
    await seedFreshArtifacts(recordingStorage.storage, testPath, steps, entries);

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve: false });

    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]?.error).toBeInstanceOf(GroundingUnresolvedError);
    expect(outcome.results[0]?.error).toMatchObject({
      kind: 'grounding-unresolved',
      exitCode: ERROR_EXIT_CODES['grounding-unresolved'],
      details: { stepId: 'recorded-ai', reason },
    });
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      steps: [
        { id: 'before-ai', status: 'passed' },
        { id: 'recorded-ai', status: 'error', kind: 'environment' },
        { id: 'after-ai', status: 'skipped' },
      ],
    });
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  it('uses agentic fallback for a grounding miss when resolve is true', async () => {
    const session = createFakeBrowserSession(new Map(), { assertOutcome: { passed: true } });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.evaluateAssert(passingText('Dashboard'), 'dashboard-reached');
        return { outcome: 'success' };
      },
    });
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve: true });

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(resolveAiExecutor).toHaveBeenCalledOnce();
    expect(executor.agenticRequests).toHaveLength(1);
  });

  it.each([
    ['missing', 'No grounding is stored for this locator.'],
    ['fingerprint-mismatch', 'The stored grounding for this locator no longer matches the current page.'],
    ['element-not-found', 'The stored grounding for this locator has no matching element on the current page.'],
    ['ambiguous-match', 'The supplied locator matches more than one element in the current accessibility evidence. Add a distinguishing aria-label (or other accessible-name difference) to one of the matching elements so the locator can identify a single element.'],
    ['snapshot-invalid', 'The current accessibility evidence could not be parsed and cannot be trusted for this locator. Retry the run; if this persists, the page structure may use a form this parser does not recognize.'],
    ['secret-contaminated', 'The supplied locator\'s accessibility evidence contains a resolved secret value and cannot be fingerprinted or cached. Add an aria-label that does not echo the secret value to the affected element.'],
  ] as const)('reports GROUNDING_UNRESOLVED for element grounding %s without resolve', async (missReason, message) => {
    const hasEntry = missReason !== 'missing';
    const entries = hasEntry ? elementGrounding(['click-submit']) : {};
    const closed = vi.fn();
    const live = liveEntries([SUBMIT]);
    if (hasEntry && missReason !== 'secret-contaminated') {
      live.set(elementRefKey(SUBMIT), {
        currentFingerprint: FINGERPRINT,
        exists: true,
        scriptedMissReasons: { verify: missReason },
      });
    }
    const session = createFakeBrowserSession(live, { onClose: closed });
    if (missReason === 'secret-contaminated') {
      vi.spyOn(session, 'resolveGrounded').mockImplementation(async (): Promise<GroundedResolution> => ({ kind: 'miss', reason: missReason }));
    }
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded');
    const { deps, events, recordingStorage, resolveAiExecutor } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    const steps: TestStep[] = [
      { id: 'before-grounding', kind: 'action', action: 'navigate', url: '/before' },
      { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
      { id: 'after-grounding', kind: 'action', action: 'navigate', url: '/after' },
    ];
    await seedFreshArtifacts(recordingStorage.storage, testPath, steps, entries);
    const groundingPath = `${TEST_DIR}/login.ambercast.grounding.json`;
    const groundingBefore = await recordingStorage.storage.readText(groundingPath);

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve: false });

    expect(outcome.results[0]?.error).toBeInstanceOf(GroundingUnresolvedError);
    expect(outcome.results[0]?.error).toMatchObject({
      kind: 'grounding-unresolved',
      exitCode: 4,
      message,
      details: { stepId: 'click-submit', reason: hasEntry ? 'recoverable-miss' : 'missing' },
    });
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      steps: [
        { id: 'before-grounding', status: 'passed' },
        { id: 'click-submit', status: 'error' },
        { id: 'after-grounding', status: 'skipped' },
      ],
      aiCalls: 0,
    });
    expect(reportError(outcome.results[0]!.error as GroundingUnresolvedError, { scope: 'case', caseId: 'login' })).toMatchObject({
      kind: 'usage', code: 'GROUNDING_UNRESOLVED', hint: expect.stringContaining('ambercast run --resolve'),
    });
    expect(await recordingStorage.storage.readText(groundingPath)).toBe(groundingBefore);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
    expect(session.operations().filter((operation) => operation.type === 'perform' && operation.action.type === 'click')).toEqual([]);
    if (hasEntry) {
      expect(resolveGrounded).toHaveBeenCalledWith(SUBMIT, { mode: 'verify', fingerprint: FINGERPRINT });
    } else {
      expect(resolveGrounded).not.toHaveBeenCalled();
    }
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no grounding file', async (storage: StorageAdapter, testPath: string, steps: readonly TestStep[]) => {
      await createFreshPlan(storage, testPath, steps);
    }],
    ['malformed grounding JSON', async (storage: StorageAdapter, testPath: string, steps: readonly TestStep[]) => {
      await seedFreshArtifacts(storage, testPath, steps, elementGrounding(['click-submit']));
      await storage.writeText(`${TEST_DIR}/login.ambercast.grounding.json`, '{ malformed');
    }],
    ['a grounding document with a stale plan digest', async (storage: StorageAdapter, testPath: string, steps: readonly TestStep[]) => {
      await seedFreshArtifacts(storage, testPath, steps, elementGrounding(['click-submit']));
      await storage.writeText(
        `${TEST_DIR}/login.ambercast.grounding.json`,
        toCanonicalArtifactText({
          schemaVersion: 1,
          planDigest: 'f'.repeat(64),
          entries: elementGrounding(['click-submit']),
        } as unknown as JsonValueT),
      );
    }],
  ] as const)('reports GROUNDING_UNRESOLVED for %s in cache-only mode', async (_description, arrangeGrounding) => {
    const closed = vi.fn();
    const session = createFakeBrowserSession(liveEntries([SUBMIT]), { onClose: closed });
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded');
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    const steps: TestStep[] = [
      { id: 'before-grounding', kind: 'action', action: 'navigate', url: '/before' },
      { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
      { id: 'after-grounding', kind: 'action', action: 'navigate', url: '/after' },
    ];
    await arrangeGrounding(recordingStorage.storage, testPath, steps);

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve: false });

    expect(outcome.results[0]?.error).toBeInstanceOf(GroundingUnresolvedError);
    expect(outcome.results[0]?.error).toMatchObject({
      kind: 'grounding-unresolved',
      exitCode: 4,
      message: 'No grounding is stored for this locator.',
      details: { stepId: 'click-submit', reason: 'missing' },
    });
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      steps: [
        { id: 'before-grounding', status: 'passed' },
        { id: 'click-submit', status: 'error', kind: 'environment' },
        { id: 'after-grounding', status: 'skipped' },
      ],
    });
    expect(resolveGrounded).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('uses the unclassified case-abort stopgap for an unclassified browser-session error and closes the session', async () => {
    const closed = vi.fn();
    const session = createFakeBrowserSession(liveEntries([SUBMIT]), {
      onPerform(action) {
        if (action.type === 'click') {
          throw new Error('detached element');
        }
      },
      onClose: closed,
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    const steps: TestStep[] = [
      { id: 'before-browser-error', kind: 'action', action: 'navigate', url: '/before' },
      { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
      { id: 'after-browser-error', kind: 'action', action: 'navigate', url: '/after' },
    ];
    await seedFreshArtifacts(recordingStorage.storage, testPath, steps, elementGrounding(['click-submit']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expectStopgapOutcome(outcome, 'click-submit', 'after-browser-error', 'before-browser-error');
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('emits step-start for a step before its dispatch begins, not only by the time the run resolves', async () => {
    const eventsAtSecondPerform: RunEvent[] = [];
    const session = createFakeBrowserSession(liveEntries([EMAIL, SUBMIT]), {
      onPerform(action) {
        if (action.type === 'click') {
          eventsAtSecondPerform.push(...events.emitted());
          throw new Error('detached element');
        }
      },
    });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    const steps: TestStep[] = [
      { id: 'fill-first', kind: 'action', action: 'fill', target: EMAIL, value: 'person@example.test' },
      { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
      { id: 'after-browser-error', kind: 'action', action: 'navigate', url: '/after' },
    ];
    await seedFreshArtifacts(recordingStorage.storage, testPath, steps, elementGrounding(['fill-first', 'click-submit']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      steps: [
        { id: 'fill-first', status: 'passed' },
        { id: 'click-submit', status: 'error', kind: 'environment' },
        { id: 'after-browser-error', status: 'skipped' },
      ],
    });
    // Sampling events at onPerform entry proves a step-start seen there was
    // emitted before dispatch, rather than deferred until the run settles.
    expect(eventsAtSecondPerform).toEqual([
      { type: 'step-start', stepId: 'fill-first' },
      { type: 'step-result', stepId: 'fill-first', via: 'grounding' },
      { type: 'step-start', stepId: 'click-submit' },
    ]);
    expect(events.emitted()).toEqual([
      ...eventsAtSecondPerform,
      expect.objectContaining({
        type: 'unclassified-rejection', stepId: 'click-submit', name: 'Error', message: 'detached element', stack: expect.any(String),
      }),
    ]);
  });

  it('continues a sibling case after a browser-launch failure', async () => {
    const firstDriver = createFakeUiExecutor(() => createFakeBrowserSession(new Map()));
    vi.spyOn(firstDriver, 'launch').mockRejectedValue(new BrowserLaunchFailedError('first case cannot launch'));
    const secondClosed = vi.fn();
    const secondDriver = createFakeUiExecutor(() => createFakeBrowserSession(new Map(), { onClose: secondClosed }));
    const drivers = [firstDriver, secondDriver];
    const uiExecutor = vi.fn<RunDeps['uiExecutor']>(() => drivers.shift()!);
    const { deps, recordingStorage } = createScenario({
      uiExecutor,
      discoverTestFiles: async () => ['first.test.md', 'second.test.md'],
    });
    const firstPath = await writePrompt(recordingStorage.storage, 'first.test.md');
    const secondPath = await writePrompt(recordingStorage.storage, 'second.test.md');
    await seedFreshArtifacts(recordingStorage.storage, firstPath, [{ id: 'open-first', kind: 'action', action: 'navigate', url: '/first' }]);
    await seedFreshArtifacts(recordingStorage.storage, secondPath, [{ id: 'open-second', kind: 'action', action: 'navigate', url: '/second' }]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results).toHaveLength(2);
    expect(outcome.results.map(({ result }) => result.status)).toEqual(['error', 'passed']);
    expect(outcome.results[0]?.error).toMatchObject({ kind: 'browser-launch-failed' });
    expect(secondClosed).toHaveBeenCalledTimes(1);
  });

  it('continues a sibling case after a generic browser-launch rejection with classified details', async () => {
    const firstDriver = createFakeUiExecutor(() => createFakeBrowserSession(new Map()));
    vi.spyOn(firstDriver, 'launch').mockRejectedValue(new Error('generic launch failure'));
    const secondDriver = createFakeUiExecutor(() => createFakeBrowserSession(new Map()));
    const drivers = [firstDriver, secondDriver];
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn<RunDeps['uiExecutor']>(() => drivers.shift()!),
      discoverTestFiles: async () => ['first.test.md', 'second.test.md'],
    });
    const firstPath = await writePrompt(recordingStorage.storage, 'first.test.md');
    const secondPath = await writePrompt(recordingStorage.storage, 'second.test.md');
    await seedFreshArtifacts(recordingStorage.storage, firstPath, [{ id: 'open-first', kind: 'action', action: 'navigate', url: '/first' }]);
    await seedFreshArtifacts(recordingStorage.storage, secondPath, [{ id: 'open-second', kind: 'action', action: 'navigate', url: '/second' }]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results.map(({ result }) => result.status)).toEqual(['error', 'passed']);
    expect(outcome.results[0]).toMatchObject({
      error: { kind: 'browser-launch-failed', details: { reason: 'launch-failed', engine: 'chromium' } },
    });
  });

  it('stops scheduling later cases after caller cancellation while retaining a completed case', async () => {
    const controller = new AbortController();
    const firstClosed = vi.fn(() => controller.abort(new Error('stop after first case')));
    const sessionFactory = vi.fn<() => BrowserSession>(() => createFakeBrowserSession(new Map(), { onClose: firstClosed }));
    const { deps, recordingStorage, sessionFactory: defaultFactory } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(sessionFactory)),
      discoverTestFiles: async () => ['first.test.md', 'second.test.md'],
      signal: controller.signal,
    });
    const firstPath = await writePrompt(recordingStorage.storage, 'first.test.md');
    const secondPath = await writePrompt(recordingStorage.storage, 'second.test.md');
    await seedFreshArtifacts(recordingStorage.storage, firstPath, [{ id: 'open-first', kind: 'action', action: 'navigate', url: '/first' }]);
    await seedFreshArtifacts(recordingStorage.storage, secondPath, [{ id: 'open-second', kind: 'action', action: 'navigate', url: '/second' }]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]?.result).toMatchObject({ file: firstPath, status: 'passed' });
    expect(firstClosed).toHaveBeenCalledTimes(1);
    expect(sessionFactory).toHaveBeenCalledTimes(1);
    expect(defaultFactory).not.toHaveBeenCalled();
  });

  it('measures one case with the injected monotonic clock', async () => {
    const fixed = createFixedClock(new Date('2026-08-09T00:00:00.000Z'), 100);
    const monotonicMs = vi.fn<() => number>()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(137);
    const clock: Clock = { ...fixed, monotonicMs };
    const { deps, recordingStorage } = createScenario({
      clock,
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => createFakeBrowserSession(new Map()))),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'open-home', kind: 'action', action: 'navigate', url: '/' }]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(monotonicMs).toHaveBeenCalledTimes(2);
    expect(outcome.results[0]?.result.durationMs).toBe(37);
  });

  it('applies grep to discovered POSIX-relative paths before reading an excluded prompt', async () => {
    const { deps, recordingStorage } = createScenario({
      discoverTestFiles: async () => ['matching/login.test.md', 'other/skip.test.md'],
    });
    const matchingPath = await writePrompt(recordingStorage.storage, 'matching/login.test.md');
    await seedFreshArtifacts(recordingStorage.storage, matchingPath, [{ id: 'open-login', kind: 'action', action: 'navigate', url: '/' }]);

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, grep: /^matching\// });

    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]?.result).toMatchObject({ file: matchingPath, status: 'passed' });
    expect(recordingStorage.reads).not.toContain(`${TEST_DIR}/other/skip.test.md`);
  });

  it('applies grep to literal paths in their POSIX-relative form', async () => {
    const { deps, recordingStorage } = createScenario();
    const matchingPath = await writePrompt(recordingStorage.storage, 'matching/login.test.md');
    const excludedPath = await writePrompt(recordingStorage.storage, 'other/skip.test.md');
    await seedFreshArtifacts(recordingStorage.storage, matchingPath, [{ id: 'open-login', kind: 'action', action: 'navigate', url: '/' }]);

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, files: [matchingPath, excludedPath], grep: /^matching\// });

    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]?.result).toMatchObject({ file: matchingPath, status: 'passed' });
    expect(recordingStorage.reads).not.toContain(excludedPath);
  });

  it('reports no tests found when discovery resolves no prompt files', async () => {
    const { deps } = createScenario({ discoverTestFiles: async () => [] });

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.noTestsFound).toBe(true);
    expect(outcome.results).toEqual([]);
  });

  it.each([
    [false, false, true, 5, 'zero-match replay'],
    [false, true, true, 0, 'zero-match listing'],
    [true, false, true, 0, 'allowed zero-match replay'],
    [true, true, true, 0, 'allowed zero-match listing'],
    [false, false, false, 0, 'matched replay'],
    [false, true, false, 0, 'matched listing'],
    [true, false, false, 0, 'matched allowed replay'],
    [true, true, false, 0, 'matched allowed listing'],
  ] as const)(
    'applies allow-empty/list policy for %s/%s with noTestsFound=%s (%s)',
    async (allowEmpty, list, noTestsFound, exitCode, _description) => {
      const { deps, recordingStorage } = createScenario({ discoverTestFiles: async () => (
        noTestsFound ? [] : ['login.test.md']
      ) });
      let testPath: string | undefined;
      if (!noTestsFound) {
        testPath = await writePrompt(recordingStorage.storage);
        await createFreshPlan(recordingStorage.storage, testPath, [
          { id: 'open-home', kind: 'action', action: 'navigate', url: '/' },
        ]);
      }

      const outcome = await run(deps, { ...DEFAULT_OPTIONS, allowEmpty, list });
      const report = buildRunReport({
        startedAt: '2026-08-09T00:00:00Z',
        durationMs: 0,
        options: { allowEmpty, list },
        outcome,
      });

      expect(report.exitCode).toBe(exitCode);
      if (noTestsFound) {
        expect(outcome).toEqual({ results: [], noTestsFound: true, listed: [], skipped: [], interrupted: false });
        return;
      }
      if (list) {
        expect(outcome).toEqual({
          results: [],
          noTestsFound: false,
          listed: [{ file: testPath }],
          skipped: [],
          interrupted: false,
        });
        return;
      }
      expect(outcome).toMatchObject({
        noTestsFound: false,
        listed: [],
        results: [{ result: { file: testPath, status: 'passed' } }],
      });
    },
  );

  it('lists matched paths without resolving AI, launching a browser, emitting events, or reading artifacts', async () => {
    const discoverTestFiles = vi.fn(async () => ['login.test.md']);
    const { deps, uiExecutor, events, recordingStorage, resolveAiExecutor } = createScenario({ discoverTestFiles });

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, list: true });

    expect(outcome).toEqual({
      results: [],
      noTestsFound: false,
      listed: [{ file: `${TEST_DIR}/login.test.md` }],
      skipped: [],
      interrupted: false,
    });
    expect(discoverTestFiles).toHaveBeenCalledTimes(1);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(uiExecutor).not.toHaveBeenCalled();
    expect(events.emitted()).toEqual([]);
    expect(recordingStorage.reads).toEqual([]);
    expect(recordingStorage.exists).toEqual([]);
    expect(recordingStorage.writes).toEqual([]);
  });

  it('lists a first-seen, grep-filtered deterministic selection from duplicated literal paths', async () => {
    const { deps, recordingStorage } = createScenario();
    const alpha = `${TEST_DIR}/suite/alpha.test.md`;
    const beta = `${TEST_DIR}/other/beta.test.md`;
    const gamma = `${TEST_DIR}/suite/gamma.test.md`;

    const outcome = await run(deps, {
      ...DEFAULT_OPTIONS,
      files: [gamma, beta, alpha, gamma, beta, alpha],
      grep: /^suite\//,
      list: true,
    });

    expect(outcome).toEqual({
      results: [],
      noTestsFound: false,
      listed: [{ file: gamma }, { file: alpha }],
      skipped: [],
      interrupted: false,
    });
    expect(recordingStorage.reads).toEqual([]);
    expect(recordingStorage.exists).toEqual([]);
  });

  it.each([
    ['outside the test directory', '/workspace/outside.test.md', 'outside-test-dir'],
    ['inside the test directory without the test suffix', `${TEST_DIR}/login.md`, 'not-test-md'],
    ['anonymous inside the test directory', `${TEST_DIR}/.test.md`, 'no-name'],
  ] as const)('rejects a literal prompt path %s before replay work begins', async (_description, path, reason) => {
    const { deps } = createScenario();

    await expect(run(deps, { ...DEFAULT_OPTIONS, files: [path] })).rejects.toMatchObject({
      kind: 'prompt-path-invalid',
      exitCode: 2,
      details: { path, reason },
    } satisfies Partial<PromptPathInvalidError>);
  });

  it('processes a boundary-valid direct child of testDir without a prompt-path error', async () => {
    const { deps, recordingStorage } = createScenario();
    const path = await writePrompt(recordingStorage.storage, 'x.test.md');
    await seedFreshArtifacts(recordingStorage.storage, path, [
      { id: 'open-home', kind: 'action', action: 'navigate', url: '/' },
    ]);

    await expect(run(deps, { ...DEFAULT_OPTIONS, files: [path] })).resolves.toMatchObject({
      results: [{ result: { file: path, status: 'passed' } }],
      noTestsFound: false,
    });
  });

  it('keeps list mode lenient for an ineligible literal prompt path', async () => {
    const { deps } = createScenario();
    const path = '/workspace/outside.test.md';

    await expect(run(deps, { ...DEFAULT_OPTIONS, files: [path], list: true })).resolves.toEqual({
      results: [],
      noTestsFound: false,
      listed: [{ file: path }],
      skipped: [],
      interrupted: false,
    });
  });

  it('preflights the whole selection before reading an eligible first prompt or resolving AI', async () => {
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => createFakeAiExecutor());
    const { deps, recordingStorage } = createScenario({ resolveAiExecutor });
    const eligiblePath = await writePrompt(recordingStorage.storage, 'eligible.test.md');
    await seedFreshArtifacts(recordingStorage.storage, eligiblePath, []);
    const ineligiblePath = `${TEST_DIR}/ineligible.md`;
    recordingStorage.reads.splice(0);
    recordingStorage.exists.splice(0);
    recordingStorage.writes.splice(0);

    await expect(run(deps, {
      ...DEFAULT_OPTIONS,
      files: [eligiblePath, ineligiblePath],
    })).rejects.toMatchObject({
      kind: 'prompt-path-invalid',
      details: { path: ineligiblePath, reason: 'not-test-md' },
    } satisfies Partial<PromptPathInvalidError>);
    expect(recordingStorage.reads).toEqual([]);
    expect(recordingStorage.writes).toEqual([]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
  });

  it('rejects an ineligible path before observing an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled before selection'));
    const { deps } = createScenario({ signal: controller.signal });
    const path = `${TEST_DIR}/ineligible.md`;

    await expect(run(deps, { ...DEFAULT_OPTIONS, files: [path] })).rejects.toMatchObject({
      kind: 'prompt-path-invalid',
      details: { path, reason: 'not-test-md' },
    } satisfies Partial<PromptPathInvalidError>);
  });

  it('reports the first ineligible file reason in document order', async () => {
    const { deps } = createScenario();
    const firstPath = `${TEST_DIR}/.test.md`;
    const secondPath = '/workspace/outside.test.md';

    await expect(run(deps, { ...DEFAULT_OPTIONS, files: [firstPath, secondPath] })).rejects.toMatchObject({
      kind: 'prompt-path-invalid',
      details: { path: firstPath, reason: 'no-name' },
    } satisfies Partial<PromptPathInvalidError>);
  });

  it('filters an ineligible path out with grep before eligibility validation', async () => {
    const { deps, recordingStorage } = createScenario();
    const eligiblePath = await writePrompt(recordingStorage.storage, 'matching/login.test.md');
    await seedFreshArtifacts(recordingStorage.storage, eligiblePath, [
      { id: 'open-home', kind: 'action', action: 'navigate', url: '/' },
    ]);
    const excludedIneligiblePath = `${TEST_DIR}/other/skip.md`;

    await expect(run(deps, {
      ...DEFAULT_OPTIONS,
      files: [eligiblePath, excludedIneligiblePath],
      grep: /^matching\//,
    })).resolves.toMatchObject({
      results: [{ result: { file: eligiblePath, status: 'passed' } }],
      noTestsFound: false,
    });
  });

  it('deduplicates an ineligible literal path before the one batch-level eligibility error', async () => {
    const { deps } = createScenario();
    const path = `${TEST_DIR}/duplicated.md`;
    const promptPathIneligibility = vi.spyOn(deps.layout, 'promptPathIneligibility');

    await expect(run(deps, { ...DEFAULT_OPTIONS, files: [path, path] })).rejects.toMatchObject({
      kind: 'prompt-path-invalid',
      exitCode: 2,
      details: { path, reason: 'not-test-md' },
    } satisfies Partial<PromptPathInvalidError>);
    expect(promptPathIneligibility).toHaveBeenCalledTimes(1);
  });

  it('keeps a grep-filtered empty list on the ordinary zero-match path', async () => {
    const { deps, recordingStorage } = createScenario({
      discoverTestFiles: async () => ['suite/alpha.test.md', 'suite/beta.test.md'],
    });

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, grep: /^other\//, list: true });

    expect(outcome).toEqual({ results: [], noTestsFound: true, listed: [], skipped: [], interrupted: false });
    expect(recordingStorage.reads).toEqual([]);
    expect(recordingStorage.exists).toEqual([]);
  });
});

describe('run interruption contract', () => {
  it('turns a pre-aborted execution batch into ordered pending identities without launching browser work', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, uiExecutor, recordingStorage } = createScenario({ signal: controller.signal });

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, files: [`${TEST_DIR}/first.test.md`, `${TEST_DIR}/second.test.md`] });

    expect(outcome.interrupted).toBe(true);
    expect(outcome.skipped).toEqual([
      { file: `${TEST_DIR}/first.test.md` }, { file: `${TEST_DIR}/second.test.md` },
    ]);
    expect(uiExecutor).not.toHaveBeenCalled();
    expect(recordingStorage.reads).toEqual([]);
  });

  it('keeps list mode atomic for an already aborted signal and exposes empty skipped work', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps } = createScenario({ signal: controller.signal });

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, files: [`${TEST_DIR}/a.test.md`, `${TEST_DIR}/b.test.md`], list: true });

    expect(outcome.interrupted).toBe(false);
    expect(outcome.skipped).toEqual([]);
    expect(outcome.listed).toEqual([{ file: `${TEST_DIR}/a.test.md` }, { file: `${TEST_DIR}/b.test.md` }]);
  });

  it('retains an in-flight terminal result and skips only the remaining suffix without later browser or storage work', async () => {
    const controller = new AbortController();
    let releaseLaunch: ((session: BrowserSession) => void) | undefined;
    let started: (() => void) | undefined;
    const firstLaunchStarted = new Promise<void>((resolve) => { started = resolve; });
    const uiExecutor = vi.fn<RunDeps['uiExecutor']>(() => ({
      ...createFakeUiExecutor(() => createFakeBrowserSession(new Map())),
      launch: () => new Promise<BrowserSession>((resolve) => { releaseLaunch = resolve; started?.(); }),
    }));
    const { deps, recordingStorage } = createScenario({ signal: controller.signal, uiExecutor });
    const first = await writePrompt(recordingStorage.storage, 'first.test.md');
    const second = await writePrompt(recordingStorage.storage, 'second.test.md');
    // SPEC-14: a Target session launches only when its first step is reached.
    const steps: TestStep[] = [{ id: 'open-dashboard', kind: 'action', action: 'navigate', url: '/dashboard' }];
    await seedFreshArtifacts(recordingStorage.storage, first, steps);
    await seedFreshArtifacts(recordingStorage.storage, second, steps);
    recordingStorage.reads.splice(0);

    const running = run(deps, { ...DEFAULT_OPTIONS, files: [first, second] });
    await firstLaunchStarted;
    controller.abort();
    releaseLaunch?.(createFakeBrowserSession(new Map()));

    await expect(running).resolves.toMatchObject({
      interrupted: true,
      results: [expect.objectContaining({ result: expect.objectContaining({ id: first, status: 'error' }) })],
      skipped: [{ file: second }],
    });
    expect(uiExecutor).toHaveBeenCalledOnce();
    expect(recordingStorage.reads).not.toContain(second);
  });

  it.each(['normal return', 'discovery rejection'] as const)('disposes the interruption tracker from run finally after %s', async (mode) => {
    const dispose = vi.spyOn(BatchInterruptionTracker.prototype, 'dispose');
    const controller = new AbortController();
    const { deps } = createScenario({
      signal: controller.signal,
      discoverTestFiles: mode === 'normal return'
        ? vi.fn(async () => [])
        : vi.fn(async () => { throw new Error('discovery failed'); }),
    });

    if (mode === 'normal return') {
      await expect(run(deps, DEFAULT_OPTIONS)).resolves.toBeDefined();
    } else {
      await expect(run(deps, DEFAULT_OPTIONS)).rejects.toThrow('discovery failed');
    }
    expect(dispose).toHaveBeenCalledOnce();
    dispose.mockRestore();
  });
});

describe('run AI lifecycle accounting', () => {
  it('does not emit or count executeAgentic when request construction fails after deadline composition', async () => {
    const executor = createFakeAiExecutor();
    const { deps, events, recordingStorage } = createScenario({ resolveAiExecutor: async () => executor });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    requestConstructionFailure.enabled = true;
    try {
      const outcome = await run(deps, DEFAULT_OPTIONS);

      expect(outcome.results[0]?.result).toMatchObject({ status: 'error', aiCalls: 0 });
      expect(events.emitted().filter(({ type }) => type === 'ai-call' || type === 'ai-result')).toEqual([]);
      expect(executor.agenticRequests).toHaveLength(0);
    } finally {
      requestConstructionFailure.enabled = false;
    }
  });

  it('does not emit or count element reconfirmation when request construction fails after deadline composition', async () => {
    const executor = createFakeAiExecutor();
    const session = createFakeBrowserSession(
      liveEntries([SUBMIT], DIFFERENT_FINGERPRINT),
      { snapshot: pathBSnapshot() },
    );
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }],
      elementGrounding(['click-submit']),
    );

    requestConstructionFailure.enabled = true;
    try {
      const outcome = await run(deps, DEFAULT_OPTIONS);

      expect(outcome.results[0]?.result).toMatchObject({ status: 'error', aiCalls: 0 });
      expect(events.emitted().filter(({ type }) => type === 'ai-call' || type === 'ai-result')).toEqual([]);
      expect(executor.structuredRequests).toHaveLength(0);
    } finally {
      requestConstructionFailure.enabled = false;
    }
  });

  it('emits one complete 1/1 lifecycle pair for executeAgentic and reports the admitted dispatch', async () => {
    const fixed = createFixedClock(new Date('2026-08-09T00:00:00.000Z'), 0);
    const monotonicMs = vi.fn<() => number>()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(200.4)
      .mockReturnValueOnce(208)
      .mockReturnValueOnce(250);
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await evaluateTerminalAssert(request, passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, events, recordingStorage } = createScenario({
      clock: { ...fixed, monotonicMs },
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result).toMatchObject({
      status: 'passed',
      durationMs: 150,
      aiCalls: 1,
    });
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'recorded-ai', testPath)]);
    expect(aiResults(events)).toEqual([{
      type: 'ai-result',
      callId: 'ai-1',
      durationMs: 8,
      outcome: 'ok',
    }]);
    expect(events.emitted().filter(({ type }) => type === 'ai-call' || type === 'ai-result')).toEqual([
      expectedAiCall('ai-1', 'recorded-ai', testPath),
      { type: 'ai-result', callId: 'ai-1', durationMs: 8, outcome: 'ok' },
    ]);
    expect(monotonicMs).toHaveBeenCalledTimes(4);
  });

  it('emits an error result for execute rejection, clamps a negative delta, and still counts the dispatch', async () => {
    const fixed = createFixedClock(new Date('2026-08-09T00:00:00.000Z'), 0);
    const monotonicMs = vi.fn<() => number>()
      .mockReturnValueOnce(500)
      .mockReturnValueOnce(50.7)
      .mockReturnValueOnce(49.2)
      .mockReturnValueOnce(600);
    const executor = createFakeAiExecutor({
      execute: () => {
        throw new Error('confirmation provider rejected');
      },
    });
    const session = createFakeBrowserSession(
      liveEntries([SUBMIT], DIFFERENT_FINGERPRINT),
      { snapshot: pathBSnapshot() },
    );
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      clock: { ...fixed, monotonicMs },
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }],
      elementGrounding(['click-submit']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      durationMs: 100,
      aiCalls: 1,
    });
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'click-submit', testPath)]);
    expect(aiResults(events)).toEqual([{
      type: 'ai-result',
      callId: 'ai-1',
      durationMs: 0,
      outcome: 'error',
    }]);
    expect(executor.structuredRequests).toHaveLength(1);
    expect(monotonicMs).toHaveBeenCalledTimes(4);
  });
});

describe('run agentic fallback pipeline', () => {
  it('records one cold-start AI call, persists its unresolved trace, then replays it without an AI call or write', async () => {
    const firstSession = createFakeBrowserSession(new Map());
    const secondSession = createFakeBrowserSession(new Map());
    const sessions = [firstSession, secondSession];
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'navigate', url: '/dashboard' });
        await request.controller.evaluateAssert(passingText('Dashboard'), 'dashboard-reached');
        return { outcome: 'success' };
      },
    });
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => sessions.shift()!)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);
    recordingStorage.writes.length = 0;

    const coldStart = await run(deps, DEFAULT_OPTIONS);

    const expectedTrace = coveredTrace(
      [{ type: 'navigate', url: '/dashboard' }],
      [passingText('Dashboard')],
    );
    expect(coldStart.results[0]?.result).toMatchObject({ status: 'passed' });
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'recorded-ai')]);
    expect(resolveAiExecutor).toHaveBeenCalledTimes(1);
    expect(executor.agenticRequests).toHaveLength(1);
    expect(executor.agenticRequests[0]).toMatchObject({
      allowedSecretRefs: [],
      allowedRunRefs: [],
    });
    expect(executor.agenticRequests[0]).not.toHaveProperty('priorTrace');
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual({
      'recorded-ai': { kind: 'ai', trace: expectedTrace },
    });
    expect(events.emitted().filter((event) => event.type === 'step-result')).toEqual([
      { type: 'step-result', stepId: 'recorded-ai', via: 'ai-resolve' },
    ]);

    const callsBeforeReplay = aiCalls(events).length;
    const writesBeforeReplay = recordingStorage.writes.length;
    const groundingBeforeReplay = await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`);
    const replay = await run(deps, DEFAULT_OPTIONS);

    expect(replay.results[0]?.result).toMatchObject({ status: 'passed' });
    expect(aiCalls(events).slice(callsBeforeReplay)).toEqual([]);
    expect(executor.agenticRequests).toHaveLength(1);
    expect(resolveAiExecutor).toHaveBeenCalledTimes(1);
    expect(recordingStorage.writes.slice(writesBeforeReplay)).toEqual([]);
    expect(await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`)).toBe(groundingBeforeReplay);
    expect(secondSession.operations()).toEqual([
      { type: 'perform', action: { type: 'navigate', url: '/dashboard' } },
      { type: 'evaluate-assert', check: { check: 'text-visible', text: 'Dashboard' } },
    ]);
    expect(events.emitted().filter((event) => event.type === 'step-result').at(-1)).toEqual({
      type: 'step-result',
      stepId: 'recorded-ai',
      via: 'trace-replay',
    });
  });

  it('replays TraceFill run references with each run\'s freshly captured value without mutating grounding', async () => {
    const firstSession = createFakeBrowserSession(liveEntries([EMAIL]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: 'TOKEN-A', value: 'unused' }]]),
    });
    const secondSession = createFakeBrowserSession(liveEntries([EMAIL]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: 'TOKEN-B', value: 'unused' }]]),
    });
    const sessions = [firstSession, secondSession];
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => sessions.shift()!)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
        aiStep(),
      ],
      {
        ...elementGrounding(['capture-token']),
        ...aiGrounding(coveredTrace(
          [{ type: 'fill', element: EMAIL, value: 'token: {{run.token}}' }],
          [passingText('Dashboard')],
        )),
      },
    );

    const firstRun = await run(deps, DEFAULT_OPTIONS);
    const writesBeforeSecondRun = recordingStorage.writes.length;
    const groundingBeforeSecondRun = await recordingStorage.storage.readText(
      `${TEST_DIR}/login.ambercast.grounding.json`,
    );
    const secondRun = await run(deps, DEFAULT_OPTIONS);

    expect(firstRun.results[0]?.result.status).toBe('passed');
    expect(secondRun.results[0]?.result.status).toBe('passed');
    expect(firstSession.operations()).toContainEqual({
      type: 'perform',
      action: { type: 'fill', target: boundTarget(EMAIL, FINGERPRINT), value: 'token: TOKEN-A' },
    });
    expect(secondSession.operations()).toContainEqual({
      type: 'perform',
      action: { type: 'fill', target: boundTarget(EMAIL, FINGERPRINT), value: 'token: TOKEN-B' },
    });
    expect(recordingStorage.writes.slice(writesBeforeSecondRun)).toEqual([]);
    expect(await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`)).toBe(
      groundingBeforeSecondRun,
    );
  });

  it('issue 167 aborts a rejected replayed fill-secret without AI retry or persisted diagnostics', async () => {
    const secretRef = '{{secrets.ISSUE_167_REPLAY_ABORT}}';
    const secretValue = 'ISSUE_167_REPLAY_ABORT_VALUE';
    const browserDiagnostic = 'ISSUE_167_BROWSER_DIAGNOSTIC_SENTINEL';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      onFillSecret() {
        throw new Error(browserDiagnostic);
      },
    });
    const executeAgentic = vi.fn(async (request: AiAgenticRequest) => {
      await request.controller.evaluateAssert(passingText('Fallback must not run'));
      return { outcome: 'success' as const };
    });
    const executor = createFakeAiExecutor({ executeAgentic });
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
      aiGrounding(coveredTrace(
        [
          { type: 'fill-secret', element: PASSWORD, secretRef },
          { type: 'navigate', url: '/must-not-run' },
        ],
        [passingText('Cached dashboard')],
      )),
    );
    const planPath = `${TEST_DIR}/login.ambercast.plan.json`;
    const groundingPath = `${TEST_DIR}/login.ambercast.grounding.json`;
    const planBefore = await recordingStorage.storage.readText(planPath);
    const groundingBefore = await recordingStorage.storage.readText(groundingPath);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const report = buildRunReport({
      startedAt: '2026-08-20T00:00:00Z',
      durationMs: 0,
      options: { allowEmpty: false, list: false },
      outcome,
    });
    const planAfter = await recordingStorage.storage.readText(planPath);
    const groundingAfter = await recordingStorage.storage.readText(groundingPath);

    expect(outcome.results[0]?.error).toBeUndefined();
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      explanation: 'The replayed secret fill did not complete.',
      steps: [{ id: 'recorded-ai', status: 'error', kind: 'environment' }],
    });
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(executeAgentic).not.toHaveBeenCalled();
    expect(executor.agenticRequests).toEqual([]);
    expect(aiCalls(events)).toEqual([]);
    expect(events.emitted()).toEqual([{ type: 'step-start', stepId: 'recorded-ai' }]);
    expect(session.operations().filter((operation) => operation.type === 'fill-secret')).toEqual([
      {
        type: 'fill-secret',
        target: boundTarget(PASSWORD, FINGERPRINT),
        value: secretValue,
        policy: baseUrlSecretPolicy(secretRef, TARGETS.web),
      },
    ]);
    expect(session.operations().filter((operation) => (
      operation.type === 'perform' && operation.action.type === 'navigate'
    ))).toEqual([]);
    expect(recordingStorage.writes).toEqual([]);
    expect(planAfter).toBe(planBefore);
    expect(groundingAfter).toBe(groundingBefore);

    const retainedSurfaces = JSON.stringify({
      result: outcome.results[0]?.result,
      error: outcome.results[0]?.error,
      events: events.emitted(),
      report,
      persisted: { plan: planAfter, grounding: groundingAfter, writes: recordingStorage.writes },
    });
    expect(retainedSurfaces).not.toContain(secretValue);
    expect(retainedSurfaces).not.toContain(browserDiagnostic);
  });

  it('issue 167 preserves a classified replayed fill-secret rejection without AI fallback', async () => {
    const secretRef = '{{secrets.ISSUE_167_CLASSIFIED}}';
    const secretValue = 'ISSUE_167_CLASSIFIED_VALUE';
    const message = 'The current page origin is not allowed to receive this secret.';
    const details = {
      secretRef,
      allowedOrigins: ['https://example.test'],
      source: 'target-base-url' as const,
    };
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      onFillSecret() {
        throw new IntegrityViolationError(message, details);
      },
    });
    const executeAgentic = vi.fn(async () => ({ outcome: 'success' as const }));
    const executor = createFakeAiExecutor({ executeAgentic });
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
      aiGrounding(coveredTrace(
        [{ type: 'fill-secret', element: PASSWORD, secretRef }],
        [passingText('Cached dashboard')],
      )),
    );
    const groundingBefore = await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const report = buildRunReport({
      startedAt: '2026-08-20T00:00:00Z',
      durationMs: 0,
      options: { allowEmpty: false, list: false },
      outcome,
    });
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error).toMatchObject({
      kind: 'integrity-violation',
      exitCode: 4,
      message,
      details,
    });
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      explanation: message,
      steps: [{ id: 'recorded-ai', status: 'error', kind: 'environment' }],
    });
    expect(report.envelope.errors).toEqual([
      expect.objectContaining({ kind: 'usage', code: 'INTEGRITY_VIOLATION', message }),
    ]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(executeAgentic).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
    expect(recordingStorage.writes).toEqual([]);
    expect(await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`)).toBe(groundingBefore);
    expect(JSON.stringify({ outcome, report, events: events.emitted() })).not.toContain(secretValue);
  });

  it('issue 167 preserves the exact post-materialization SecretUnresolvedError without AI fallback', async () => {
    const secretRef = '{{secrets.ISSUE_167_POST_MATERIALIZATION_UNRESOLVED}}';
    const secretValue = 'ISSUE_167_POST_MATERIALIZATION_UNRESOLVED_VALUE';
    const message = 'The referenced secret became unavailable at browser invocation.';
    const details = { secretRef };
    const classifiedError = new SecretUnresolvedError(message, details);
    let errorAtCaseRedactionBoundary: unknown;
    let constructorReads = 0;
    Object.defineProperty(classifiedError, 'constructor', {
      configurable: true,
      get() {
        constructorReads += 1;
        errorAtCaseRedactionBoundary = classifiedError;
        return SecretUnresolvedError;
      },
    });
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      onFillSecret() {
        throw classifiedError;
      },
    });
    const executeAgentic = vi.fn(async () => ({ outcome: 'success' as const }));
    const executor = createFakeAiExecutor({ executeAgentic });
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
      aiGrounding(coveredTrace(
        [
          { type: 'fill-secret', element: PASSWORD, secretRef },
          { type: 'navigate', url: '/must-not-run-after-classified-error' },
        ],
        [passingText('Cached dashboard')],
      )),
    );
    const planPath = `${TEST_DIR}/login.ambercast.plan.json`;
    const groundingPath = `${TEST_DIR}/login.ambercast.grounding.json`;
    const planBefore = await recordingStorage.storage.readText(planPath);
    const groundingBefore = await recordingStorage.storage.readText(groundingPath);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const report = buildRunReport({
      startedAt: '2026-08-20T00:00:00Z',
      durationMs: 0,
      options: { allowEmpty: false, list: false },
      outcome,
    });
    const planAfter = await recordingStorage.storage.readText(planPath);
    const groundingAfter = await recordingStorage.storage.readText(groundingPath);
    const error = outcome.results[0]?.error;

    // Replay preserves identity up to the mandatory case-output redaction, which
    // then reconstructs classified errors so retained diagnostics cannot leak.
    expect(errorAtCaseRedactionBoundary).toBe(classifiedError);
    expect(constructorReads).toBeGreaterThan(0);
    expect(error).not.toBe(classifiedError);
    expect(error).toBeInstanceOf(SecretUnresolvedError);
    expect(error).toMatchObject({
      kind: 'secret-unresolved',
      exitCode: 2,
      message,
      details,
    });
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      explanation: message,
      steps: [{ id: 'recorded-ai', status: 'error', kind: 'environment' }],
    });
    expect(report.exitCode).toBe(2);
    expect(report.envelope.errors).toEqual([
      expect.objectContaining({ kind: 'usage', code: 'SECRET_UNRESOLVED', message }),
    ]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(executeAgentic).not.toHaveBeenCalled();
    expect(executor.agenticRequests).toEqual([]);
    expect(aiCalls(events)).toEqual([]);
    expect(events.emitted()).toEqual([{ type: 'step-start', stepId: 'recorded-ai' }]);
    expect(session.operations().filter((operation) => operation.type === 'fill-secret')).toEqual([
      {
        type: 'fill-secret',
        target: boundTarget(PASSWORD, FINGERPRINT),
        value: secretValue,
        policy: baseUrlSecretPolicy(secretRef, TARGETS.web),
      },
    ]);
    expect(session.operations().filter((operation) => (
      operation.type === 'perform' && operation.action.type === 'navigate'
    ))).toEqual([]);
    expect(recordingStorage.writes).toEqual([]);
    expect(planAfter).toBe(planBefore);
    expect(groundingAfter).toBe(groundingBefore);

    const retainedSurfaces = JSON.stringify({
      outcome,
      report,
      events: events.emitted(),
      persisted: { plan: planAfter, grounding: groundingAfter, writes: recordingStorage.writes },
    });
    expect(retainedSurfaces).not.toContain(secretValue);
  });

  it('issue 167 keeps fallback for an ordinary trace rejection after a successful fill-secret', async () => {
    const secretRef = '{{secrets.ISSUE_167_LATER_FALLBACK}}';
    const secretValue = 'ISSUE_167_LATER_FALLBACK_VALUE';
    const priorTrace = coveredTrace(
      [
        { type: 'fill-secret', element: PASSWORD, secretRef },
        { type: 'navigate', url: '/cached-route' },
      ],
      [passingText('Cached dashboard')],
    );
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      onPerform(action) {
        if (action.type === 'navigate' && action.url === '/cached-route') {
          throw new Error('The ordinary cached navigation failed.');
        }
      },
    });
    const executeAgentic = vi.fn(async (request: InstructionCoveredAiAgenticRequest) => {
      await request.controller.evaluateAssert(passingText('Recovered dashboard'), 'dashboard-reached');
      return { outcome: 'success' as const };
    });
    const executor = createFakeAiExecutor({ executeAgentic });
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
      aiGrounding(priorTrace),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result).toMatchObject({ status: 'passed', aiCalls: 1 });
    expect(resolveAiExecutor).toHaveBeenCalledTimes(1);
    expect(executeAgentic).toHaveBeenCalledTimes(1);
    expect(executor.agenticRequests).toHaveLength(1);
    expect(executor.agenticRequests[0]).not.toHaveProperty('priorTrace');
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'recorded-ai')]);
    expect(session.operations().filter((operation) => operation.type === 'fill-secret')).toHaveLength(1);
    expect(session.operations()).toContainEqual({
      type: 'perform',
      action: { type: 'navigate', url: '/cached-route' },
    });
    expect(session.operations().filter((operation) => operation.type === 'evaluate-assert')).toEqual([
      {
        type: 'evaluate-assert',
        check: { check: 'text-visible', text: 'Recovered dashboard' },
      },
    ]);
  });

  it('issue 167 keeps fallback for a fill-secret target miss before browser invocation', async () => {
    const secretRef = '{{secrets.ISSUE_167_BIND_MISS}}';
    const secretValue = 'ISSUE_167_BIND_MISS_VALUE';
    const priorTrace = coveredTrace(
      [{ type: 'fill-secret', element: PASSWORD, secretRef }],
      [passingText('Cached dashboard')],
    );
    const session = createFakeBrowserSession(new Map());
    const fillSecret = vi.spyOn(session, 'fillSecret');
    const executeAgentic = vi.fn(async (request: InstructionCoveredAiAgenticRequest) => {
      await request.controller.evaluateAssert(passingText('Recovered after bind miss'), 'dashboard-reached');
      return { outcome: 'success' as const };
    });
    const executor = createFakeAiExecutor({ executeAgentic });
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
      aiGrounding(priorTrace),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(fillSecret).not.toHaveBeenCalled();
    expect(resolveAiExecutor).toHaveBeenCalledTimes(1);
    expect(executeAgentic).toHaveBeenCalledTimes(1);
    expect(executor.agenticRequests[0]).not.toHaveProperty('priorTrace');
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'recorded-ai')]);
    expect(session.operations()).toContainEqual({
      type: 'resolve-grounded',
      target: PASSWORD,
      query: expect.objectContaining({ mode: 'compute' }),
    });
    expect(session.operations().filter((operation) => operation.type === 'fill-secret')).toEqual([]);
  });

  it('issue 167 leaves a fresh-agentic fill-secret rejection at the controller boundary', async () => {
    const secretRef = '{{secrets.ISSUE_167_FRESH_AGENTIC}}';
    const secretValue = 'ISSUE_167_FRESH_AGENTIC_VALUE';
    const browserMessage = `Fresh agentic browser rejected ${secretValue}.`;
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      onFillSecret() {
        throw new Error(browserMessage);
      },
    });
    let controllerRejection: unknown;
    const executeAgentic = vi.fn(async (request: AiAgenticRequest) => {
      try {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
      } catch (error) {
        controllerRejection = error;
        return { outcome: 'failure' as const };
      }
      throw new Error('The fresh-agentic browser rejection was not delivered to the executor.');
    });
    const executor = createFakeAiExecutor({ executeAgentic });
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
    );
    const groundingBefore = await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(controllerRejection).toBeInstanceOf(Error);
    expect((controllerRejection as Error).message).toBe(`Fresh agentic browser rejected ${secretRef}.`);
    expect(outcome.results[0]?.error).toBeUndefined();
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      explanation: 'The AI-directed interaction did not complete successfully.',
      steps: [{ id: 'recorded-ai', status: 'error', kind: 'environment' }],
    });
    expect(resolveAiExecutor).toHaveBeenCalledTimes(1);
    expect(executeAgentic).toHaveBeenCalledTimes(1);
    expect(executor.agenticRequests).toHaveLength(1);
    expect(executor.agenticRequests[0]).not.toHaveProperty('priorTrace');
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'recorded-ai')]);
    expect(recordingStorage.writes).toEqual([]);
    expect(await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`)).toBe(groundingBefore);
    expect(JSON.stringify({ outcome, events: events.emitted() })).not.toContain(secretValue);
    expect(JSON.stringify({ outcome, events: events.emitted() })).not.toContain(browserMessage);
  });

  it('rejects a cross-origin fresh agentic navigate before it reaches the browser', async () => {
    const session = createFakeBrowserSession(new Map());
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'navigate', url: 'https://evil.test/phish' });
        await request.controller.evaluateAssert(passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(session.operations()).toEqual([]);
  });

  it('uses exactly one agentic fallback for a covered behavioral trace miss without provider recovery context', async () => {
    const priorTrace = coveredTrace(
      [{ type: 'navigate', url: '/cached-route' }],
      [passingText('Cached dashboard')],
    );
    const session = createFakeBrowserSession(liveEntries([SUBMIT]), { assertOutcomes: [
      { passed: false, message: 'The cached dashboard is absent.' },
      { passed: true, message: 'The refreshed dashboard is visible.' },
    ] });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'press', element: SUBMIT, key: 'Enter' });
        await request.controller.evaluateAssert(passingText('Refreshed dashboard'), 'dashboard-reached');
        return { outcome: 'success' };
      },
    });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()], aiGrounding(priorTrace));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result).toMatchObject({ status: 'passed' });
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'recorded-ai')]);
    expect(executor.agenticRequests).toHaveLength(1);
    expect(executor.agenticRequests[0]).not.toHaveProperty('priorTrace');
    expect(session.operations()).toEqual([
      { type: 'perform', action: { type: 'navigate', url: '/cached-route' } },
      { type: 'evaluate-assert', check: { check: 'text-visible', text: 'Cached dashboard' } },
      expect.objectContaining({
        type: 'resolve-grounded',
        target: SUBMIT,
        query: expect.objectContaining({ mode: 'compute' }),
      }),
      { type: 'perform', action: { type: 'press', target: boundTarget(SUBMIT, FINGERPRINT), key: 'Enter' } },
      { type: 'evaluate-assert', check: { check: 'text-visible', text: 'Refreshed dashboard' } },
    ]);
    expect(events.emitted().filter((event) => event.type === 'step-result')).toEqual([
      { type: 'step-result', stepId: 'recorded-ai', via: 'ai-resolve' },
    ]);
  });

  it.each([
    ['a rejected cached action', (session: ReturnType<typeof createFakeBrowserSession>) => {
      let calls = 0;
      vi.spyOn(session, 'perform').mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('cached target detached');
        }
      });
    }],
    ['a false cached assertion', () => undefined],
    ['a non-integrity cached assertion rejection', (session: ReturnType<typeof createFakeBrowserSession>) => {
      vi.spyOn(session, 'evaluateAssert').mockRejectedValueOnce(new Error('browser evaluation failed'));
    }],
  ] as const)('treats %s as a behavioral path-C miss rather than an integrity failure', async (_description, arrange) => {
    const priorTrace = coveredTrace([{ type: 'navigate', url: '/cached' }], [passingText('Cached')]);
    const session = createFakeBrowserSession(new Map(), { assertOutcomes: [
      { passed: false, message: 'Cached assertion failed.' },
      { passed: true },
    ] });
    arrange(session);
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.evaluateAssert(passingText('Recovered'), 'dashboard-reached');
        return { outcome: 'success' };
      },
    });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()], aiGrounding(priorTrace));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'recorded-ai')]);
    expect(executor.agenticRequests[0]).not.toHaveProperty('priorTrace');
  });

  it('continues from a replay compute-bind miss into fresh agentic execution through the same bind primitive', async () => {
    const priorTrace = coveredTrace([{ type: 'click', element: SUBMIT }], [passingText('Cached dashboard')]);
    const session = createFakeBrowserSession(liveEntries([SUBMIT]));
    const originalResolveGrounded = session.resolveGrounded.bind(session);
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded')
      .mockResolvedValueOnce({ kind: 'miss', reason: 'element-not-found' })
      .mockImplementation(originalResolveGrounded);
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'click', element: SUBMIT });
        await request.controller.evaluateAssert(passingText('Refreshed dashboard'), 'dashboard-reached');
        return { outcome: 'success' };
      },
    });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()], aiGrounding(priorTrace));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(executor.agenticRequests).toHaveLength(1);
    expect(executor.agenticRequests[0]).not.toHaveProperty('priorTrace');
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'recorded-ai')]);
    expect(resolveGrounded).toHaveBeenCalledTimes(2);
    expect(resolveGrounded.mock.calls.map(([, query]) => (query as unknown as { readonly mode: string }).mode)).toEqual([
      'compute',
      'compute',
    ]);
    expect(session.operations().filter((operation) => operation.type === 'perform')).toHaveLength(1);
  });

  it.each([
    ['an action', 'ambercast_perform', async (request: AiAgenticRequest) => {
      await request.controller.perform({ type: 'click', element: SUBMIT });
    }],
    ['a target-scoped assertion', 'ambercast_evaluate_assert', async (request: AiAgenticRequest) => {
      await request.controller.evaluateAssert({
        type: 'assert',
        check: 'text-equals',
        element: SUBMIT,
        text: 'Dashboard',
      });
    }],
  ] as const)('reports a fresh agentic compute-bind miss for %s as a target rejection', async (_description, tool, script) => {
    const session = createFakeBrowserSession(liveEntries([SUBMIT]));
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded').mockResolvedValue({
      kind: 'miss',
      reason: 'element-not-found',
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await script(request);
        return { outcome: 'success' };
      },
    });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeUndefined();
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      explanation: `The AI-directed interaction was rejected by a browser target it could not resolve (${tool}: element-not-found).`,
      steps: [{ id: 'recorded-ai', status: 'error', kind: 'environment' }],
    });
    expect(outcome.results[0]?.result.explanation).not.toBe(
      'The supplied locator has no matching element in the current accessibility evidence.',
    );
    expect(executor.agenticRequests).toHaveLength(1);
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'recorded-ai')]);
    expect(resolveGrounded).toHaveBeenCalledWith(SUBMIT, expect.objectContaining({ mode: 'compute' }));
    expect(session.operations().filter((operation) => operation.type === 'perform' || operation.type === 'evaluate-assert')).toEqual([]);
  });

  it('stops a cancelled trace replay before resolving an agentic fallback', async () => {
    const abortController = new AbortController();
    const abortReason = new Error('Stop trace replay.');
    const session = createFakeBrowserSession(new Map(), {
      onPerform() {
        abortController.abort(abortReason);
        throw abortReason;
      },
    });
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
      signal: abortController.signal,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep()],
      aiGrounding(coveredTrace([{ type: 'navigate', url: '/cached' }], [passingText('Cached')])),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeUndefined();
    // SPEC-16: cancellation has its own case status while preserving the step error.
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      steps: [{ id: 'recorded-ai', status: 'error', kind: 'environment' }],
    });
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
    // SPEC-16: cancellation does not emit an ordinary rejection diagnostic.
    expect(events.emitted()).toEqual([{ type: 'step-start', stepId: 'recorded-ai' }]);
  });

  it('reports a grounding-unresolved error for a behavioral trace fallback in cache-only mode', async () => {
    const session = createFakeBrowserSession(new Map(), {
      assertOutcome: { passed: false, message: 'The cached page changed.' },
    });
    const { deps, events, recordingStorage, resolveAiExecutor } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep()],
      aiGrounding(coveredTrace([], [passingText('Cached dashboard')])),
    );

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve: false });

    expect(outcome.results[0]?.error).toMatchObject({
      kind: 'grounding-unresolved',
      details: { stepId: 'recorded-ai', reason: 'recoverable-miss' },
    });
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      steps: [{ id: 'recorded-ai', status: 'error', kind: 'environment' }],
    });
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
    expect(session.operations()).toEqual([
      { type: 'evaluate-assert', check: { check: 'text-visible', text: 'Cached dashboard' } },
    ]);
  });
});

describe('run path-B element recovery', () => {
  it('keeps a fingerprint hit deterministic and never resolves an AI executor', async () => {
    const session = createFakeBrowserSession(liveEntries([SUBMIT]));
    const { deps, events, recordingStorage, resolveAiExecutor } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }],
      elementGrounding(['click-submit']),
    );
    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
    expect(events.emitted().filter((event) => event.type === 'step-result')).toEqual([
      { type: 'step-result', stepId: 'click-submit', via: 'grounding' },
    ]);
  });

  it('aborts a different unique post-confirmation target through verify mode without writing grounding', async () => {
    const replacementFingerprint: Fingerprint = {
      algorithm: 'a11y-neighborhood-v2',
      hash: 'c'.repeat(64),
    };
    const entries = liveEntries([SUBMIT], DIFFERENT_FINGERPRINT);
    const session = createFakeBrowserSession(entries, { snapshot: pathBSnapshot() });
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded');
    const executor = createFakeAiExecutor({
      execute: () => {
        const entry = entries.get(elementRefKey(SUBMIT));
        if (entry === undefined) {
          throw new Error('The Path-B fixture must retain its unique replacement element.');
        }
        entry.currentFingerprint = replacementFingerprint;
        return { data: { confirmed: true }, raw: '{"confirmed":true}' };
      },
    });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }],
      elementGrounding(['click-submit']),
    );
    const groundingBefore = await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeUndefined();
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      steps: [{ id: 'click-submit', status: 'error', kind: 'environment' }],
    });
    expect(outcome.results[0]?.result.explanation).not.toBe(GENERIC_ABORT_EXPLANATION);
    expect(outcome.results[0]?.result.explanation).not.toBe(
      'The supplied locator has no matching element in the current accessibility evidence.',
    );
    expect(executor.structuredRequests).toHaveLength(1);
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'click-submit')]);
    expect(resolveGrounded).toHaveBeenNthCalledWith(1, SUBMIT, {
      mode: 'verify',
      fingerprint: FINGERPRINT,
    });
    expect(resolveGrounded).toHaveBeenNthCalledWith(2, SUBMIT, {
      mode: 'verify',
      fingerprint: pathBFingerprint(),
    });
    expect(recordingStorage.writes).toEqual([]);
    expect(await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`)).toBe(groundingBefore);
    expect(session.operations().filter((operation) => (
      operation.type === 'perform'
      || operation.type === 'evaluate-assert'
      || operation.type === 'capture-value'
    ))).toEqual([]);
    await expect(session.resolveGrounded(SUBMIT, { mode: 'compute', resolvedSecrets: [] })).resolves.toMatchObject({
      kind: 'hit',
      element: { ref: SUBMIT, fingerprint: replacementFingerprint },
    });
  });

  it.each([
    [
      'element-not-found',
      'The supplied locator has no matching element in the current accessibility evidence.',
    ],
    [
      'ambiguous-match',
      'The supplied locator matches more than one element in the current accessibility evidence. Add a distinguishing aria-label (or other accessible-name difference) to one of the matching elements so the locator can identify a single element.',
    ],
    [
      'snapshot-invalid',
      'The current accessibility evidence could not be parsed and cannot be trusted for this locator. Retry the run; if this persists, the page structure may use a form this parser does not recognize.',
    ],
  ] as const)('maps a post-confirmation %s bind miss to its deterministic CaseAbort', async (reason, explanation) => {
    const session = createFakeBrowserSession(liveEntries([SUBMIT], DIFFERENT_FINGERPRINT), { snapshot: pathBSnapshot() });
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded')
      .mockResolvedValueOnce({ kind: 'miss', reason: 'fingerprint-mismatch' })
      .mockResolvedValueOnce({ kind: 'miss', reason });
    const executor = createFakeAiExecutor({
      execute: () => ({ data: { confirmed: true }, raw: '{"confirmed":true}' }),
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }],
      elementGrounding(['click-submit']),
    );
    const groundingBefore = await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeUndefined();
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      explanation,
      steps: [{ id: 'click-submit', status: 'error', kind: 'environment' }],
    });
    expect(resolveGrounded).toHaveBeenNthCalledWith(2, SUBMIT, {
      mode: 'verify',
      fingerprint: pathBFingerprint(),
    });
    expect(recordingStorage.writes).toEqual([]);
    expect(await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`)).toBe(groundingBefore);
    expect(session.operations().filter((operation) => (
      operation.type === 'perform'
      || operation.type === 'evaluate-assert'
      || operation.type === 'capture-value'
    ))).toEqual([]);
  });

  it('re-resolves an element miss with exactly one AI call, persists the fresh fingerprint, and marks the result ai-resolve', async () => {
    const secretRef = '{{secrets.AMBERCAST_SECRET_DUMMY}}';
    const secretValue = 'AMBERCAST_SECRET_DUMMY_VALUE';
    const expectedFingerprint = pathBFingerprint();
    const snapshot = pathBSnapshot(`The password field contains ${secretValue}.`);
    const entries = new Map([
      [elementRefKey(PASSWORD), { exists: true, currentFingerprint: FINGERPRINT }],
      [elementRefKey(SUBMIT), { exists: true, currentFingerprint: DIFFERENT_FINGERPRINT }],
    ]);
    const session = createFakeBrowserSession(entries, { snapshot });
    const executor = createFakeAiExecutor({
      execute: () => {
        const entry = entries.get(elementRefKey(SUBMIT));
        if (entry === undefined) {
          throw new Error('The post-confirmation fixture must retain Submit.');
        }
        entry.currentFingerprint = expectedFingerprint;
        return { data: { confirmed: true }, raw: '{"confirmed":true}' };
      },
    });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'fill-password-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
        { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
      ],
      elementGrounding(['fill-password-secret', 'click-submit']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'click-submit')]);
    expect(executor.structuredRequests).toHaveLength(1);
    const requestContext = executor.structuredRequests[0]?.context as {
      readonly target: ElementRef;
      readonly snapshot: { readonly accessibilityTree: JsonValueT };
    };
    expect(requestContext.target).toStrictEqual(SUBMIT);
    expect(requestContext.snapshot).toStrictEqual({
      accessibilityTree: pathBAccessibilityTree(`The password field contains ${secretRef}.`),
    });
    expect(executor.structuredRequests[0]?.prompt).toBe(
      'Confirm whether the supplied locator still identifies the intended element.',
    );
    const responseSchema = executor.structuredRequests[0]?.responseSchema as unknown as {
      readonly additionalProperties: boolean;
      readonly properties: Readonly<Record<string, { readonly type: string }>>;
      readonly required: readonly string[];
    };
    expect(responseSchema).toMatchObject({
      additionalProperties: false,
      properties: { confirmed: { type: 'boolean' } },
      required: ['confirmed'],
    });
    expect(responseSchema.properties).toStrictEqual({ confirmed: { type: 'boolean' } });
    expect(JSON.stringify(executor.structuredRequests[0]?.responseSchema)).not.toContain('fingerprint');
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual({
      'fill-password-secret': { kind: 'element', fingerprint: FINGERPRINT },
      'click-submit': { kind: 'element', fingerprint: expectedFingerprint },
    });
    expect(session.operations()).toEqual([
      { type: 'resolve-grounded', target: PASSWORD, query: { mode: 'verify', fingerprint: FINGERPRINT } },
      { type: 'fill-secret', target: boundTarget(PASSWORD, FINGERPRINT), value: secretValue, policy: baseUrlSecretPolicy(secretRef, TARGETS.web) },
      { type: 'resolve-grounded', target: SUBMIT, query: { mode: 'verify', fingerprint: FINGERPRINT } },
      { type: 'snapshot-for-resolution' },
      { type: 'resolve-grounded', target: SUBMIT, query: { mode: 'verify', fingerprint: expectedFingerprint } },
      { type: 'perform', action: { type: 'click', target: boundTarget(SUBMIT, expectedFingerprint) } },
    ]);
    expect(events.emitted().filter((event) => event.type === 'step-result')).toEqual([
      { type: 'step-result', stepId: 'fill-password-secret', via: 'grounding' },
      { type: 'step-result', stepId: 'click-submit', via: 'ai-resolve' },
    ]);
  });

  it('flushes a refreshed fingerprint even when the original action subsequently fails', async () => {
    const expectedFingerprint = pathBFingerprint();
    const entries = liveEntries([SUBMIT], DIFFERENT_FINGERPRINT);
    const session = createFakeBrowserSession(entries, {
      snapshot: pathBSnapshot(),
      onPerform() {
        throw new Error('The refreshed target detached before click.');
      },
    });
    const executor = createFakeAiExecutor({
      execute: () => {
        const entry = entries.get(elementRefKey(SUBMIT));
        if (entry === undefined) {
          throw new Error('The post-confirmation fixture must retain Submit.');
        }
        entry.currentFingerprint = expectedFingerprint;
        return { data: { confirmed: true }, raw: '{"confirmed":true}' };
      },
    });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }],
      elementGrounding(['click-submit']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('error');
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'click-submit')]);
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual({
      'click-submit': { kind: 'element', fingerprint: expectedFingerprint },
    });
  });

  it.each([
    ['a schema-invalid re-resolution response', 'The AI response did not match the confirmation schema.'],
    ['an AI refusal to confirm the authored locator', 'The AI cannot confirm the locator on this page.'],
  ] as const)('fails closed for %s without performing or replacing the previous fingerprint', async (_description, message) => {
    const session = createFakeBrowserSession(liveEntries([SUBMIT], DIFFERENT_FINGERPRINT), { snapshot: pathBSnapshot() });
    const executor = createFakeAiExecutor({
      execute: () => {
        throw new AiResponseInvalidError(message, { raw: '{"status":"unconfirmed"}', issues: [] });
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }],
      elementGrounding(['click-submit']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(AiResponseInvalidError);
    expect(session.operations()).toEqual([
      { type: 'resolve-grounded', target: SUBMIT, query: { mode: 'verify', fingerprint: FINGERPRINT } },
      { type: 'snapshot-for-resolution' },
    ]);
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual(elementGrounding(['click-submit']));
  });

  it('computes, confirms, and persists on a genuine cold start without resolving stored grounding', async () => {
    const expectedFingerprint = pathBFingerprint();
    const session = createFakeBrowserSession(liveEntries([SUBMIT], expectedFingerprint), { snapshot: pathBSnapshot() });
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded');
    const executor = createFakeAiExecutor({
      execute: () => ({ data: { confirmed: true }, raw: '{"confirmed":true}' }),
    });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }],
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(resolveGrounded).toHaveBeenCalledExactlyOnceWith(SUBMIT, {
      mode: 'verify',
      fingerprint: expectedFingerprint,
    });
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'click-submit')]);
    expect(executor.structuredRequests).toHaveLength(1);
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual({
      'click-submit': { kind: 'element', fingerprint: expectedFingerprint },
    });
    expect(session.operations()).toEqual([
      { type: 'snapshot-for-resolution' },
      { type: 'resolve-grounded', target: SUBMIT, query: { mode: 'verify', fingerprint: expectedFingerprint } },
      { type: 'perform', action: { type: 'click', target: boundTarget(SUBMIT, expectedFingerprint) } },
    ]);
  });

  it.each([
    ['an absent target', {
      role: 'root', name: '', children: [{ role: 'main', name: 'Application', children: [] }],
    }, 'The supplied locator has no matching element in the current accessibility evidence.'],
    ['ambiguous targets', {
      role: 'root', name: '', children: [{
        role: 'form', name: 'Sign in', children: [
          { role: 'button', name: 'Submit', children: [] },
          { role: 'button', name: 'Submit', children: [] },
        ],
      }],
    }, 'The supplied locator matches more than one element in the current accessibility evidence. Add a distinguishing aria-label (or other accessible-name difference) to one of the matching elements so the locator can identify a single element.'],
    [
      'parser-invalid evidence',
      SNAPSHOT_INVALID,
      'The current accessibility evidence could not be parsed and cannot be trusted for this locator. Retry the run; if this persists, the page structure may use a form this parser does not recognize.',
    ],
  ])('does not call AI before failing closed for %s in captured evidence', async (_description, accessibilityTree, explanation) => {
    const session = createFakeBrowserSession(liveEntries([SUBMIT], DIFFERENT_FINGERPRINT), {
      snapshot: { accessibilityTree, screenshot: new Uint8Array() },
    });
    const executor = createFakeAiExecutor();
    const { deps, events, recordingStorage, resolveAiExecutor } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
        { id: 'after-click', kind: 'action', action: 'navigate', url: '/after' },
      ],
      elementGrounding(['click-submit']),
    );
    const groundingBefore = await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expectStopgapOutcome(outcome, 'click-submit', 'after-click');
    expect(outcome.results[0]?.result.explanation).toBe(explanation);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(executor.structuredRequests).toEqual([]);
    expect(aiCalls(events)).toEqual([]);
    expect(recordingStorage.writes).toEqual([]);
    expect(await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`)).toBe(groundingBefore);
    expect(session.operations()).toEqual([
      { type: 'resolve-grounded', target: SUBMIT, query: { mode: 'verify', fingerprint: FINGERPRINT } },
      { type: 'snapshot-for-resolution' },
    ]);
  });

  it('honors a confirmation denial and persists no locally recomputed fingerprint', async () => {
    const locallyComputedFingerprint = pathBFingerprint();
    expect(locallyComputedFingerprint).toMatchObject({ algorithm: 'a11y-neighborhood-v2' });
    const session = createFakeBrowserSession(liveEntries([SUBMIT], DIFFERENT_FINGERPRINT), { snapshot: pathBSnapshot() });
    const executor = createFakeAiExecutor({
      execute: () => ({ data: { confirmed: false }, raw: '{"confirmed":false}' }),
    });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }],
      elementGrounding(['click-submit']),
    );
    const groundingBefore = await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('error');
    expect(outcome.results[0]?.result.explanation).toBe('The AI could not confirm that the supplied locator identifies the intended element.');
    expect(outcome.results[0]?.error).toBeUndefined();
    expect(executor.structuredRequests).toHaveLength(1);
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'click-submit')]);
    expect(recordingStorage.writes).toEqual([]);
    expect(await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`)).toBe(groundingBefore);
    expect(session.operations().filter((operation) => operation.type === 'perform')).toEqual([]);
  });

  it('waits exactly once with the resolved default before cache verification, including when resolution is disabled', async () => {
    const session = createFakeBrowserSession(liveEntries([SUBMIT], DIFFERENT_FINGERPRINT));
    const awaitElementPresence = vi.spyOn(session, 'awaitElementPresence');
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded');
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }], elementGrounding(['click-submit']));

    await run(deps, { ...DEFAULT_OPTIONS, resolve: false });

    expect(awaitElementPresence).toHaveBeenCalledExactlyOnceWith(SUBMIT, 5000);
    expect(awaitElementPresenceCalls(session)).toEqual([{ ref: SUBMIT, timeoutMs: 5000 }]);
    expect(awaitElementPresence.mock.invocationCallOrder[0]).toBeLessThan(resolveGrounded.mock.invocationCallOrder[0]!);
  });

  it('uses the selected target\'s non-default resolve timeout for presence waiting', async () => {
    const session = createFakeBrowserSession(liveEntries([SUBMIT], DIFFERENT_FINGERPRINT));
    const awaitElementPresence = vi.spyOn(session, 'awaitElementPresence');
    const targets = { web: { ...RESOLVED_TARGETS.web, resolveTimeoutMs: 1500 } } as const;
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      config: { ...createScenario().deps.config, targets },
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }], elementGrounding(['click-submit']));

    await run(deps, { ...DEFAULT_OPTIONS, resolve: false });

    expect(awaitElementPresence).toHaveBeenCalledExactlyOnceWith(SUBMIT, 1500);
    expect(awaitElementPresenceCalls(session)).toEqual([{ ref: SUBMIT, timeoutMs: 1500 }]);
  });

  it('waits before cache-miss classification and never waits again before the post-confirmation re-bind', async () => {
    const tree = pathBAccessibilityTree();
    const fingerprint = pathBFingerprint(tree);
    const session = createFakeBrowserSession(liveEntries([SUBMIT], fingerprint), {
      snapshot: { accessibilityTree: tree, screenshot: new Uint8Array() },
    });
    const awaitElementPresence = vi.spyOn(session, 'awaitElementPresence');
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded');
    const snapshotForResolution = vi.spyOn(session, 'snapshotForResolution');
    const executor = createFakeAiExecutor({ execute: () => ({ data: { confirmed: true }, raw: '{"confirmed":true}' }) });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result).toMatchObject({ status: 'passed', aiCalls: 1 });
    expect(awaitElementPresence).toHaveBeenCalledExactlyOnceWith(SUBMIT, 5000);
    expect(awaitElementPresence.mock.invocationCallOrder[0]).toBeLessThan(snapshotForResolution.mock.invocationCallOrder[0]!);
    expect(resolveGrounded).toHaveBeenCalledTimes(1);
    expect(awaitElementPresence.mock.invocationCallOrder[0]).toBeLessThan(resolveGrounded.mock.invocationCallOrder[0]!);
  });

  it('waits once before both cache verification and the second AI-confirmed re-bind', async () => {
    const tree = pathBAccessibilityTree();
    const fingerprint = pathBFingerprint(tree);
    const session = createFakeBrowserSession(liveEntries([SUBMIT], fingerprint), {
      snapshot: { accessibilityTree: tree, screenshot: new Uint8Array() },
    });
    const awaitElementPresence = vi.spyOn(session, 'awaitElementPresence');
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded');
    const executor = createFakeAiExecutor({ execute: () => ({ data: { confirmed: true }, raw: '{"confirmed":true}' }) });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }], elementGrounding(['click-submit']));

    await run(deps, DEFAULT_OPTIONS);

    expect(awaitElementPresence).toHaveBeenCalledTimes(1);
    expect(resolveGrounded).toHaveBeenCalledTimes(2);
    expect(awaitElementPresence.mock.invocationCallOrder[0]).toBeLessThan(resolveGrounded.mock.invocationCallOrder[1]!);
  });

  it('wins an appearance race through a cached grounding verify without an AI call', async () => {
    const entries = new Map<string, FakeBrowserSessionEntry>([[elementRefKey(SUBMIT), {
      exists: false,
      currentFingerprint: FINGERPRINT,
    }]]);
    const session = createFakeBrowserSession(entries);
    const awaitElementPresence = vi.spyOn(session, 'awaitElementPresence');
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded');
    scheduleFakeAppearance(session, SUBMIT);
    const { deps, events, recordingStorage, resolveAiExecutor } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }], elementGrounding(['click-submit']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result).toMatchObject({ status: 'passed', aiCalls: 0 });
    expect(events.emitted()).toContainEqual({ type: 'step-result', stepId: 'click-submit', via: 'grounding' });
    expect(awaitElementPresence).toHaveBeenCalledExactlyOnceWith(SUBMIT, 5000);
    expect(awaitElementPresence.mock.invocationCallOrder[0]).toBeLessThan(resolveGrounded.mock.invocationCallOrder[0]!);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  it.each([
    ['without an appearance', { role: 'root', name: '', children: [] } as JsonValueT, 'The supplied locator has no matching element in the current accessibility evidence.'],
    ['with an appearance but ambiguous evidence', {
      role: 'root', name: '', children: [{ role: 'main', name: '', children: [
        { role: 'button', name: 'Submit', children: [] }, { role: 'button', name: 'Submit', children: [] },
      ] }],
    } as JsonValueT, 'The supplied locator matches more than one element in the current accessibility evidence. Add a distinguishing aria-label (or other accessible-name difference) to one of the matching elements so the locator can identify a single element.'],
  ] as const)('keeps the existing classification abort %s after presence waiting', async (description, accessibilityTree, explanation) => {
    const entries = new Map<string, FakeBrowserSessionEntry>([[elementRefKey(SUBMIT), {
      exists: false,
      currentFingerprint: description.includes('ambiguous') ? DIFFERENT_FINGERPRINT : FINGERPRINT,
    }]]);
    const session = createFakeBrowserSession(entries, { snapshot: { accessibilityTree, screenshot: new Uint8Array() } });
    if (description.includes('ambiguous')) scheduleFakeAppearance(session, SUBMIT);
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }], elementGrounding(['click-submit']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.explanation).toBe(explanation);
  });

  it('reports the classification tree rather than the fresh re-capture for a classification abort', async () => {
    const classificationTree: JsonValueT = { role: 'root', name: 'classification', children: [] };
    const recaptureTree: JsonValueT = { role: 'root', name: 'recapture', children: [] };
    const session = createFakeBrowserSession(liveEntries([SUBMIT], DIFFERENT_FINGERPRINT), { snapshot: { accessibilityTree: classificationTree, screenshot: new Uint8Array() } });
    vi.spyOn(session, 'accessibilitySnapshot').mockResolvedValue({ tree: recaptureTree, rawYaml: '', scalarValues: [] });
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }], elementGrounding(['click-submit']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(JSON.parse(outcome.results[0]?.result.steps.at(-1)?.observed?.accessibilitySnapshot ?? 'null')).toEqual(classificationTree);
  });

  it('redacts a secret-bearing classification tree while screenshot policy uses the clean re-capture', async () => {
    const secretRef = '{{secrets.classification}}';
    const secretValue = 'CLASSIFICATION_SECRET_VALUE';
    const classificationTree: JsonValueT = {
      role: 'root', name: secretValue, children: [{ role: 'button', name: 'Submit', children: [] }],
    };
    const recaptureTree: JsonValueT = { role: 'root', name: 'clean re-capture', children: [] };
    const session = createFakeBrowserSession(new Map([
      [elementRefKey(PASSWORD), { exists: true, currentFingerprint: FINGERPRINT }],
      [elementRefKey(SUBMIT), { exists: true, currentFingerprint: DIFFERENT_FINGERPRINT }],
    ]), { snapshot: { accessibilityTree: classificationTree, screenshot: new Uint8Array() } });
    vi.spyOn(session, 'accessibilitySnapshot').mockResolvedValue({ tree: recaptureTree, rawYaml: '', scalarValues: [] });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
    ], elementGrounding(['fill-secret', 'click-submit']));

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const step = outcome.results[0]?.result.steps.at(-1);

    expect(step?.observed?.accessibilitySnapshot).toContain(secretRef);
    expect(step?.observed?.accessibilitySnapshot).not.toContain(secretValue);
    expect(step?.screenshotOmitted).toBeUndefined();
  });

  it('omits screenshots when a clean classification tree has a secret-bearing fresh re-capture', async () => {
    const secretRef = '{{secrets.fresh_recapture}}';
    const secretValue = 'FRESH_RECAPTURE_SECRET_VALUE';
    const classificationTree: JsonValueT = { role: 'root', name: 'clean classification', children: [] };
    const recaptureTree: JsonValueT = { role: 'root', name: secretValue, children: [] };
    const session = createFakeBrowserSession(new Map([
      [elementRefKey(PASSWORD), { exists: true, currentFingerprint: FINGERPRINT }],
      [elementRefKey(SUBMIT), { exists: true, currentFingerprint: DIFFERENT_FINGERPRINT }],
    ]), { snapshot: { accessibilityTree: classificationTree, screenshot: new Uint8Array() } });
    vi.spyOn(session, 'accessibilitySnapshot').mockResolvedValue({
      tree: recaptureTree,
      rawYaml: `secret: ${secretValue}`,
      scalarValues: [secretValue],
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
    ], elementGrounding(['fill-secret', 'click-submit']));

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const step = outcome.results[0]?.result.steps.at(-1);

    expect(JSON.parse(step?.observed?.accessibilitySnapshot ?? 'null')).toEqual(classificationTree);
    expect(step?.screenshotOmitted).toBe('secret-detected');
  });

  it('fails closed when fresh re-capture rejects after a secret-bearing classification abort', async () => {
    const secretRef = '{{secrets.failed_recapture}}';
    const secretValue = 'FAILED_RECAPTURE_SECRET_VALUE';
    const classificationTree: JsonValueT = { role: 'root', name: 'classification', children: [] };
    const session = createFakeBrowserSession(new Map([
      [elementRefKey(PASSWORD), { exists: true, currentFingerprint: FINGERPRINT }],
      [elementRefKey(SUBMIT), { exists: true, currentFingerprint: DIFFERENT_FINGERPRINT }],
    ]), { snapshot: { accessibilityTree: classificationTree, screenshot: new Uint8Array() } });
    vi.spyOn(session, 'accessibilitySnapshot').mockRejectedValue(new Error('fresh re-capture unavailable'));
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
    ], elementGrounding(['fill-secret', 'click-submit']));

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const step = outcome.results[0]?.result.steps.at(-1);

    expect(step?.observed).toBeUndefined();
    expect(step?.screenshotOmitted).toBe('secret-detected');
  });

  it('keeps using the fresh re-capture for non-classification abort evidence', async () => {
    const recaptureTree: JsonValueT = { role: 'root', name: 'fresh non-classification re-capture', children: [] };
    const session = createFakeBrowserSession(liveEntries([SUBMIT], DIFFERENT_FINGERPRINT));
    vi.spyOn(session, 'accessibilitySnapshot').mockResolvedValue({ tree: recaptureTree, rawYaml: '', scalarValues: [] });
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }], elementGrounding(['click-submit']));

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve: false });

    expect(JSON.parse(outcome.results[0]?.result.steps.at(-1)?.observed?.accessibilitySnapshot ?? 'null')).toEqual(recaptureTree);
  });

  it('aborts secret-contaminated evidence without echoing or persisting the resolved secret', async () => {
    const secretRef = '{{secrets.AMBERCAST_SECRET_DUMMY}}';
    const secretValue = 'AMBERCAST_SECRET_DUMMY_VALUE';
    const rawTree: JsonValueT = {
      role: 'root',
      name: '',
      children: [{
        role: 'form',
        name: `Sign in ${secretValue}`,
        children: [
          { role: 'textbox', name: 'Email', children: [] },
          { role: 'button', name: 'Submit', children: [] },
        ],
      }],
    };
    const session = createFakeBrowserSession(new Map([
      [elementRefKey(PASSWORD), { exists: true, currentFingerprint: FINGERPRINT }],
      [elementRefKey(SUBMIT), { exists: true, currentFingerprint: DIFFERENT_FINGERPRINT }],
    ]), {
      snapshot: { accessibilityTree: rawTree, screenshot: new Uint8Array() },
    });
    const executor = createFakeAiExecutor({
      execute: () => ({ data: { confirmed: true }, raw: '{"confirmed":true}' }),
    });
    const { deps, events, recordingStorage, resolveAiExecutor } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'fill-password-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
        { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
        { id: 'after-click', kind: 'action', action: 'navigate', url: '/after' },
      ],
      elementGrounding(['fill-password-secret', 'click-submit']),
    );
    const groundingBefore = await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expectStopgapOutcome(outcome, 'click-submit', 'after-click', 'fill-password-secret');
    expect(outcome.results[0]?.result.explanation).toBe(
      'The supplied locator\'s accessibility evidence contains a resolved secret value and cannot be fingerprinted or cached. Add an aria-label that does not echo the secret value to the affected element.',
    );
    expect(outcome.results[0]?.result.explanation).not.toContain(secretValue);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(executor.structuredRequests).toEqual([]);
    expect(aiCalls(events)).toEqual([]);
    expect(recordingStorage.writes).toEqual([]);
    expect(await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`)).toBe(groundingBefore);
    expect(session.operations()).toEqual([
      { type: 'resolve-grounded', target: PASSWORD, query: { mode: 'verify', fingerprint: FINGERPRINT } },
      { type: 'fill-secret', target: boundTarget(PASSWORD, FINGERPRINT), value: secretValue, policy: baseUrlSecretPolicy(secretRef, TARGETS.web) },
      { type: 'resolve-grounded', target: SUBMIT, query: { mode: 'verify', fingerprint: FINGERPRINT } },
      { type: 'snapshot-for-resolution' },
    ]);
  });

  it('evicts a whole grounding document with one v1 entry, including its valid v2 sibling, before fresh resolution', async () => {
    const expectedFingerprint = pathBFingerprint();
    const session = createFakeBrowserSession(liveEntries([SUBMIT], expectedFingerprint), { snapshot: pathBSnapshot() });
    const executor = createFakeAiExecutor({
      execute: () => ({ data: { confirmed: true }, raw: '{"confirmed":true}' }),
    });
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    const plan = await createFreshPlan(recordingStorage.storage, testPath, [
      { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
    ]);
    const layout = createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR });
    await recordingStorage.storage.writeText(layout.groundingPathFor(testPath), toCanonicalArtifactText({
      schemaVersion: 1,
      planDigest: computePlanDigest(plan),
      entries: {
        'click-submit': {
          kind: 'element',
          fingerprint: { algorithm: 'a11y-neighborhood-v1', hash: 'c'.repeat(64) },
        },
        'still-valid-v2': {
          kind: 'element',
          fingerprint: { algorithm: 'a11y-neighborhood-v2', hash: 'd'.repeat(64) },
        },
      },
    } as unknown as JsonValueT));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(resolveAiExecutor).toHaveBeenCalledTimes(1);
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'click-submit')]);
    expect(executor.structuredRequests).toHaveLength(1);
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toStrictEqual({
      'click-submit': { kind: 'element', fingerprint: expectedFingerprint },
    });
    expect(session.operations()).toEqual([
      { type: 'snapshot-for-resolution' },
      { type: 'resolve-grounded', target: SUBMIT, query: { mode: 'verify', fingerprint: expectedFingerprint } },
      { type: 'perform', action: { type: 'click', target: boundTarget(SUBMIT, expectedFingerprint) } },
    ]);
  });

  it('fails closed under cache-only for a well-formed legacy-shaped fingerprint', async () => {
    const correctedFingerprint = pathBFingerprint();
    const session = createFakeBrowserSession(liveEntries([SUBMIT], correctedFingerprint));
    const { deps, events, recordingStorage, resolveAiExecutor } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }],
      { 'click-submit': { kind: 'element', fingerprint: FINGERPRINT } },
    );

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve: false });

    expect(outcome.results[0]?.result.status).toBe('error');
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
    expect(session.operations()).toEqual([
      { type: 'resolve-grounded', target: SUBMIT, query: { mode: 'verify', fingerprint: FINGERPRINT } },
    ]);
  });

  it('leaves the prior fingerprint untouched when the path-B snapshot fails before any AI request', async () => {
    const session = createFakeBrowserSession(liveEntries([SUBMIT], DIFFERENT_FINGERPRINT));
    vi.spyOn(session, 'snapshotForResolution').mockRejectedValueOnce(new Error('The browser could not capture evidence.'));
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }],
      elementGrounding(['click-submit']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('error');
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(executor.structuredRequests).toEqual([]);
    expect(aiCalls(events)).toEqual([]);
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual(elementGrounding(['click-submit']));
  });

  it('suppresses an element-miss fallback in cache-only mode with exactly zero AI calls', async () => {
    const session = createFakeBrowserSession(new Map());
    const { deps, events, recordingStorage, resolveAiExecutor } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }],
    );

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve: false });

    expect(outcome.results[0]?.error).toBeInstanceOf(GroundingUnresolvedError);
    expect(outcome.results[0]?.error).toMatchObject({
      kind: 'grounding-unresolved',
      exitCode: 4,
      message: 'No grounding is stored for this locator.',
      details: { stepId: 'click-submit', reason: 'missing' },
    });
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      steps: [{ id: 'click-submit', status: 'error', kind: 'environment' }],
    });
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
    expect(session.operations()).toEqual([]);
  });
});

describe('run element-count grounding boundary', () => {
  it('does not create grounding for a new page-scoped count assertion', async () => {
    const session = createFakeBrowserSession(new Map(), { assertOutcome: { passed: true } });
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded');
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'count-submit', kind: 'assert', check: 'element-count', target: SUBMIT, count: 0 }],
    );
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(resolveGrounded).not.toHaveBeenCalled();
    expect(session.operations()).toEqual([
      { type: 'evaluate-assert', check: { check: 'element-count', target: SUBMIT, count: 0 } },
    ]);
    expect(recordingStorage.writes).toEqual([]);
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual({});
  });

  it('ignores a legacy count grounding entry instead of reading, replacing, or requiring it', async () => {
    const session = createFakeBrowserSession(new Map(), { assertOutcome: { passed: true } });
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded');
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'count-submit', kind: 'assert', check: 'element-count', target: SUBMIT, count: 2 }],
      elementGrounding(['count-submit']),
    );
    const groundingBefore = await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(resolveGrounded).not.toHaveBeenCalled();
    expect(session.operations()).toEqual([
      { type: 'evaluate-assert', check: { check: 'element-count', target: SUBMIT, count: 2 } },
    ]);
    expect(recordingStorage.writes).toEqual([]);
    expect(await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.grounding.json`)).toBe(groundingBefore);
  });

  it.each([0, 2] as const)('evaluates count %i without allowing a strict-bind ambiguous-match gate', async (count) => {
    const session = createFakeBrowserSession(new Map(), { assertOutcome: { passed: true } });
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded').mockRejectedValue(
      new Error('element-count must not bind a single element.'),
    );
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'count-submit', kind: 'assert', check: 'element-count', target: SUBMIT, count }],
      elementGrounding(['count-submit']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(resolveGrounded).not.toHaveBeenCalled();
    expect(session.operations()).toEqual([
      { type: 'evaluate-assert', check: { check: 'element-count', target: SUBMIT, count } },
    ]);
  });
});

describe('run grounding recovery-mode dispatch regression', () => {
  it.each([
    ['navigate', { id: 'navigate-dashboard', kind: 'action', action: 'navigate', url: '/dashboard' }],
    ['text-visible', { id: 'dashboard-visible', kind: 'assert', check: 'text-visible', text: 'Dashboard' }],
    ['url-matches', { id: 'dashboard-url', kind: 'assert', check: 'url-matches', pattern: '/dashboard' }],
    ['element-count', { id: 'submit-count', kind: 'assert', check: 'element-count', target: SUBMIT, count: 0 }],
  ] as const)('does not consult a resolvable grounding entry for none-classified %s', async (_name, rawStep) => {
    const session = createFakeBrowserSession(liveEntries([SUBMIT]), { assertOutcome: { passed: true } });
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded').mockRejectedValue(new Error('none-classified steps must not resolve grounding'));
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
    const testPath = await writePrompt(recordingStorage.storage);
    const step = rawStep as unknown as TestStep;
    await seedFreshArtifacts(recordingStorage.storage, testPath, [step], elementGrounding([step.id]));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(resolveGrounded).not.toHaveBeenCalled();
  });

  it.each([
    ['click', { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }, [SUBMIT], 'action.click'],
    ['press', { id: 'press-submit', kind: 'action', action: 'press', target: SUBMIT, key: 'Enter' }, [SUBMIT], 'action.press'],
    ['fill', { id: 'fill-email', kind: 'action', action: 'fill', target: EMAIL, value: 'person@example.test' }, [EMAIL], 'action.fill'],
    ['fill-secret', { id: 'fill-password', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef: '{{secrets.password}}' }, [PASSWORD], 'action.fill-secret'],
    ['element-visible', { id: 'submit-visible', kind: 'assert', check: 'element-visible', target: SUBMIT }, [SUBMIT], 'assert.element-visible'],
    ['text-equals', { id: 'submit-text', kind: 'assert', check: 'text-equals', target: SUBMIT, text: 'Submit' }, [SUBMIT], 'assert.text-equals'],
    ['capture', { id: 'capture-email', kind: 'capture', target: EMAIL, variable: 'email' }, [EMAIL], undefined],
  ] as const)('continues to resolve grounding for element-reground %s through the shared policy', async (_name, rawStep, refs, tableAccess) => {
    const session = createFakeBrowserSession(liveEntries(refs), { assertOutcome: { passed: true } });
    const resolveGrounded = vi.spyOn(session, 'resolveGrounded');
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([['{{secrets.password}}', 'not-in-the-plan']])),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    const step = rawStep as unknown as TestStep;
    await seedFreshArtifacts(recordingStorage.storage, testPath, [step], elementGrounding([step.id]));
    groundingModeAccesses.accesses.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(resolveGrounded).toHaveBeenCalledOnce();
    expect(groundingModeAccesses.accesses).toEqual([
      ...(tableAccess === undefined ? [] : [tableAccess]),
      `mode.${step.id}`,
    ]);
  });
});

describe('run AI call timeout composition', () => {
  it('classifies a never-resolving path-C executor as a provider timeout', async () => {
    const executor = createFakeAiExecutor({
      executeAgentic: () => new Promise<never>(() => undefined),
    });
    const { deps, recordingStorage } = createScenario({
      config: configWithAiTimeout(1),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const outcome = await runWithinAiTimeoutTestWindow(deps);

    expect(executor.agenticRequests).toHaveLength(1);
    expectAiTimeoutOutcome(outcome, 'recorded-ai');
  });

  it('classifies a never-resolving path-B executor as a provider timeout', async () => {
    const executor = createFakeAiExecutor({
      execute: () => new Promise<never>(() => undefined),
    });
    const session = createFakeBrowserSession(liveEntries([SUBMIT], DIFFERENT_FINGERPRINT), { snapshot: pathBSnapshot() });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      config: configWithAiTimeout(1),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }],
      elementGrounding(['click-submit']),
    );

    const outcome = await runWithinAiTimeoutTestWindow(deps);

    expect(executor.structuredRequests).toHaveLength(1);
    expectAiTimeoutOutcome(outcome, 'click-submit');
  });

  it('keeps a caller abort during a pending path-C call unclassified and forwards its exact reason', async () => {
    const controller = new AbortController();
    const reason = new Error('caller stopped the agentic call');
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const executor = createFakeAiExecutor({
      executeAgentic: () => {
        markStarted?.();
        return new Promise<never>(() => undefined);
      },
    });
    const { deps, recordingStorage } = createScenario({
      config: configWithAiTimeout(60_000),
      resolveAiExecutor: async () => executor,
      signal: controller.signal,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const running = run(deps, DEFAULT_OPTIONS);
    await started;
    controller.abort(reason);
    const outcome = await running;

    expectCallerAbortOutcome(outcome, 'recorded-ai');
    expect(executor.agenticRequests[0]?.signal).not.toBe(controller.signal);
    expect(executor.agenticRequests[0]?.signal?.reason).toBe(reason);
  });

  it('keeps a caller abort during a pending path-B call unclassified and forwards its exact reason', async () => {
    const controller = new AbortController();
    const reason = new Error('caller stopped the structured call');
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const executor = createFakeAiExecutor({
      execute: () => {
        markStarted?.();
        return new Promise<never>(() => undefined);
      },
    });
    const session = createFakeBrowserSession(liveEntries([SUBMIT], DIFFERENT_FINGERPRINT), { snapshot: pathBSnapshot() });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      config: configWithAiTimeout(60_000),
      resolveAiExecutor: async () => executor,
      signal: controller.signal,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [{ id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT }],
      elementGrounding(['click-submit']),
    );

    const running = run(deps, DEFAULT_OPTIONS);
    await started;
    controller.abort(reason);
    const outcome = await running;

    expectCallerAbortOutcome(outcome, 'click-submit');
    expect(executor.structuredRequests[0]?.signal).not.toBe(controller.signal);
    expect(executor.structuredRequests[0]?.signal?.reason).toBe(reason);
  });

  it('does not mistake a caller TimeoutError for a local timeout after both signals abort', async () => {
    const controller = new AbortController();
    const timeoutController = new AbortController();
    const callerReason = new DOMException('caller cancelled', 'TimeoutError');
    const fabricatedTimeoutReason = new DOMException('local timeout fabricated', 'TimeoutError');
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);

    try {
      let markStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const executor = createFakeAiExecutor({
        executeAgentic: () => {
          markStarted?.();
          return new Promise<never>(() => undefined);
        },
      });
      const { deps, recordingStorage } = createScenario({
        config: configWithAiTimeout(60_000),
        resolveAiExecutor: async () => executor,
        signal: controller.signal,
      });
      const testPath = await writePrompt(recordingStorage.storage);
      await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

      const running = run(deps, DEFAULT_OPTIONS);
      await started;
      controller.abort(callerReason);
      timeoutController.abort(fabricatedTimeoutReason);
      const outcome = await running;

      expect(timeoutSpy).toHaveBeenCalledWith(60_000);
      expectCallerAbortOutcome(outcome, 'recorded-ai');
      expect(executor.agenticRequests[0]?.signal).not.toBe(controller.signal);
      expect(executor.agenticRequests[0]?.signal?.reason).toBe(callerReason);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('creates distinct timeout composites for two sequential path-B re-resolution calls', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');

    try {
      const executor = createFakeAiExecutor({
        execute: () => ({ data: { confirmed: true }, raw: '{"confirmed":true}' }),
      });
      const snapshot = pathBSnapshot();
      const session = createFakeBrowserSession(new Map([
        [elementRefKey(EMAIL), { exists: true, currentFingerprint: pathBFingerprint(snapshot.accessibilityTree, EMAIL) }],
        [elementRefKey(SUBMIT), { exists: true, currentFingerprint: pathBFingerprint(snapshot.accessibilityTree) }],
      ]), { snapshot });
      const { deps, recordingStorage } = createScenario({
        uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
        resolveAiExecutor: async () => executor,
      });
      const testPath = await writePrompt(recordingStorage.storage);
      await seedFreshArtifacts(
        recordingStorage.storage,
        testPath,
        [
          { id: 'fill-email', kind: 'action', action: 'fill', target: EMAIL, value: 'correct horse battery staple' },
          { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
        ],
        elementGrounding(['fill-email', 'click-submit']),
      );

      const outcome = await run(deps, DEFAULT_OPTIONS);

      expect(outcome.results[0]?.result.status).toBe('passed');
      expect(timeoutSpy).toHaveBeenCalledTimes(2);
      expect(executor.structuredRequests).toHaveLength(2);
      expect(executor.structuredRequests[0]?.signal).not.toBe(executor.structuredRequests[1]?.signal);
    } finally {
      timeoutSpy.mockRestore();
    }
  });
});

describe('run path-C pre-scan', () => {
  it('does zero browser binds while validating a complete trace that later fails trust validation', async () => {
    const session = createFakeBrowserSession(liveEntries([SUBMIT]));
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep()],
      aiGrounding(legacyTrace(
        [
          { type: 'click', element: SUBMIT },
          { type: 'navigate', url: '/users/{{run.never-captured}}' },
        ],
        [passingText('Verified')],
      )),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(session.operations()).toEqual([]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(executor.agenticRequests).toEqual([]);
    expect(aiCalls(events)).toEqual([]);
  });

  it.each([
    [
      'an ungranted secret reference in events after a valid action',
      legacyTrace(
        [
          { type: 'navigate', url: '/valid-first' },
          { type: 'fill-secret', element: PASSWORD, secretRef: '{{secrets.other.password}}' },
        ],
        [passingText('Verified')],
      ),
    ],
    [
      'an ungranted run reference in events after a valid action',
      legacyTrace(
        [
          { type: 'navigate', url: '/valid-first' },
          { type: 'navigate', url: '/users/{{run.ungranted}}' },
        ],
        [passingText('Verified')],
      ),
    ],
    [
      'a malformed run reference in events after a valid action',
      legacyTrace(
        [
          { type: 'navigate', url: '/valid-first' },
          { type: 'navigate', url: '/users/{{run.unclosed' },
        ],
        [passingText('Verified')],
      ),
    ],
    [
      'an ungranted run reference in verification after a valid assertion',
      legacyTrace(
        [{ type: 'navigate', url: '/valid-first' }],
        [passingText('Verified'), passingText('User {{run.ungranted}}')],
      ),
    ],
    [
      'a malformed run reference in verification after a valid assertion',
      legacyTrace(
        [{ type: 'navigate', url: '/valid-first' }],
        [passingText('Verified'), passingText('User {{run.unclosed')],
      ),
    ],
  ] as const)('rejects %s before any browser or executor operation', async (_description, priorTrace) => {
    const session = createFakeBrowserSession(new Map());
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()], aiGrounding(priorTrace));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(session.operations()).toEqual([]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(executor.agenticRequests).toEqual([]);
    expect(executor.structuredRequests).toEqual([]);
    expect(aiCalls(events)).toEqual([]);
  });

  it('rejects a cross-origin trace navigate before an earlier same-origin action can run', async () => {
    const session = createFakeBrowserSession(new Map());
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep()],
      aiGrounding(legacyTrace(
        [
          { type: 'navigate', url: '/valid-first' },
          { type: 'navigate', url: 'https://evil.test/phish' },
        ],
        [passingText('Verified')],
      )),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(session.operations()).toEqual([]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  it('rejects a same-origin-looking blob: trace navigate before any browser action can run', async () => {
    const session = createFakeBrowserSession(new Map());
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep()],
      aiGrounding(legacyTrace(
        [
          { type: 'navigate', url: '/valid-first' },
          { type: 'navigate', url: 'blob:https://example.test/guard-test' },
        ],
        [passingText('Verified')],
      )),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error?.message).toBe('A navigation URL must use the replay target\'s HTTP(S) scheme.');
    expect(session.operations()).toEqual([]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  it('rejects an opaque-origin trace navigate before any browser action can run', async () => {
    const session = createFakeBrowserSession(new Map());
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep()],
      aiGrounding(legacyTrace(
        [
          { type: 'navigate', url: '/valid-first' },
          { type: 'navigate', url: 'data:text/html,opaque-origin' },
        ],
        [passingText('Verified')],
      )),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error?.message).toBe('A navigation URL must use the replay target\'s HTTP(S) scheme.');
    expect(session.operations()).toEqual([]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  it('rejects an ungranted run reference in a trace before a later capture could grant it', async () => {
    const session = createFakeBrowserSession(new Map());
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    const priorTrace = legacyTrace(
      [{ type: 'navigate', url: '/valid-first' }, { type: 'navigate', url: '/users/{{run.later}}' }],
      [passingText('Verified')],
    );
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      aiStep(),
      { id: 'capture-later', kind: 'capture', target: EMAIL, variable: 'later' },
    ], aiGrounding(priorTrace));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(session.operations()).toEqual([]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  it('treats an allowed but unresolved secret during replay as an integrity failure without agentic fallback', async () => {
    const secretRef = '{{secrets.auth.required}}';
    const session = createFakeBrowserSession(new Map());
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
      secrets: createFakeSecretsProvider(new Map()),
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
      aiGrounding(coveredTrace([{ type: 'fill-secret', element: PASSWORD, secretRef }], [passingText('Verified')])),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toMatchObject({ kind: 'secret-unresolved' });
    expect(session.operations()).toEqual([]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(executor.agenticRequests).toEqual([]);
    expect(aiCalls(events)).toEqual([]);
  });

  it.each([
    ['navigate URL before fill-secret', (secretRef: string, secretValue: string) => legacyTrace(
      [
        { type: 'navigate', url: `/account/${secretValue}/settings` },
        { type: 'fill-secret', element: PASSWORD, secretRef },
      ],
      [passingText('Dashboard')],
    )],
    ['navigate URL', (secretRef: string, secretValue: string) => legacyTrace(
      [
        { type: 'fill-secret', element: PASSWORD, secretRef },
        { type: 'navigate', url: `/account/${secretValue}/settings` },
      ],
      [passingText('Dashboard')],
    )],
    ['fill value', (secretRef: string, secretValue: string) => legacyTrace(
      [
        { type: 'fill-secret', element: PASSWORD, secretRef },
        { type: 'fill', element: EMAIL, value: `token=${secretValue}` },
      ],
      [passingText('Dashboard')],
    )],
    ['assertion text', (secretRef: string, secretValue: string) => legacyTrace(
      [{ type: 'fill-secret', element: PASSWORD, secretRef }],
      [{ type: 'assert', check: 'text-visible', text: `Welcome ${secretValue}.` }],
    )],
    ['assertion text equals', (secretRef: string, secretValue: string) => legacyTrace(
      [{ type: 'fill-secret', element: PASSWORD, secretRef }],
      [{ type: 'assert', check: 'text-equals', element: PASSWORD, text: `Welcome ${secretValue}.` }],
    )],
    ['assertion URL pattern', (secretRef: string, secretValue: string) => legacyTrace(
      [{ type: 'fill-secret', element: PASSWORD, secretRef }],
      [{ type: 'assert', check: 'url-matches', pattern: `/account/${secretValue}/.*` }],
    )],
  ] as const)('rejects a materialized secret literal in a prior trace %s before replay begins', async (_description, buildTrace) => {
    const secretRef = '{{secrets.AMBERCAST_SECRET_DUMMY}}';
    const secretValue = 'sk-AMBERCAST_SECRET_DUMMY';
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]));
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
      aiGrounding(buildTrace(secretRef, secretValue)),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(session.operations()).toEqual([]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(executor.agenticRequests).toEqual([]);
    expect(aiCalls(events)).toEqual([]);
  });

  it('rejects an unsafe trace before a replay miss could hand it to an AI adapter as priorTrace', async () => {
    const secretRef = '{{secrets.AMBERCAST_SECRET_DUMMY}}';
    const secretValue = 'sk-AMBERCAST_SECRET_DUMMY';
    const priorTrace = legacyTrace(
      [
        { type: 'fill-secret', element: PASSWORD, secretRef },
        { type: 'navigate', url: `/account/${secretValue}/settings` },
      ],
      [passingText('Cached dashboard')],
    );
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcomes: [{ passed: false, message: 'Cached dashboard changed.' }, { passed: true }],
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.evaluateAssert(passingText('Fresh dashboard'));
        return { outcome: 'success' };
      },
    });
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
      aiGrounding(priorTrace),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(session.operations()).toEqual([]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(executor.agenticRequests).toEqual([]);
    expect(aiCalls(events)).toEqual([]);
  });

  it.each([
    ['click', (secretRef: string, target: ElementRef) => legacyTrace([
      { type: 'fill-secret', element: PASSWORD, secretRef },
      { type: 'click', element: target },
    ], [passingText('Dashboard')])],
    ['press', (secretRef: string, target: ElementRef) => legacyTrace([
      { type: 'fill-secret', element: PASSWORD, secretRef },
      { type: 'press', element: target, key: 'Enter' },
    ], [passingText('Dashboard')])],
    ['fill-secret', (secretRef: string, target: ElementRef) => legacyTrace([
      { type: 'fill-secret', element: PASSWORD, secretRef },
      { type: 'fill-secret', element: target, secretRef },
    ], [passingText('Dashboard')])],
    ['element-visible', (secretRef: string, target: ElementRef) => legacyTrace([
      { type: 'fill-secret', element: PASSWORD, secretRef },
    ], [{ type: 'assert', check: 'element-visible', element: target }])],
    ['element-count', (secretRef: string, target: ElementRef) => legacyTrace([
      { type: 'fill-secret', element: PASSWORD, secretRef },
    ], [{ type: 'assert', check: 'element-count', element: target, count: 1 }])],
  ] as const)('rejects a materialized secret in a stored-trace %s target role before replay', async (_description, buildTrace) => {
    const secretRef = '{{secrets.auth.target_role}}';
    const secretValue = 'TARGET-ROLE-SECRET-VALUE';
    const secretRoleTarget: ElementRef = { strategy: 'accessibility', role: secretValue, name: 'Secret-independent target' };
    const session = createFakeBrowserSession(liveEntries([PASSWORD, secretRoleTarget]));
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
      aiGrounding(buildTrace(secretRef, secretRoleTarget)),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error?.message).toBe('An AI trace contains a materialized secret value.');
    expect(session.operations()).toEqual([]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  /*
   * `assertTrustedRunReferences` is reached from both `materializeTraceAction`
   * and `materializeTraceAssert`, which back path C's replay and path B's
   * fresh-agentic materialization alike (#157). Path C's malformed and
   * ungranted rows above pre-scan a whole historical trace and so also prove
   * an ordering guarantee ("before any browser or executor operation") that
   * does not apply to path B, where each `perform`/`evaluateAssert` call is
   * validated independently at the moment it is issued — so one row per
   * failure mode is sufficient here. The two rows are spread across both
   * call sites the validator is reached from (`navigate` via `perform`,
   * `text-visible` via `evaluateAssert`) so both wirings are exercised
   * without adding a third row.
   *
   * Neither row involves secret resolution, so neither needs a priming
   * `fill-secret` call, and `session.operations()` stays empty in both —
   * the rejection happens during materialization, before any browser call.
   */
  it.each([
    [
      'a malformed run reference in a navigate action',
      async (request: AiAgenticRequest) => {
        await request.controller.perform({ type: 'navigate', url: '/users/{{run.unclosed' });
      },
      'An AI trace contains a malformed run reference.',
      undefined,
    ],
    [
      'an ungranted run reference in a text-visible assertion',
      async (request: AiAgenticRequest) => {
        await request.controller.evaluateAssert({ type: 'assert', check: 'text-visible', text: 'Welcome {{run.ungranted}}' });
      },
      'An AI trace references a run value that this step is not allowed to use.',
      { runRef: 'ungranted' },
    ],
  ] as const)('rejects %s before it reaches the browser', async (_description, performOffendingCall, expectedMessage, expectedDetails) => {
    const session = createFakeBrowserSession(new Map());
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await performOffendingCall(request);
        return { outcome: 'success' };
      },
    });
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error?.message).toBe(expectedMessage);
    if (expectedDetails === undefined) {
      expect(error?.details).toBeUndefined();
    } else {
      expect(error?.details).toEqual(expectedDetails);
    }
    expect(session.operations()).toEqual([]);
    expect(resolveAiExecutor).toHaveBeenCalledTimes(1);
  });
});

describe('run agentic wrapper state machine', () => {
  it('writes a trace with a single trailing passed assertion and retains earlier actions as events', async () => {
    const session = createFakeBrowserSession(new Map());
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'navigate', url: '/settings' });
        await request.controller.evaluateAssert(passingText('Settings'), 'dashboard-reached');
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    await expect(run(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      results: [{ result: { status: 'passed' } }],
    });

    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual(aiGrounding(coveredTrace(
      [{ type: 'navigate', url: '/settings' }],
      [passingText('Settings')],
    )));
  });

  it('writes every final passed assertion as verification when the trailing run has length greater than one', async () => {
    const session = createFakeBrowserSession(new Map());
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'navigate', url: '/dashboard' });
        await request.controller.evaluateAssert(passingText('Dashboard'), 'credentials-submitted');
        await request.controller.evaluateAssert(passingText('Signed in as Ari'), 'dashboard-reached');
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{
      id: 'recorded-ai',
      kind: 'ai',
      instruction: 'Complete sign-in and reach the dashboard.',
      instructionCoverage: [
        {
          id: 'credentials-submitted',
          kind: 'success',
          sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 32 },
        },
        {
          id: 'dashboard-reached',
          kind: 'success',
          sourceSpan: { startLine: 3, startColumn: 34, endLine: 3, endColumn: 56 },
        },
      ],
    } as unknown as TestStep]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual(aiGrounding(coveredTrace(
      [{ type: 'navigate', url: '/dashboard' }],
      [passingText('Dashboard'), passingText('Signed in as Ari')],
      { 'credentials-submitted': 0, 'dashboard-reached': 1 },
    )));
  });

  it.each([
    [
      'an action',
      async (request: AiAgenticRequest) => request.controller.perform({ type: 'press', element: SUBMIT, key: 'Enter' }),
      [{ passed: true }, { passed: true }] as const,
      [
        { type: 'navigate', url: '/dashboard' },
        passingText('Earlier dashboard'),
        { type: 'press', element: SUBMIT, key: 'Enter' },
      ] as const,
    ],
    [
      'a snapshot',
      async (request: AiAgenticRequest) => request.controller.snapshotForResolution(),
      [{ passed: true }, { passed: true }] as const,
      [{ type: 'navigate', url: '/dashboard' }, passingText('Earlier dashboard')] as const,
    ],
    ['a failed assertion', async (request: AiAgenticRequest) => request.controller.evaluateAssert(passingText('Intermediate miss')), [
      { passed: true },
      { passed: false, message: 'Intermediate miss.' },
      { passed: true },
    ] as const, [{ type: 'navigate', url: '/dashboard' }, passingText('Earlier dashboard')] as const],
  ] as const)('resets a passed-assert run after %s and retains only the later terminal assertion as verification', async (_description, interrupt, assertOutcomes, expectedEvents) => {
    const session = createFakeBrowserSession(liveEntries([SUBMIT], FINGERPRINT), { assertOutcomes });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'navigate', url: '/dashboard' });
        await request.controller.evaluateAssert(passingText('Earlier dashboard'));
        await interrupt(request);
        await request.controller.evaluateAssert(passingText('Terminal dashboard'), 'dashboard-reached');
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual(aiGrounding(coveredTrace(
      expectedEvents,
      [passingText('Terminal dashboard')],
    )));
  });

  it.each([
    ['a perform after an earlier passed assertion', async (request: AiAgenticRequest) => {
      await request.controller.perform({ type: 'navigate', url: '/dashboard' });
      await request.controller.evaluateAssert(passingText('Dashboard'));
      await request.controller.perform({ type: 'press', element: SUBMIT, key: 'Enter' });
    }],
    ['only a bare perform', async (request: AiAgenticRequest) => {
      await request.controller.perform({ type: 'navigate', url: '/dashboard' });
    }],
    ['zero observations', async () => undefined],
  ] as const)('rejects a nominal agentic success with %s instead of writing grounding', async (_description, script) => {
    const session = createFakeBrowserSession(new Map());
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await script(request);
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeUndefined();
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      steps: [{ id: 'recorded-ai', status: 'error', kind: 'environment' }],
    });
    expect(recordingStorage.writes).toEqual([]);
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual({});
  });

  describe('TEST-12 rejection barrier', () => {
    async function runAfterRecoverableRejection(
      after: (request: InstructionCoveredAiAgenticRequest) => Promise<void>,
      options: { readonly before?: (request: AiAgenticRequest) => Promise<void>; readonly fallback?: boolean; readonly assertOutcomes?: FakeBrowserSessionOptions['assertOutcomes'] } = {},
    ) {
      const session = createFakeBrowserSession(
        liveEntries([SUBMIT]),
        options.assertOutcomes === undefined ? {} : { assertOutcomes: options.assertOutcomes },
      );
      vi.spyOn(session, 'perform').mockRejectedValue(new AgenticTargetRejection('ambercast_perform', 'element-not-found'));
      const executor = createFakeAiExecutor({
        async executeAgentic(request) {
          if (options.before !== undefined) await options.before(request);
          try {
            await request.controller.perform({ type: 'press', element: SUBMIT, key: 'Enter' });
          } catch {
            // The recoverable controller error is intentionally handled by the provider script.
          }
          await after(request);
          return { outcome: 'success' };
        },
      });
      const { deps, recordingStorage } = createScenario({
        uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
        resolveAiExecutor: async () => executor,
      });
      const testPath = await writePrompt(recordingStorage.storage);
      const prior = options.fallback ? aiGrounding(legacyTrace([], [passingText('Cached trace')])) : {};
      await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()], prior);
      return { outcome: await run(deps, DEFAULT_OPTIONS), storage: recordingStorage.storage, testPath };
    }

    it('a: rejects success after a passing assertion and target rejection without changing grounding', async () => {
      const { outcome, storage, testPath } = await runAfterRecoverableRejection(
        async () => undefined,
        { before: (request) => request.controller.evaluateAssert(passingText('Dashboard')).then(() => undefined) },
      );
      expect(outcome.results[0]?.result.explanation).toBe('The AI-directed interaction completed without terminal verification evidence.');
      expect((await readGrounding(storage, testPath)).entries).toEqual({});
    });

    it('b: preserves fallback grounding after a rejection followed by snapshot', async () => {
      const { outcome, storage, testPath } = await runAfterRecoverableRejection(
        (request) => request.controller.snapshotForResolution().then(() => undefined),
        { fallback: true, assertOutcomes: [{ passed: false, message: 'Cached trace missed.' }] },
      );
      expect(outcome.results[0]?.result.explanation).toBe('The AI-directed interaction completed without terminal verification evidence.');
      expect((await readGrounding(storage, testPath)).entries).toEqual(aiGrounding(legacyTrace([], [passingText('Cached trace')])));
    });

    it('c: rejects success after a rejection followed by a failed assertion', async () => {
      const { outcome } = await runAfterRecoverableRejection(
        (request) => request.controller.evaluateAssert(passingText('Not yet visible')).then(() => undefined),
        { assertOutcomes: [{ passed: false, message: 'Not yet visible.' }] },
      );
      expect(outcome.results[0]?.result.explanation).toBe('The AI-directed interaction completed without terminal verification evidence.');
    });

    it('d: clears the barrier only after a new tagged passing assertion and records its trace', async () => {
      const { outcome, storage, testPath } = await runAfterRecoverableRejection(
        (request) => request.controller.evaluateAssert(passingText('Dashboard'), 'dashboard-reached').then(() => undefined),
      );
      expect(outcome.results[0]?.result.status).toBe('passed');
      expect((await readGrounding(storage, testPath)).entries).toEqual(aiGrounding(coveredTrace([], [passingText('Dashboard')])));
    });
  });

  it.each([
    ['a terminal snapshot', async (request: AiAgenticRequest) => request.controller.snapshotForResolution()],
    ['a terminal failed assertion', async (request: AiAgenticRequest) => request.controller.evaluateAssert(passingText('Not yet visible'))],
  ] as const)('allows %s on a cold start without writing an empty grounding entry', async (_description, terminalObservation) => {
    const session = createFakeBrowserSession(new Map(), {
      assertOutcome: { passed: false, message: 'Not yet visible.' },
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await terminalObservation(request);
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(recordingStorage.writes).toEqual([]);
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual({});
  });

  it.each([
    ['a terminal snapshot', async (request: AiAgenticRequest) => request.controller.snapshotForResolution(), [{ passed: false, message: 'Cached trace missed.' }] as const],
    ['a terminal failed assertion', async (request: AiAgenticRequest) => request.controller.evaluateAssert(passingText('Fresh miss')), [
      { passed: false, message: 'Cached trace missed.' },
      { passed: false, message: 'Fresh miss.' },
    ] as const],
  ] as const)('deletes a stale replay trace when fallback ends with %s and no new replayable trace', async (_description, terminalObservation, assertOutcomes) => {
    const staleTrace = legacyTrace([], [passingText('Cached trace')]);
    const session = createFakeBrowserSession(new Map(), { assertOutcomes });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await terminalObservation(request);
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()], aiGrounding(staleTrace));
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(recordingStorage.writes).toHaveLength(1);
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual({});
  });

  it('overwrites a behavioral-miss trace with fresh terminal verification rather than merging journals', async () => {
    const staleTrace = coveredTrace([{ type: 'navigate', url: '/stale' }], [passingText('Stale')]);
    const session = createFakeBrowserSession(new Map(), { assertOutcomes: [
      { passed: false, message: 'Stale trace missed.' },
      { passed: true },
    ] });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'navigate', url: '/fresh' });
        await request.controller.evaluateAssert(passingText('Fresh'), 'dashboard-reached');
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()], aiGrounding(staleTrace));

    await expect(run(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({ results: [{ result: { status: 'passed' } }] });

    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual(aiGrounding(coveredTrace(
      [{ type: 'navigate', url: '/fresh' }],
      [passingText('Fresh')],
    )));
  });

  it.each([
    ['a provider outcome of failure', async (_request: AiAgenticRequest) => ({ outcome: 'failure' as const })],
    ['a provider rejection', async () => {
      throw new Error('The provider transport disconnected.');
    }],
    ['cancellation after partial observations', async (request: AiAgenticRequest, controller: AbortController) => {
      controller.abort(new Error('Stop the agentic call.'));
      return { outcome: 'success' as const };
    }],
  ] as const)('discards partial journal observations and leaves prior grounding untouched after %s', async (_description, finish) => {
    const staleTrace = coveredTrace([], [passingText('Cached trace')]);
    const abortController = new AbortController();
    const session = createFakeBrowserSession(new Map(), { assertOutcomes: [
      { passed: false, message: 'Cached trace missed.' },
      { passed: true },
    ] });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'navigate', url: '/partial' });
        await request.controller.evaluateAssert(passingText('Partial success'));
        return finish(request, abortController);
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
      signal: abortController.signal,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()], aiGrounding(staleTrace));
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    // SPEC-16: an explicit cancellation ends the case as interrupted.
    expect(outcome.results[0]?.result.status).toBe('error');
    expect(recordingStorage.writes).toEqual([]);
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual(aiGrounding(staleTrace));
  });
});

describe('run deterministic redaction boundary', () => {
  it('redacts a path-A fill-secret value from a later text-equals assertion failure', async () => {
    const secretRef = '{{secrets.AMBERCAST_SECRET_DUMMY_PATH_A}}';
    const secretValue = 'AMBERCAST_SECRET_DUMMY_PATH_A_VALUE';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: `The visible account is ${secretValue}.` },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-path-a-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'assert-path-a-account', kind: 'assert', check: 'text-equals', target: PASSWORD, text: 'Signed in' },
    ], elementGrounding(['fill-path-a-secret', 'assert-path-a-account']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result).toMatchObject({
      status: 'failed',
      explanation: `The visible account is ${secretRef}.`,
      steps: [
        { id: 'fill-path-a-secret', status: 'passed' },
        { id: 'assert-path-a-account', status: 'failed', kind: 'assertion' },
      ],
    });
  });

  it('redacts a deterministic IntegrityViolationError from both the case result and rendered report', async () => {
    const secretRef = '{{secrets.AMBERCAST_SECRET_DUMMY_INTEGRITY}}';
    const secretValue = 'AMBERCAST_SECRET_DUMMY_INTEGRITY_VALUE';
    const rawMessage = `Deterministic action rejected ${secretValue}.`;
    const redactedMessage = `Deterministic action rejected ${secretRef}.`;
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      onPerform(action) {
        if (action.type === 'navigate') {
          throw new IntegrityViolationError(rawMessage, {
            materializedSecret: secretValue,
            observed: [secretValue],
          }, {
            cause: new Error(`Underlying browser diagnostic contains ${secretValue}.`),
          });
        }
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-integrity-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'throw-integrity-error', kind: 'action', action: 'navigate', url: '/dashboard' },
    ], elementGrounding(['fill-integrity-secret']));

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const caseOutcome = outcome.results[0];
    const report = buildRunReport({
      startedAt: '2026-08-10T00:00:00Z',
      durationMs: 0,
      options: { allowEmpty: false, list: false },
      outcome,
    });

    expect({
      explanation: caseOutcome?.result.explanation,
      errorMessage: caseOutcome?.error?.message,
      reportMessage: report.envelope.errors[0]?.message,
      details: caseOutcome?.error?.details,
      cause: caseOutcome?.error?.cause,
    }).toStrictEqual({
      explanation: redactedMessage,
      errorMessage: redactedMessage,
      reportMessage: redactedMessage,
      details: { materializedSecret: secretRef, observed: [secretRef] },
      cause: undefined,
    });
  });

  it('omits a function-valued detail before its own toJSON can serialize a resolved secret', async () => {
    const secretRef = '{{secrets.AMBERCAST_SECRET_DUMMY_UNSUPPORTED_DETAIL}}';
    const secretValue = 'AMBERCAST_SECRET_DUMMY_UNSUPPORTED_DETAIL_VALUE';
    const unsupportedValue = Object.assign(
      () => undefined,
      { toJSON: () => secretValue },
    );
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      onPerform(action) {
        if (action.type === 'navigate') {
          throw new IntegrityViolationError('Deterministic action rejected an unsupported diagnostic value.', {
            unsupportedValue,
          });
        }
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-unsupported-detail-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'throw-unsupported-detail-error', kind: 'action', action: 'navigate', url: '/dashboard' },
    ], elementGrounding(['fill-unsupported-detail-secret']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error?.details).toStrictEqual({
      unsupportedValue: '[unsupported-value-omitted]',
    });
    expect(JSON.stringify(outcome.results[0])).not.toContain(secretValue);
  });

  it('omits a cyclic detail reference without throwing while classifying the error', async () => {
    const cyclicDetails: Record<string, unknown> = {};
    cyclicDetails.self = cyclicDetails;
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      onPerform(action) {
        if (action.type === 'navigate') {
          throw new IntegrityViolationError('Deterministic action rejected cyclic diagnostics.', cyclicDetails);
        }
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'throw-cyclic-detail-error', kind: 'action', action: 'navigate', url: '/dashboard' },
    ], elementGrounding([]));

    const runOutcome = run(deps, DEFAULT_OPTIONS);

    await expect(runOutcome).resolves.toMatchObject({
      results: [{ result: { status: 'error' } }],
    });
    const outcome = await runOutcome;
    expect(outcome.results[0]?.error?.details).toStrictEqual({
      self: '[unsupported-value-omitted]',
    });
  });

  it('omits details beyond the defensive redaction-depth limit without throwing', async () => {
    const deeplyNestedDetails: Record<string, unknown> = {};
    let current: Record<string, unknown> | unknown[] = deeplyNestedDetails;
    for (let depth = 0; depth < 25; depth += 1) {
      const next: Record<string, unknown> | unknown[] = depth % 2 === 0 ? {} : [];
      if (Array.isArray(current)) {
        current.push(next);
      } else {
        current.child = next;
      }
      current = next;
    }

    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      onPerform(action) {
        if (action.type === 'navigate') {
          throw new IntegrityViolationError('Deterministic action rejected deeply nested diagnostics.', deeplyNestedDetails);
        }
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'throw-deep-detail-error', kind: 'action', action: 'navigate', url: '/dashboard' },
    ], elementGrounding([]));

    const runOutcome = run(deps, DEFAULT_OPTIONS);

    await expect(runOutcome).resolves.toMatchObject({
      results: [{ result: { status: 'error' } }],
    });
    const outcome = await runOutcome;
    let redactedDetail: unknown = outcome.results[0]?.error?.details;
    for (let depth = 0; depth <= 20; depth += 1) {
      expect(redactedDetail).toBeTypeOf('object');
      redactedDetail = Array.isArray(redactedDetail)
        ? redactedDetail[0]
        : (redactedDetail as Record<string, unknown>).child;
    }
    expect(redactedDetail).toBe('[unsupported-value-omitted]');
  });

  it('retains the fixed generic explanation for a plain deterministic Error without inspecting its secret-bearing message', async () => {
    const secretRef = '{{secrets.AMBERCAST_SECRET_DUMMY_GENERIC}}';
    const secretValue = 'AMBERCAST_SECRET_DUMMY_GENERIC_VALUE';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      onPerform(action) {
        if (action.type === 'navigate') {
          throw new Error(`Plain browser error exposed ${secretValue}.`);
        }
      },
    });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-generic-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'throw-generic-error', kind: 'action', action: 'navigate', url: '/dashboard' },
    ], elementGrounding(['fill-generic-secret']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]).toMatchObject({
      result: {
        status: 'error',
        explanation: 'The browser session could not complete this case and no deterministic fallback is available (Error).',
      },
    });
    expect(outcome.results[0]?.error).toBeUndefined();
    expect(outcome.results[0]?.result.explanation).not.toContain(secretValue);
    const rejection = events.emitted().find((event) => event.type === 'unclassified-rejection');
    expect(rejection).toMatchObject({
      type: 'unclassified-rejection', file: `${TEST_DIR}/login.test.md`, stepId: 'throw-generic-error',
      name: 'Error', message: `Plain browser error exposed ${secretRef}.`,
    });
    expect(rejection).toMatchObject({ stack: expect.stringContaining(secretRef) });
    expect(JSON.stringify(rejection)).not.toContain(secretValue);
  });

  it.each([
    ['TimeoutError', new (class TimeoutError extends Error { constructor() { super('timeout'); this.name = 'TimeoutError'; } })(), 'TimeoutError', 'timeout'],
    ['disallowed FooError', new (class FooError extends Error { constructor() { super('foo'); this.name = 'FooError'; } })(), 'Error', 'foo'],
    ['empty Error name', Object.assign(new Error('empty'), { name: '' }), 'Error', 'empty'],
    ['non-Error throw', 'string', 'Error', 'string'],
    ['hostile message getter', Object.create(null, { name: { value: 'FooError' }, message: { get() { throw new Error('hostile'); } } }), 'Error', 'unavailable'],
  ] as const)('TEST-7 projects %s to a safe generic explanation and diagnostic event', async (_label, thrown, projectedName, message) => {
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      onPerform(action) {
        if (action.type === 'navigate') throw thrown;
      },
    });
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'throw-derived-generic-error', kind: 'action', action: 'navigate', url: '/dashboard' },
    ], elementGrounding([]));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.explanation).toBe(
      `The browser session could not complete this case and no deterministic fallback is available (${projectedName}).`,
    );
    expect(events.emitted()).toContainEqual(expect.objectContaining({
      type: 'unclassified-rejection', stepId: 'throw-derived-generic-error', name: projectedName, message,
    }));
  });

  it('retains rotating path-A and first-pipeline secret values for a second independent AI pipeline', async () => {
    const secretRef = '{{secrets.AMBERCAST_SECRET_DUMMY_ROTATING_ACROSS_PIPELINES}}';
    const secretValues = [
      'AMBERCAST_SECRET_DUMMY_ROTATING_ACROSS_PIPELINES_FIRST_VALUE',
      'AMBERCAST_SECRET_DUMMY_ROTATING_ACROSS_PIPELINES_SECOND_VALUE',
    ] as const;
    let resolutionIndex = 0;
    const resolve = vi.fn((ref: string) => {
      expect(ref).toBe(secretRef);
      const value = secretValues[resolutionIndex];
      resolutionIndex += 1;
      return value;
    });
    let secondPipelineDiagnostic: string | undefined;
    let agenticInvocation = 0;
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcomes: [
        { passed: true, message: 'The first AI pipeline completed.' },
        {
          passed: true,
          message: `The second AI pipeline observed ${secretValues[0]} before ${secretValues[1]}.`,
        },
        {
          passed: false,
          message: `The final deterministic assertion observed ${secretValues[0]} before ${secretValues[1]}.`,
        },
      ],
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        if (agenticInvocation === 0) {
          agenticInvocation += 1;
          await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
          await evaluateTerminalAssert(request, passingText('First AI pipeline verification'));
          return { outcome: 'success' };
        }

        if (agenticInvocation === 1) {
          agenticInvocation += 1;
          const outcome = await evaluateTerminalAssert(request, passingText('Second AI pipeline diagnostic'));
          secondPipelineDiagnostic = outcome.message;
          return { outcome: 'success' };
        }

        throw new Error('The scenario permits exactly two agentic executions.');
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: { resolve },
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-path-a-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      aiStep('resolve-rotated-secret', [secretRef]),
      aiStep('observe-rotated-secrets'),
      // SPEC-17: keep this diagnostic fixture to its first failed observation.
      { id: 'assert-after-pipelines', kind: 'assert', check: 'text-equals', target: PASSWORD, text: 'Signed in', timeoutMs: 0 },
    ], elementGrounding(['fill-path-a-secret', 'assert-after-pipelines']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(executor.agenticRequests).toHaveLength(2);
    expect(executor.agenticRequests[0]?.controller).not.toBe(executor.agenticRequests[1]?.controller);
    expect(secondPipelineDiagnostic).toBe(`The second AI pipeline observed ${secretRef} before ${secretRef}.`);
    expect(outcome.results[0]?.result.explanation).toBe(`The final deterministic assertion observed ${secretRef} before ${secretRef}.`);
  });

  it('retains a trace-replay secret for a later deterministic assertion failure', async () => {
    const secretRef = '{{secrets.AMBERCAST_SECRET_DUMMY_TRACE_REPLAY}}';
    const secretValue = 'AMBERCAST_SECRET_DUMMY_TRACE_REPLAY_VALUE';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcomes: [
        { passed: true, message: 'Cached trace verification passed.' },
        { passed: false, message: `Later deterministic observation contains ${secretValue}.` },
      ],
    });
    const { deps, recordingStorage, resolveAiExecutor } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      aiStep('replay-secret-trace', [secretRef]),
      { id: 'assert-after-trace-replay', kind: 'assert', check: 'text-equals', target: PASSWORD, text: 'Signed in', timeoutMs: 0 },
    ], {
      'replay-secret-trace': {
        kind: 'ai',
        trace: coveredTrace(
          [{ type: 'fill-secret', element: PASSWORD, secretRef }],
          [passingText('Cached trace verification')],
        ),
      },
      ...elementGrounding(['assert-after-trace-replay']),
    });

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(outcome.results[0]?.result.explanation).toBe(`Later deterministic observation contains ${secretRef}.`);
  });
});

describe('run agentic materialization boundary', () => {
  it('redacts secret and run values from an agentic resolution snapshot and omits screenshot bytes', async () => {
    const secretRef = '{{secrets.AMBERCAST_SECRET_DUMMY_SNAPSHOT}}';
    const secretValue = 'AMBERCAST_SECRET_DUMMY_SNAPSHOT_VALUE';
    const runValue = 'RUN_SNAPSHOT_VALUE';
    const snapshot = {
      accessibilityTree: {
        role: 'document',
        [`Secret label ${secretValue}`]: {
          name: `Visible ${secretValue} beside ${runValue}.`,
          children: [{
            role: 'text',
            name: 'Public content',
            count: 3,
            checked: false,
            nested: { empty: '', enabled: true },
          }],
        },
      },
      screenshot: new Uint8Array([4, 5, 6]),
    };
    let resolutionSnapshot: Awaited<ReturnType<AiAgenticRequest['controller']['snapshotForResolution']>> | undefined;
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: runValue, value: '' }]]),
      snapshot,
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        resolutionSnapshot = await request.controller.snapshotForResolution();
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
      aiStep('agentic-snapshot', [secretRef]),
    ], elementGrounding(['capture-token']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    if (resolutionSnapshot === undefined) {
      throw new Error('The agentic executor did not receive a resolution snapshot.');
    }
    expect(resolutionSnapshot).toStrictEqual({
      accessibilityTree: {
        role: 'document',
        [`Secret label ${secretRef}`]: {
          name: `Visible ${secretRef} beside {{run.token}}.`,
          children: [{
            role: 'text',
            name: 'Public content',
            count: 3,
            checked: false,
            nested: { empty: '', enabled: true },
          }],
        },
      },
    });
  });

  it('redacts overlapping secret and run values from grounding, results, errors, details, and events after proving each surface is populated', async () => {
    const secretRef = '{{secrets.auth.token}}';
    const secretValue = 'SECRET-RUN-SENTINEL';
    const runValue = 'RUN-SENTINEL';
    let adapterMessage: string | undefined;
    const successfulSession = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: runValue, value: '' }]]),
      assertOutcome: { passed: true, message: `Observed ${secretValue} beside ${runValue}.` },
    });
    const successfulExecutor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        const assertion = await evaluateTerminalAssert(request, {
          type: 'assert',
          check: 'text-visible',
          text: '{{run.token}}',
        });
        adapterMessage = assertion.message;
        return { outcome: 'success' };
      },
    });
    const successful = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => successfulSession)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor: async () => successfulExecutor,
    });
    const successfulPath = await writePrompt(
      successful.recordingStorage.storage,
      'login.test.md',
      PROMPT,
    );
    await seedFreshArtifacts(successful.recordingStorage.storage, successfulPath, [
      { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
      aiStep('recorded-ai', [secretRef]),
    ], elementGrounding(['capture-token']));

    const successfulOutcome = await run(successful.deps, DEFAULT_OPTIONS);
    const successfulGroundingText = await successful.recordingStorage.storage.readText(
      `${TEST_DIR}/login.ambercast.grounding.json`,
    );

    expect((await readGrounding(successful.recordingStorage.storage, successfulPath)).entries['recorded-ai']).toMatchObject({
      kind: 'ai',
      trace: {
        events: [{ type: 'fill-secret', secretRef }],
        verification: [passingText('{{run.token}}')],
        verificationCoverage: { 'dashboard-reached': 0 },
      },
    });
    expect(adapterMessage).toBe(`Observed ${secretRef} beside {{run.token}}.`);
    expect(successfulOutcome.results[0]?.result).toMatchObject({
      status: 'passed',
      steps: [
        { id: 'capture-token', status: 'passed' },
        { id: 'recorded-ai', status: 'passed' },
      ],
    });
    expect(aiCalls(successful.events)).toEqual([expectedAiCall('ai-1', 'recorded-ai')]);
    expect(successful.events.emitted().filter((event) => event.type === 'step-result' && event.stepId === 'recorded-ai')).toEqual([
      { type: 'step-result', stepId: 'recorded-ai', via: 'ai-resolve' },
    ]);

    const failingSession = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: runValue, value: '' }]]),
      onPerform(action) {
        if (action.type === 'fill') {
          throw new IntegrityViolationError(`Browser rejected ${secretValue} and ${runValue}.`, {
            secret: secretValue,
            run: runValue,
          });
        }
      },
    });
    const failingExecutor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        await request.controller.perform({ type: 'fill', element: EMAIL, value: '{{run.token}}' });
        return { outcome: 'success' };
      },
    });
    const failing = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => failingSession)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor: async () => failingExecutor,
    });
    const failingPath = await writePrompt(
      failing.recordingStorage.storage,
      'login.test.md',
      PROMPT,
    );
    await seedFreshArtifacts(failing.recordingStorage.storage, failingPath, [
      { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
      aiStep('recorded-ai', [secretRef]),
    ], elementGrounding(['capture-token']));

    const failingOutcome = await run(failing.deps, DEFAULT_OPTIONS);
    const failure = failingOutcome.results[0]?.error;

    expect(failure).toBeInstanceOf(IntegrityViolationError);
    expect(failure?.message).toBe(`Browser rejected ${secretRef} and {{run.token}}.`);
    expect(failure?.details).toEqual({ secret: secretRef, run: '{{run.token}}' });
    expect(failure?.cause).toBeUndefined();
    expect(failingOutcome.results[0]?.result).toMatchObject({
      status: 'error',
      explanation: `Browser rejected ${secretRef} and {{run.token}}.`,
      steps: [
        { id: 'capture-token', status: 'passed' },
        { id: 'recorded-ai', status: 'error', kind: 'environment' },
      ],
    });
    expect(aiCalls(failing.events)).toEqual([expectedAiCall('ai-1', 'recorded-ai')]);
    for (const surface of [
      successfulGroundingText,
      JSON.stringify(successfulOutcome.results[0]?.result),
      failure?.message ?? '',
      JSON.stringify(failure?.details ?? {}),
      JSON.stringify(failingOutcome.results[0]?.result),
      JSON.stringify(successful.events.emitted()),
      JSON.stringify(failing.events.emitted()),
    ]) {
      expect(surface).not.toContain(secretValue);
      expect(surface).not.toContain(runValue);
    }
  });

  it.each([
    ['a captured run value', async (request: AiAgenticRequest) => {
      await request.controller.perform({ type: 'navigate', url: 'RUN-LITERAL-SENTINEL' });
    }],
    ['a resolved secret value', async (request: AiAgenticRequest) => {
      await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef: '{{secrets.auth.literal}}' });
      await request.controller.perform({ type: 'fill', element: EMAIL, value: 'SECRET-LITERAL-SENTINEL' });
    }],
  ] as const)('rejects a provider echo of %s as a literal before it reaches the browser journal', async (_description, script) => {
    const secretRef = '{{secrets.auth.literal}}';
    const runValue = 'RUN-LITERAL-SENTINEL';
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: runValue, value: '' }]]),
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await script(request);
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, 'SECRET-LITERAL-SENTINEL']])),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
      aiStep('recorded-ai', [secretRef]),
    ], elementGrounding(['capture-token']));
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(recordingStorage.writes).toEqual([]);
    expect(session.operations().filter((operation) => (
      operation.type === 'perform' || operation.type === 'fill-secret'
    ))).toEqual(
      _description === 'a captured run value'
        ? []
        : [{ type: 'fill-secret', target: boundTarget(PASSWORD, FINGERPRINT), value: 'SECRET-LITERAL-SENTINEL', policy: baseUrlSecretPolicy(secretRef, TARGETS.web) }],
    );
  });

  it.each([
    ['an empty secret', '', 'ordinary provider text', 'passed'],
    ['a one-character secret as a substring', 'x', 'prefix-xsuffix', 'passed'],
    ['a one-character secret as an exact value', 'x', 'x', 'rejected'],
    ['a two-character secret as a substring', 'xy', 'prefix-xysuffix', 'passed'],
    ['a two-character secret as an exact value', 'xy', 'xy', 'rejected'],
    ['a three-character secret as a substring', 'xyz', 'prefix-xyzsuffix', 'rejected'],
    ['a four-character secret as a substring', 'wxyz', 'prefix-wxyzsuffix', 'rejected'],
  ] as const)('applies the resolved-secret boundary matrix to %s', async (_description, secretValue, candidate, expectation) => {
    const secretRef = '{{secrets.AMBERCAST_SECRET_DUMMY}}';
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]));
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        await request.controller.perform({ type: 'fill', element: EMAIL, value: candidate });
        await evaluateTerminalAssert(request, passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep('recorded-ai', [secretRef])]);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    if (expectation === 'rejected') {
      expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
      expect(recordingStorage.writes).toEqual([]);
      expect(session.operations()).toEqual([
        expect.objectContaining({
          type: 'resolve-grounded',
          target: PASSWORD,
          query: expect.objectContaining({ mode: 'compute' }),
        }),
        { type: 'fill-secret', target: boundTarget(PASSWORD, FINGERPRINT), value: secretValue, policy: baseUrlSecretPolicy(secretRef, TARGETS.web) },
      ]);
      return;
    }

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(recordingStorage.writes).toHaveLength(1);
  });

  it.each([
    ['navigate URL', async (request: AiAgenticRequest, runValue: string) => {
      await request.controller.perform({ type: 'navigate', url: `/users/${runValue}/settings` });
    }],
    ['fill value', async (request: AiAgenticRequest, runValue: string) => {
      await request.controller.perform({ type: 'fill', element: PASSWORD, value: `welcome-${runValue}` });
    }],
    ['assertion text', async (request: AiAgenticRequest, runValue: string) => {
      await request.controller.evaluateAssert({ type: 'assert', check: 'text-visible', text: `Welcome ${runValue}.` });
    }],
    ['assertion URL pattern', async (request: AiAgenticRequest, runValue: string) => {
      await request.controller.evaluateAssert({ type: 'assert', check: 'url-matches', pattern: `/users/${runValue}/.*` });
    }],
  ] as const)('keeps captured run-state values exact-match-only for %s', async (_description, script) => {
    const runValue = 'AMBERCAST_SECRET_DUMMY_RUN_VALUE';
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: runValue, value: '' }]]),
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await script(request, runValue);
        await request.controller.perform({ type: 'navigate', url: '/dashboard' });
        await evaluateTerminalAssert(request, passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
        aiStep(),
      ],
      elementGrounding(['capture-token']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(outcome.results[0]?.error).toBeUndefined();
  });

  it.each([
    ['an empty secret value', '', undefined, 'empty secret marker'],
    ['an empty run value', undefined, '', 'empty run marker'],
  ] as const)('does not template %s in an assertion diagnostic', async (_description, secretValue, runValue, message) => {
    const secretRef = '{{secrets.auth.empty}}';
    let adapterMessage: string | undefined;
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: runValue ?? 'unused', value: '' }]]),
      assertOutcome: { passed: true, message },
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        if (secretValue !== undefined) {
          await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        }
        const outcome = await evaluateTerminalAssert(request, passingText('Visible'));
        adapterMessage = outcome.message;
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue ?? 'unused']])),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(
      recordingStorage.storage,
      'login.test.md',
      PROMPT,
    );
    const steps: TestStep[] = secretValue === undefined
      ? [
        { id: 'capture-empty', kind: 'capture', target: EMAIL, variable: 'empty' },
        aiStep('recorded-ai'),
      ]
      : [aiStep('recorded-ai', [secretRef])];
    const entries = secretValue === undefined ? elementGrounding(['capture-empty']) : {};
    await seedFreshArtifacts(recordingStorage.storage, testPath, steps, entries);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(adapterMessage).toBe(message);
  });

  it('templates repeated diagnostics longest-first with the secret-before-run tie-break', async () => {
    const shortRun = 'prefix';
    const tiedValue = 'same';
    const longValue = 'prefix-long';
    const tiedSecretRef = '{{secrets.auth.tied}}';
    const longSecretRef = '{{secrets.auth.long}}';
    let adapterMessage: string | undefined;
    const session = createFakeBrowserSession(liveEntries([EMAIL, SUBMIT, PASSWORD]), {
      captureValues: new Map([
        [elementRefKey(EMAIL), { text: shortRun, value: '' }],
        [elementRefKey(SUBMIT), { text: tiedValue, value: '' }],
      ]),
      assertOutcome: { passed: true, message: `${longValue} ${shortRun} ${tiedValue} ${tiedValue}` },
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef: tiedSecretRef });
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef: longSecretRef });
        const outcome = await evaluateTerminalAssert(request, passingText('Visible'));
        adapterMessage = outcome.message;
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([
        [tiedSecretRef, tiedValue],
        [longSecretRef, longValue],
      ])),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(
      recordingStorage.storage,
      'login.test.md',
      PROMPT,
    );
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'capture-prefix', kind: 'capture', target: EMAIL, variable: 'prefix' },
      { id: 'capture-same', kind: 'capture', target: SUBMIT, variable: 'same' },
      aiStep('recorded-ai', [tiedSecretRef, longSecretRef]),
    ], elementGrounding(['capture-prefix', 'capture-same']));

    await expect(run(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({ results: [{ result: { status: 'passed' } }] });

    expect(adapterMessage).toBe(`${longSecretRef} {{run.prefix}} ${tiedSecretRef} ${tiedSecretRef}`);
  });
});

describe('run per-case grounding flush and dispatch wiring', () => {
  it('surfaces a grounding flush failure as FsIoError after an otherwise-clean agentic case', async () => {
    const session = createFakeBrowserSession(new Map());
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await evaluateTerminalAssert(request, passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);
    const writeText = vi.spyOn(recordingStorage.storage, 'writeText').mockRejectedValueOnce(new Error('disk full'));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(outcome.results[0]?.error).toBeInstanceOf(FsIoError);
    expect(outcome.results[0]?.error).toMatchObject({ kind: 'fs-io-error', exitCode: 3 });
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      explanation: 'The grounding cache could not be written.',
      steps: [{ id: 'recorded-ai', status: 'passed' }],
    });
    expect(outcome.results[0]?.result.steps[0]).not.toHaveProperty('screenshot');
    expect(outcome.results[0]?.result.steps[0]).not.toHaveProperty('screenshotOmitted');
    expect(outcome.results[0]?.result.steps[0]).not.toHaveProperty('observed');
  });

  it('redacts a resolved secret and drops the cause when a grounding flush fails', async () => {
    const secretRef = '{{secrets.AMBERCAST_SECRET_DUMMY_GROUNDING_FLUSH}}';
    const secretValue = 'AMBERCAST_SECRET_DUMMY_GROUNDING_FLUSH_VALUE';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]));
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        await evaluateTerminalAssert(request, passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep('recorded-ai', [secretRef])]);
    const storageFailure = new Error(`The storage backend rejected ${secretValue}.`, {
      cause: new Error(`The filesystem diagnostic contains ${secretValue}.`),
    });
    const writeText = vi.spyOn(recordingStorage.storage, 'writeText').mockRejectedValueOnce(storageFailure);

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const caseOutcome = outcome.results[0];

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(session.operations()).toContainEqual({
      type: 'fill-secret',
      target: boundTarget(PASSWORD, FINGERPRINT),
      value: secretValue,
      policy: baseUrlSecretPolicy(secretRef, TARGETS.web),
    });
    expect({
      errorMessage: caseOutcome?.error?.message,
      errorCause: caseOutcome?.error?.cause,
      explanation: caseOutcome?.result.explanation,
    }).toStrictEqual({
      errorMessage: 'The grounding cache could not be written.',
      errorCause: undefined,
      explanation: 'The grounding cache could not be written.',
    });
    expect(JSON.stringify(caseOutcome)).not.toContain(secretValue);
  });

  it('does not let a flush failure override an execution failure after a prior successful grounding mutation', async () => {
    const session = createFakeBrowserSession(new Map(), {
      onPerform(action) {
        if (action.type === 'navigate') {
          throw new Error('The next deterministic step failed.');
        }
      },
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await evaluateTerminalAssert(request, passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      aiStep(),
      { id: 'later-failure', kind: 'action', action: 'navigate', url: '/later' },
    ]);
    const writeText = vi.spyOn(recordingStorage.storage, 'writeText').mockRejectedValueOnce(new Error('disk full'));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(outcome.results[0]?.error).toBeUndefined();
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      explanation: 'The browser session could not complete this case and no deterministic fallback is available (Error).',
      steps: [
        { id: 'recorded-ai', status: 'passed' },
        { id: 'later-failure', status: 'error', kind: 'environment' },
      ],
    });
  });

  it('flushes a successful earlier grounding mutation even when a later step in the same case fails', async () => {
    const session = createFakeBrowserSession(new Map(), {
      onPerform(action) {
        if (action.type === 'navigate') {
          throw new Error('The next deterministic step failed.');
        }
      },
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await evaluateTerminalAssert(request, passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      aiStep(),
      { id: 'later-failure', kind: 'action', action: 'navigate', url: '/later' },
    ]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('error');
    expect((await readGrounding(recordingStorage.storage, testPath)).entries).toEqual(aiGrounding(coveredTrace(
      [],
      [passingText('Dashboard')],
    )));
  });

  it('memoizes one lazy executor across path-C and path-B fallbacks while incrementally granting earlier captures', async () => {
    const capturedValue = 'Ari';
    const snapshot = pathBSnapshot();
    const session = createFakeBrowserSession(new Map([
      [elementRefKey(EMAIL), { exists: true, currentFingerprint: FINGERPRINT }],
      [elementRefKey(SUBMIT), { exists: true, currentFingerprint: pathBFingerprint(snapshot.accessibilityTree) }],
    ]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: capturedValue, value: '' }]]),
      snapshot,
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        expect(request.allowedRunRefs).toEqual(['name']);
        await evaluateTerminalAssert(request, { type: 'assert', check: 'text-visible', text: '{{run.name}}' });
        return { outcome: 'success' };
      },
      execute: () => ({ data: { confirmed: true }, raw: '{"confirmed":true}' }),
    });
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'capture-name', kind: 'capture', target: EMAIL, variable: 'name' },
      aiStep(),
      { id: 'click-submit', kind: 'action', action: 'click', target: SUBMIT },
    ], elementGrounding(['capture-name', 'click-submit']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result).toMatchObject({ status: 'passed', aiCalls: 2 });
    expect(resolveAiExecutor).toHaveBeenCalledTimes(1);
    expect(executor.agenticRequests).toHaveLength(1);
    expect(executor.structuredRequests).toHaveLength(1);
    expect(aiCalls(events)).toEqual([
      expectedAiCall('ai-1', 'recorded-ai'),
      expectedAiCall('ai-2', 'click-submit'),
    ]);
    expect(aiResults(events)).toEqual([
      { type: 'ai-result', callId: 'ai-1', durationMs: 0, outcome: 'ok' },
      { type: 'ai-result', callId: 'ai-2', durationMs: 0, outcome: 'ok' },
    ]);
    expect(events.emitted().filter((event) => event.type === 'step-result')).toEqual([
      { type: 'step-result', stepId: 'capture-name', via: 'grounding' },
      { type: 'step-result', stepId: 'recorded-ai', via: 'ai-resolve' },
      { type: 'step-result', stepId: 'click-submit', via: 'ai-resolve' },
    ]);
  });
});

describe('run grounding write-back posture integration', () => {
  it.each([
    ['local auto without update', false, 'auto', false, false, true],
    ['local auto with update', false, 'auto', true, false, true],
    ['local explicit without update', false, 'explicit', false, false, false],
    ['local explicit with update', false, 'explicit', true, false, true],
    ['CI auto without an opt-in', true, 'auto', false, false, false],
    ['CI auto with update', true, 'auto', true, false, true],
    ['CI auto with configured opt-in', true, 'auto', false, true, true],
    ['CI explicit without an opt-in', true, 'explicit', false, false, false],
    ['local explicit ignores the CI config opt-in', false, 'explicit', false, true, false],
    ['CI explicit accepts the CI config opt-in', true, 'explicit', false, true, true],
  ] as const)('attempts grounding write-back only when allowed for %s', async (_name, isCI, localWriteBack, updateCache, updateGroundingCache, allowed) => {
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await evaluateTerminalAssert(request, passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      isCI,
      config: {
        ...configWithAiTimeout(120_000),
        ci: { heal: false, updateGroundingCache },
        grounding: { repositoryPolicy: 'committed', localWriteBack },
      },
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, updateCache });
    const groundingWrites = recordingStorage.writes.filter(({ path }) => path === deps.layout.groundingPathFor(testPath));

    expect(groundingWrites).toHaveLength(allowed ? 1 : 0);
    expect(outcome.results[0]?.result.status).toBe('passed');
  });

  it('skips both the secret scan and write-error reclassification when explicit local write-back lacks --update-cache', async () => {
    const secretRef = '{{secrets.grounding_write_back}}';
    const secretValue = 'grounding-write-back-secret';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]));
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill', element: PASSWORD, value: secretValue });
        await evaluateTerminalAssert(request, passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor: async () => executor,
      config: {
        ...configWithAiTimeout(120_000),
        secrets: { allow: ['grounding_write_back'] },
        grounding: { repositoryPolicy: 'committed', localWriteBack: 'explicit' },
      },
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep('recorded-ai', [secretRef])]);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(recordingStorage.writes.filter(({ path }) => path === deps.layout.groundingPathFor(testPath))).toHaveLength(0);
    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(outcome.results[0]?.error).toBeUndefined();
  });

  it('keeps the not-dirty short-circuit ahead of every write-back gate input', async () => {
    const { deps, recordingStorage } = createScenario({
      isCI: true,
      config: {
        ...configWithAiTimeout(120_000),
        ci: { heal: false, updateGroundingCache: true },
        grounding: { repositoryPolicy: 'committed', localWriteBack: 'explicit' },
      },
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath);
    recordingStorage.writes.length = 0;

    await run(deps, { ...DEFAULT_OPTIONS, updateCache: true });

    expect(recordingStorage.writes.filter(({ path }) => path === deps.layout.groundingPathFor(testPath))).toHaveLength(0);
  });
});

describe('run failure evidence', () => {
  it('persists a normal assertion screenshot with real filesystem storage and a schema-valid result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ambercast-run-evidence-'));
    const testDir = join(root, 'tests');
    const runsDir = join(root, '.runs');
    const testPath = join(testDir, 'login.test.md');
    const runId = '2026-08-10T000000Z-550e8400-e29b-41d4-a716-446655440000';
    const screenshotBytes = new Uint8Array([7, 8, 9]);
    const storage = createFsStorage();
    const layout = createLayoutResolver({ testDir, runsDir });
    const planTargets = { web: { surface: 'web', baseUrl: TARGETS.web.baseUrl } } as const;

    try {
      await storage.writeText(testPath, PROMPT);
      const plan = {
        schemaVersion: 4,
        source: {
          inputsDigest: computeInputsDigest({
            normalizedTestMd: normalizeTestMd(PROMPT), schemaVersion: 4,
            generatorPromptTemplateFingerprint: promptTemplateFingerprint(), planProducerBundleFingerprint: planProducerBundleFingerprint(), targetDefinitions: planTargets,
          }),
        },
        targets: planTargets,
        steps: [
          { id: 'assert-dashboard', kind: 'assert', target: 'web', check: 'text-visible', text: 'Dashboard' },
          { id: 'later-step', kind: 'action', target: 'web', action: 'navigate', url: '/later' },
        ],
      } as unknown as PlanDocument;
      await storage.writeText(layout.planPathFor(testPath), toCanonicalArtifactText(plan as unknown as JsonValueT));
      await storage.writeText(layout.groundingPathFor(testPath), toCanonicalArtifactText({
        schemaVersion: 1, planDigest: computePlanDigest(plan), entries: {},
      } as unknown as JsonValueT));
      const session = createFakeBrowserSession(new Map(), {
        assertOutcome: { passed: false, message: 'The dashboard is absent.' },
        snapshot: { accessibilityTree: { role: 'document', name: 'Sign in' }, screenshot: screenshotBytes },
      });
      const outcome = await run({
        storage, layout, clock: createFixedClock(new Date('2026-08-10T00:00:00.000Z'), 0), runId,
        allocateCallId: createCallIdAllocator(),
        uiExecutor: () => createFakeUiExecutor(() => session), secrets: createFakeSecretsProvider(new Map()),
        resolveAiExecutor: async () => createFakeAiExecutor(), events: createRecordingEventSink().sink,
        discoverTestFiles: async () => [],
        config: { testDir, testMatch: ['**/*.test.md'], testIgnore: ['**/.runs/**'], targets: RESOLVED_TARGETS, defaultTarget: 'web', ai: { provider: 'codex', timeoutMs: 120_000, maxGenerateAttempts: 2 }, ci: { heal: false, updateGroundingCache: false }, grounding: { repositoryPolicy: 'committed', localWriteBack: 'auto' } },
        isCI: false,
      }, { files: [testPath], resolve: true, updateCache: false, allowEmpty: false, list: false, stale: 'fail' });
      const result = outcome.results[0]?.result;
      const step = result?.steps[0];
      const screenshotPath = join(runsDir, runId, 'login', 'assert-dashboard.png');

      const parsed = RunResult.safeParse(result);
      expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
      expect(step).toMatchObject({
        expected: 'Text "Dashboard" is visible.', actual: 'The dashboard is absent.', screenshot: screenshotPath,
        observed: { note: OBSERVED_NOTE, accessibilitySnapshot: '{"role":"document","name":"Sign in"}' },
      });
      expect(step).not.toHaveProperty('screenshotOmitted');
      expect(result?.steps[1]).not.toHaveProperty('screenshot');
      expect(result?.steps[1]).not.toHaveProperty('screenshotOmitted');
      expect(result?.steps[1]).not.toHaveProperty('observed');
      expect(new Uint8Array(await readFile(screenshotPath))).toEqual(screenshotBytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [{ id: 'text-visible', kind: 'assert', check: 'text-visible', text: 'Welcome' }, {}, 'Text "Welcome" is visible.'],
    [{ id: 'element-visible', kind: 'assert', check: 'element-visible', target: SUBMIT }, elementGrounding(['element-visible']), 'Element button "Submit" is visible.'],
    [{ id: 'text-equals', kind: 'assert', check: 'text-equals', target: SUBMIT, text: 'Continue' }, elementGrounding(['text-equals']), 'Element button "Submit" has text "Continue".'],
    [{ id: 'url-matches', kind: 'assert', check: 'url-matches', pattern: '/dashboard/.*' }, {}, 'URL matches "/dashboard/.*".'],
    [{ id: 'element-count', kind: 'assert', check: 'element-count', target: SUBMIT, count: 2 }, elementGrounding(['element-count']), 'Element button "Submit" has count 2.'],
  ] as const)('renders the materialized expected description for %s', async (step, entries, expected) => {
    const session = createFakeBrowserSession(liveEntries([SUBMIT]), {
      assertOutcome: { passed: false, message: 'The browser reported a mismatch.' },
    });
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [step], entries);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.steps[0]).toMatchObject({ expected, actual: 'The browser reported a mismatch.' });
  });

  it('restores a captured run reference in an expected assertion description exactly once', async () => {
    const session = createFakeBrowserSession(liveEntries([EMAIL]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: 'Ari', value: '' }]]),
      assertOutcome: { passed: false, message: 'Welcome, Ari was not visible.' },
    });
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'capture-name', kind: 'capture', target: EMAIL, variable: 'name' },
      { id: 'assert-welcome', kind: 'assert', check: 'text-visible', text: 'Welcome, {{run.name}}' },
    ], elementGrounding(['capture-name']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result).toMatchObject({
      explanation: 'Welcome, {{run.name}} was not visible.',
      steps: [{ status: 'passed' }, {
        expected: 'Text "Welcome, {{run.name}}" is visible.', actual: 'Welcome, {{run.name}} was not visible.',
      }],
    });
  });

  it('omits screenshots without touching browser or storage when raw accessibility evidence contains a resolved secret', async () => {
    const secretRef = '{{secrets.evidence}}';
    const secretValue = 'AMBERCAST_SECRET_EVIDENCE_VALUE';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: { text: `token=${secretValue}` }, screenshot: new Uint8Array([1]) },
    });
    const screenshot = vi.spyOn(session, 'screenshot');
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const writeBinary = vi.spyOn(recordingStorage.storage, 'writeBinary');
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'assert-dashboard', kind: 'assert', check: 'text-visible', text: 'Dashboard' },
    ], elementGrounding(['fill-secret']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshotOmitted: 'secret-detected' });
    expect(outcome.results[0]?.result.steps.at(-1)).not.toHaveProperty('screenshot');
    expect(screenshot).not.toHaveBeenCalled();
    expect(writeBinary).not.toHaveBeenCalled();
  });

  it('omits screenshots when only the parsed tree exactly contains a two-character resolved secret', async () => {
    const secretRef = '{{secrets.tree_only}}';
    const rawYaml = '- text: xy';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: {
        accessibilityTree: parseAriaSnapshot(rawYaml),
        screenshot: new Uint8Array([11]),
      },
      accessibilityCapture: { rawYaml },
    });
    const screenshot = vi.spyOn(session, 'screenshot');

    const outcome = await runFailureEvidenceScenario(session, new Map([[secretRef, 'xy']]));

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshotOmitted: 'secret-detected' });
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('omits screenshots for a depth-24 parsed tree that contains a two-character resolved secret', async () => {
    const secretRef = '{{secrets.deep_tree}}';
    const rawYaml = [
      ...Array.from(
        { length: 23 },
        (_, index) => `${'  '.repeat(index)}- group "Level ${index}":`,
      ),
      `${'  '.repeat(23)}- text: xy`,
    ].join('\n');
    const accessibilityTree = parseAriaSnapshot(rawYaml);

    expect(accessibilityTree).not.toBe(SNAPSHOT_INVALID);
    let deepestNode: JsonValueT = accessibilityTree;
    for (let level = 0; level < 24; level += 1) {
      expect(deepestNode).toMatchObject({ children: [expect.anything()] });
      deepestNode = (deepestNode as unknown as { readonly children: readonly JsonValueT[] }).children[0] as JsonValueT;
    }
    expect(deepestNode).toMatchObject({ name: 'xy' });

    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree, screenshot: new Uint8Array([21]) },
      accessibilityCapture: { rawYaml },
    });
    const screenshot = vi.spyOn(session, 'screenshot');
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, 'xy']])),
    });
    const writeBinary = vi.spyOn(recordingStorage.storage, 'writeBinary');
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'assert-dashboard', kind: 'assert', check: 'text-visible', text: 'Dashboard' },
    ], elementGrounding(['fill-secret']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshotOmitted: 'secret-detected' });
    expect(outcome.results[0]?.result.steps.at(-1)).not.toHaveProperty('screenshot');
    expect(screenshot).not.toHaveBeenCalled();
    expect(writeBinary).not.toHaveBeenCalled();
  });

  it('captures a screenshot for a clean depth-24 parsed tree despite a nonmatching resolved secret', async () => {
    const secretRef = '{{secrets.clean_deep_tree}}';
    const rawYaml = [
      ...Array.from(
        { length: 23 },
        (_, index) => `${'  '.repeat(index)}- group "Level ${index}":`,
      ),
      `${'  '.repeat(23)}- text: clean leaf`,
    ].join('\n');
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: parseAriaSnapshot(rawYaml), screenshot: new Uint8Array([22]) },
      accessibilityCapture: { rawYaml },
    });
    const screenshot = vi.spyOn(session, 'screenshot');

    const outcome = await runFailureEvidenceScenario(session, new Map([[secretRef, 'not-present-in-tree']]));

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshot: expect.any(String) });
    expect(outcome.results[0]?.result.steps.at(-1)).not.toHaveProperty('screenshotOmitted');
    expect(screenshot).toHaveBeenCalledOnce();
  });

  it('permits screenshot capture for a cyclic plain-object accessibility tree without a matching secret', async () => {
    const secretRef = '{{secrets.cyclic_tree}}';
    const accessibilityTree: { self?: unknown } = {};
    accessibilityTree.self = accessibilityTree;
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: accessibilityTree as JsonValueT, screenshot: new Uint8Array([23]) },
    });
    const screenshot = vi.spyOn(session, 'screenshot');

    const outcome = await runFailureEvidenceScenario(session, new Map([[secretRef, 'not-present-in-tree']]));

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshot: expect.any(String) });
    expect(outcome.results[0]?.result.steps.at(-1)).not.toHaveProperty('screenshotOmitted');
    expect(screenshot).toHaveBeenCalledOnce();
  });

  it('traverses null-prototype accessibility objects when detecting secrets', async () => {
    const secretRef = '{{secrets.null_prototype_tree}}';
    const secretValue = 'NULL-PROTOTYPE-SECRET';
    const accessibilityTree = Object.create(null) as Record<string, unknown>;
    accessibilityTree.text = secretValue;
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: accessibilityTree as JsonValueT, screenshot: new Uint8Array([24]) },
    });
    const screenshot = vi.spyOn(session, 'screenshot');

    const outcome = await runFailureEvidenceScenario(session, new Map([[secretRef, secretValue]]));

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshotOmitted: 'secret-detected' });
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('excludes secret-bearing non-plain accessibility objects from detection', async () => {
    const secretRef = '{{secrets.non_plain_tree}}';
    const secretValue = 'NON-PLAIN-OBJECT-SECRET';
    class SecretCarrier {
      readonly text = secretValue;
    }
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: new SecretCarrier() as unknown as JsonValueT, screenshot: new Uint8Array([25]) },
    });
    const screenshot = vi.spyOn(session, 'screenshot');

    const outcome = await runFailureEvidenceScenario(session, new Map([[secretRef, secretValue]]));

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshot: expect.any(String) });
    expect(outcome.results[0]?.result.steps.at(-1)).not.toHaveProperty('screenshotOmitted');
    expect(screenshot).toHaveBeenCalledOnce();
  });

  it('omits screenshots when the accessibility tree exceeds the JSON scan container budget', async () => {
    const accessibilityTree: JsonValueT = Array.from({ length: 1_000_000 }, () => ({}));
    const session = createFakeBrowserSession(new Map(), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree, screenshot: new Uint8Array([26]) },
    });
    const screenshot = vi.spyOn(session, 'screenshot');

    const outcome = await runFailureEvidenceScenario(session, new Map());

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshotOmitted: 'secret-detected' });
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('omits screenshots when only decoded scalar values contain a quoting-forced backslash secret', async () => {
    const secretRef = '{{secrets.scalar_only}}';
    const secretValue = '#scalar\\secret';
    const rawYaml = '- textbox: "#scalar\\\\secret"';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: { role: 'root', name: '', children: [] }, screenshot: new Uint8Array([12]) },
      accessibilityCapture: { rawYaml, scalarValues: [secretValue] },
    });
    const screenshot = vi.spyOn(session, 'screenshot');

    const outcome = await runFailureEvidenceScenario(session, new Map([[secretRef, secretValue]]));

    expect(rawYaml).not.toContain(secretValue);
    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshotOmitted: 'secret-detected' });
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('omits screenshots when only raw YAML contains an attribute-token secret', async () => {
    const secretRef = '{{secrets.raw_yaml_only}}';
    const secretValue = 'raw-attribute-secret';
    const rawYaml = '- button "Continue" [data-token=raw-attribute-secret]';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: { role: 'button', name: 'Continue' }, screenshot: new Uint8Array([13]) },
      accessibilityCapture: {
        rawYaml,
        scalarValues: [],
      },
    });
    const screenshot = vi.spyOn(session, 'screenshot');

    const outcome = await runFailureEvidenceScenario(session, new Map([[secretRef, secretValue]]));

    expect(extractDiscardedScalarValues(rawYaml)).toEqual([]);
    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshotOmitted: 'secret-detected' });
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('keeps persisted observed evidence limited to the parsed tree when non-tree channels trigger omission', async () => {
    const rawSecretRef = '{{secrets.raw_sentinel}}';
    const scalarSecretRef = '{{secrets.scalar_sentinel}}';
    const rawSentinel = 'RAW-CHANNEL-SENTINEL';
    const scalarSentinel = 'SCALAR-CHANNEL-SENTINEL';
    const tree = { role: 'document', name: 'Tree evidence only' } as const;
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: tree, screenshot: new Uint8Array([14]) },
      accessibilityCapture: {
        rawYaml: `- button "Continue" [data-token=${rawSentinel}]`,
        scalarValues: [scalarSentinel],
      },
    });

    const outcome = await runFailureEvidenceScenario(session, new Map([
      [rawSecretRef, rawSentinel],
      [scalarSecretRef, scalarSentinel],
    ]));
    const observed = outcome.results[0]?.result.steps.at(-1)?.observed?.accessibilitySnapshot;

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshotOmitted: 'secret-detected' });
    expect(observed).toBeDefined();
    const persistedTree = JSON.parse(observed ?? '{}') as JsonValueT;
    expect(JSON.stringify(persistedTree)).toContain('Tree evidence only');
    expect(JSON.stringify(persistedTree)).not.toContain(rawSentinel);
    expect(JSON.stringify(persistedTree)).not.toContain(scalarSentinel);
  });

  it('permits screenshot capture when all three channels are empty despite a nonempty resolved secret', async () => {
    const secretRef = '{{secrets.empty_capture}}';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: { role: 'root', name: '', children: [] }, screenshot: new Uint8Array([15]) },
    });
    const screenshot = vi.spyOn(session, 'screenshot');

    const outcome = await runFailureEvidenceScenario(session, new Map([[secretRef, 'not-present']]));

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshot: expect.any(String) });
    expect(outcome.results[0]?.result.steps.at(-1)).not.toHaveProperty('screenshotOmitted');
    expect(screenshot).toHaveBeenCalledOnce();
  });

  it('excludes empty resolved secret values from every accessibility detection channel', async () => {
    const secretRef = '{{secrets.empty_value}}';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: { role: '', name: '', children: [] }, screenshot: new Uint8Array([16]) },
      accessibilityCapture: { rawYaml: '', scalarValues: [''] },
    });
    const screenshot = vi.spyOn(session, 'screenshot');

    const outcome = await runFailureEvidenceScenario(session, new Map([[secretRef, '']]));

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshot: expect.any(String) });
    expect(outcome.results[0]?.result.steps.at(-1)).not.toHaveProperty('screenshotOmitted');
    expect(screenshot).toHaveBeenCalledOnce();
  });

  it('uses the three-character substring branch for the first duplicate scalar match', async () => {
    const secretRef = '{{secrets.scalar_substring}}';
    const secretValue = 'abc';
    let secondScalarReads = 0;
    const scalarValues = ['prefix-abcsuffix'] as string[];
    Object.defineProperty(scalarValues, 1, {
      enumerable: true,
      get(): string {
        secondScalarReads += 1;
        return 'second scalar must not be read';
      },
    });
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: { role: 'root', name: '', children: [] }, screenshot: new Uint8Array([17]) },
      accessibilityCapture: {
        rawYaml: '',
        scalarValues,
      },
    });
    const screenshot = vi.spyOn(session, 'screenshot');

    const outcome = await runFailureEvidenceScenario(session, new Map([[secretRef, secretValue]]));

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshotOmitted: 'secret-detected' });
    expect(secondScalarReads).toBe(0);
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('fails closed for an invalid parsed tree when a resolved secret exists', async () => {
    const secretRef = '{{secrets.invalid_tree}}';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: SNAPSHOT_INVALID, screenshot: new Uint8Array([18]) },
    });
    const screenshot = vi.spyOn(session, 'screenshot');

    const outcome = await runFailureEvidenceScenario(session, new Map([[secretRef, 'not-in-tree']]));

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshotOmitted: 'secret-detected' });
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('permits screenshot capture for an invalid parsed tree when the case has no resolved secret', async () => {
    const session = createFakeBrowserSession(new Map(), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: SNAPSHOT_INVALID, screenshot: new Uint8Array([19]) },
    });
    const screenshot = vi.spyOn(session, 'screenshot');

    const outcome = await runFailureEvidenceScenario(session, new Map());

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshot: expect.any(String) });
    expect(outcome.results[0]?.result.steps.at(-1)).not.toHaveProperty('screenshotOmitted');
    expect(screenshot).toHaveBeenCalledOnce();
  });

  it('fails closed when the three-channel detector itself throws, even without a resolved secret', async () => {
    const session = createFakeBrowserSession(new Map(), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: { role: 'document', name: 'Clean tree' }, screenshot: new Uint8Array([20]) },
    });
    vi.spyOn(session, 'accessibilitySnapshot').mockResolvedValue({
      get rawYaml(): string {
        throw new Error('Raw YAML detector access failed.');
      },
      tree: { role: 'document', name: 'Clean tree' },
      scalarValues: [],
    });
    const screenshot = vi.spyOn(session, 'screenshot');

    const outcome = await runFailureEvidenceScenario(session, new Map());

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshotOmitted: 'secret-detected' });
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('omits screenshots when accessibility capture fails after an earlier fill-secret', async () => {
    const secretRef = '{{secrets.snapshot_evidence}}';
    const secretValue = 'AMBERCAST_SECRET_SNAPSHOT_EVIDENCE_VALUE';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: { role: 'document' }, screenshot: new Uint8Array([1]) },
    });
    vi.spyOn(session, 'accessibilitySnapshot').mockRejectedValue(new Error('a11y unavailable'));
    const screenshot = vi.spyOn(session, 'screenshot');
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const writeBinary = vi.spyOn(recordingStorage.storage, 'writeBinary');
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'assert-dashboard', kind: 'assert', check: 'text-visible', text: 'Dashboard' },
    ], elementGrounding(['fill-secret']));

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const step = outcome.results[0]?.result.steps.at(-1);

    expect(step).toMatchObject({ screenshotOmitted: 'secret-detected' });
    expect(step).not.toHaveProperty('screenshot');
    expect(screenshot).not.toHaveBeenCalled();
    expect(writeBinary).not.toHaveBeenCalled();
  });

  it('captures screenshots when accessibility capture fails without any resolved secret', async () => {
    const session = createFakeBrowserSession(new Map(), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: { role: 'document' }, screenshot: new Uint8Array([1]) },
    });
    vi.spyOn(session, 'accessibilitySnapshot').mockRejectedValue(new Error('a11y unavailable'));
    const screenshot = vi.spyOn(session, 'screenshot');
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
    const writeBinary = vi.spyOn(recordingStorage.storage, 'writeBinary');
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'assert-dashboard', kind: 'assert', check: 'text-visible', text: 'Dashboard' },
    ]);

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const step = outcome.results[0]?.result.steps[0];

    expect(step).toMatchObject({ screenshot: expect.any(String) });
    expect(step).not.toHaveProperty('screenshotOmitted');
    expect(screenshot).toHaveBeenCalledOnce();
    expect(writeBinary).toHaveBeenCalledOnce();
  });

  it('still omits screenshots when redacted secret-bearing accessibility evidence cannot be serialized', async () => {
    const secretRef = '{{secrets.rendering_evidence}}';
    const secretValue = 'AMBERCAST_SECRET_RENDERING_EVIDENCE_VALUE';
    let textReads = 0;
    const accessibilityTree: { readonly text: string } = {} as { readonly text: string };
    Object.defineProperty(accessibilityTree, 'text', {
      enumerable: true,
      get() {
        textReads += 1;
        if (textReads === 1) {
          return `token=${secretValue}`;
        }

        throw new Error('observed evidence rendering failed');
      },
    });
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: {
        accessibilityTree,
        screenshot: new Uint8Array([1]),
      },
    });
    const screenshot = vi.spyOn(session, 'screenshot');
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const writeBinary = vi.spyOn(recordingStorage.storage, 'writeBinary');
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'assert-dashboard', kind: 'assert', check: 'text-visible', text: 'Dashboard' },
    ], elementGrounding(['fill-secret']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshotOmitted: 'secret-detected' });
    expect(outcome.results[0]?.result.steps.at(-1)).not.toHaveProperty('screenshot');
    expect(screenshot).not.toHaveBeenCalled();
    expect(writeBinary).not.toHaveBeenCalled();
  });

  it('omits an assertion screenshot when its raw diagnostic contains a resolved secret despite a clean tree', async () => {
    const secretRef = '{{secrets.evidence}}';
    const secretValue = 'AMBERCAST_SECRET_EVIDENCE_VALUE';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      assertOutcome: { passed: false, message: `The page exposed ${secretValue}.` },
      snapshot: { accessibilityTree: { text: 'Clean accessibility evidence' }, screenshot: new Uint8Array([1]) },
    });
    const screenshot = vi.spyOn(session, 'screenshot');
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const writeBinary = vi.spyOn(recordingStorage.storage, 'writeBinary');
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'assert-dashboard', kind: 'assert', check: 'text-visible', text: 'Dashboard' },
    ], elementGrounding(['fill-secret']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({
      actual: `The page exposed ${secretRef}.`, screenshotOmitted: 'secret-detected',
    });
    expect(screenshot).not.toHaveBeenCalled();
    expect(writeBinary).not.toHaveBeenCalled();
  });

  it('omits an assertion screenshot when only its raw expected text contains a resolved secret', async () => {
    const secretRef = '{{secrets.expected_evidence}}';
    const secretValue = 'AMBERCAST_SECRET_EXPECTED_EVIDENCE_VALUE';
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: secretValue, value: '' }]]),
      assertOutcome: { passed: false, message: 'The ordinary diagnostic is clean.' },
      snapshot: { accessibilityTree: { text: 'Clean accessibility evidence' }, screenshot: new Uint8Array([2]) },
    });
    const screenshot = vi.spyOn(session, 'screenshot');
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const writeBinary = vi.spyOn(recordingStorage.storage, 'writeBinary');
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
      { id: 'assert-token', kind: 'assert', check: 'text-visible', text: 'Token {{run.token}}' },
    ], elementGrounding(['fill-secret', 'capture-token']));

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ screenshotOmitted: 'secret-detected' });
    expect(screenshot).not.toHaveBeenCalled();
    expect(writeBinary).not.toHaveBeenCalled();
  });

  it('attaches best-effort evidence to a caught dispatch error without assertion-only fields', async () => {
    const session = createFakeBrowserSession(new Map(), {
      snapshot: { accessibilityTree: { role: 'document', name: 'Broken page' }, screenshot: new Uint8Array([3]) },
      onPerform(action) {
        if (action.type === 'navigate') {
          throw new Error('socket disconnected');
        }
      },
    });
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'open-dashboard', kind: 'action', action: 'navigate', url: '/dashboard' }]);

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const step = outcome.results[0]?.result.steps[0];

    expect(outcome.results[0]?.result.explanation).toBe('The browser session could not complete this case and no deterministic fallback is available (Error).');
    expect(step).toMatchObject({ id: 'open-dashboard', status: 'error', kind: 'environment', screenshot: expect.any(String), observed: expect.any(Object) });
    expect(step).not.toHaveProperty('expected');
    expect(step).not.toHaveProperty('actual');
  });

  it('sequences accessibility capture before screenshot and keeps their failure modes independent', async () => {
    const order: string[] = [];
    const session = createFakeBrowserSession(new Map(), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: { role: 'document' }, screenshot: new Uint8Array([4]) },
    });
    vi.spyOn(session, 'accessibilitySnapshot').mockImplementation(async () => {
      order.push('accessibility-start');
      await Promise.resolve();
      order.push('accessibility-end');
      throw new Error('a11y unavailable');
    });
    vi.spyOn(session, 'screenshot').mockImplementation(async () => {
      order.push('screenshot');
      return new Uint8Array([4]);
    });
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'assert-dashboard', kind: 'assert', check: 'text-visible', text: 'Dashboard' }]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(order).toEqual(['accessibility-start', 'accessibility-end', 'screenshot']);
    expect(outcome.results[0]?.result.steps[0]).toMatchObject({ screenshot: expect.any(String) });
    expect(outcome.results[0]?.result.steps[0]).not.toHaveProperty('observed');
    expect(outcome.results[0]?.result.steps[0]).not.toHaveProperty('screenshotOmitted');
  });

  it('absorbs screenshot capture or write failures without changing the original assertion result', async () => {
    for (const failure of ['capture', 'write'] as const) {
      const session = createFakeBrowserSession(new Map(), {
        assertOutcome: { passed: false, message: 'The dashboard is absent.' },
        snapshot: { accessibilityTree: { role: 'document' }, screenshot: new Uint8Array([5]) },
      });
      const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
      if (failure === 'capture') {
        vi.spyOn(session, 'screenshot').mockImplementation(() => { throw new Error('synchronous screenshot failure'); });
      } else {
        vi.spyOn(recordingStorage.storage, 'writeBinary').mockRejectedValue(new Error('disk full'));
      }
      const testPath = await writePrompt(recordingStorage.storage, `${failure}.test.md`);
      await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'assert-dashboard', kind: 'assert', check: 'text-visible', text: 'Dashboard' }]);

      const outcome = await run(deps, { ...DEFAULT_OPTIONS, files: [testPath] });
      const step = outcome.results[0]?.result.steps[0];

      expect(outcome.results[0]?.result).toMatchObject({ status: 'failed', explanation: 'The dashboard is absent.' });
      expect(step).not.toHaveProperty('screenshot');
      expect(step).toHaveProperty('observed');
    }
  });

  it('fails closed when assertion evidence storage rejects the screenshot with an integrity violation', async () => {
    const violation = new IntegrityViolationError('Evidence path escaped its containment boundary.');
    const session = createFakeBrowserSession(new Map(), {
      assertOutcome: { passed: false, message: 'The dashboard is absent.' },
      snapshot: { accessibilityTree: { role: 'document' }, screenshot: new Uint8Array([61]) },
    });
    const accessibilitySnapshot = vi.spyOn(session, 'accessibilitySnapshot');
    const screenshot = vi.spyOn(session, 'screenshot');
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
    const writeBinary = vi.spyOn(recordingStorage.storage, 'writeBinary').mockRejectedValue(violation);
    const testPath = await writePrompt(recordingStorage.storage, 'integrity-evidence.test.md');
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'assert-dashboard', kind: 'assert', check: 'text-visible', text: 'Dashboard' },
    ]);

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, files: [testPath] });
    const result = outcome.results[0];

    expect(result?.result).toMatchObject({ status: 'error' });
    // run() reconstructs case-level errors through redactedError()'s secret-redaction contract,
    // so it promises a same-class, same-message, same-details rebuild rather than object identity.
    expect(result?.error).toStrictEqual(violation);
    expect(result?.result.steps[0]).not.toHaveProperty('screenshot');
    expect(accessibilitySnapshot).toHaveBeenCalledOnce();
    expect(screenshot).toHaveBeenCalledOnce();
    expect(writeBinary).toHaveBeenCalledOnce();
  });

  it('lets an integrity violation from outer-catch evidence supersede the original dispatch failure', async () => {
    const original = new Error('Browser disconnected during dispatch.');
    const violation = new IntegrityViolationError('Evidence path escaped its containment boundary.');
    const session = createFakeBrowserSession(new Map(), {
      snapshot: { accessibilityTree: { role: 'document' }, screenshot: new Uint8Array([62]) },
      onPerform() { throw original; },
    });
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
    vi.spyOn(recordingStorage.storage, 'writeBinary').mockRejectedValue(violation);
    const testPath = await writePrompt(recordingStorage.storage, 'integrity-outer-catch.test.md');
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'navigate', kind: 'action', action: 'navigate', url: '/dashboard' },
    ]);

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, files: [testPath] });

    expect(outcome.results[0]?.result).toMatchObject({ status: 'error' });
    // run() reconstructs case-level errors through redactedError()'s secret-redaction contract,
    // so it promises a same-class, same-message, same-details rebuild rather than object identity.
    expect(outcome.results[0]?.error).toStrictEqual(violation);
    expect(outcome.results[0]?.error).not.toBe(original);
  });

  it('omits a caught-error screenshot when only its raw accessibility tree contains a resolved secret', async () => {
    const secretRef = '{{secrets.catch_evidence}}';
    const secretValue = 'AMBERCAST_SECRET_CATCH_EVIDENCE_VALUE';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]), {
      snapshot: { accessibilityTree: { text: `token=${secretValue}` }, screenshot: new Uint8Array([6]) },
      onPerform(action) {
        if (action.type === 'navigate') {
          throw new Error('detached page');
        }
      },
    });
    const screenshot = vi.spyOn(session, 'screenshot');
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const writeBinary = vi.spyOn(recordingStorage.storage, 'writeBinary');
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'open-dashboard', kind: 'action', action: 'navigate', url: '/dashboard' },
    ], elementGrounding(['fill-secret']));

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const step = outcome.results[0]?.result.steps.at(-1);

    expect(step).toMatchObject({ kind: 'environment', screenshotOmitted: 'secret-detected' });
    expect(step).not.toHaveProperty('screenshot');
    expect(step).not.toHaveProperty('expected');
    expect(step).not.toHaveProperty('actual');
    expect(screenshot).not.toHaveBeenCalled();
    expect(writeBinary).not.toHaveBeenCalled();
  });

  it('redacts raw assertion and accessibility evidence before it reaches the result', async () => {
    const secretRef = '{{secrets.redaction_evidence}}';
    const secretValue = 'secret-"quoted\\value';
    const capturedValue = 'captured-value';
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: capturedValue, value: '' }]]),
      assertOutcome: { passed: false, message: `actual ${secretValue} ${capturedValue}` },
      snapshot: {
        accessibilityTree: { [`key ${secretValue}`]: `value ${capturedValue} ${secretValue}` },
        screenshot: new Uint8Array([7]),
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'fill-secret', kind: 'action', action: 'fill-secret', target: PASSWORD, secretRef },
      { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
      { id: 'assert-token', kind: 'assert', check: 'text-visible', text: 'Token {{run.token}}' },
    ], elementGrounding(['fill-secret', 'capture-token']));

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const result = outcome.results[0]?.result;
    const step = result?.steps.at(-1);

    expect(step).toMatchObject({
      expected: 'Text "Token {{run.token}}" is visible.',
      actual: `actual ${secretRef} {{run.token}}`,
      screenshotOmitted: 'secret-detected',
      observed: { accessibilitySnapshot: expect.any(String) },
    });
    expect(step?.observed?.accessibilitySnapshot).toContain(secretRef);
    expect(step?.observed?.accessibilitySnapshot).toContain('{{run.token}}');
    expect(JSON.stringify(result)).not.toContain(secretValue);
    expect(JSON.stringify(result)).not.toContain(capturedValue);
    const parsed = RunResult.safeParse(result);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it('returns a pre-launch error without attempting to attach browser evidence', async () => {
    const driver = createFakeUiExecutor(() => createFakeBrowserSession(new Map()));
    vi.spyOn(driver, 'launch').mockRejectedValue(new BrowserLaunchFailedError('launch failed'));
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => driver) });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'open-dashboard', kind: 'action', action: 'navigate', url: '/dashboard' }]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    // SPEC-14: launch is attempted at the first step, so that step owns the error.
    expect(outcome.results[0]?.result).toMatchObject({
      status: 'error',
      steps: [{ id: 'open-dashboard', status: 'error', kind: 'environment', target: 'web' }],
    });
  });

  it('does not capture failure evidence for passing or duplicate literal cases', async () => {
    const passingSession = createFakeBrowserSession(new Map());
    const screenshot = vi.spyOn(passingSession, 'screenshot');
    const accessibilitySnapshot = vi.spyOn(passingSession, 'accessibilitySnapshot');
    const { deps, recordingStorage } = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => passingSession)) });
    const writeBinary = vi.spyOn(recordingStorage.storage, 'writeBinary');
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{ id: 'open-dashboard', kind: 'action', action: 'navigate', url: '/dashboard' }]);

    const outcome = await run(deps, { ...DEFAULT_OPTIONS, files: [testPath, testPath] });

    expect(outcome.results).toHaveLength(1);
    expect(screenshot).not.toHaveBeenCalled();
    expect(accessibilitySnapshot).not.toHaveBeenCalled();
    expect(writeBinary).not.toHaveBeenCalled();
  });
});

describe('run credential-literal symmetry', () => {
  it.each(CREDENTIAL_LITERALS)('rejects a fresh-agentic fill with %s before the browser action', async (_description, value, detector) => {
    const session = createFakeBrowserSession(liveEntries([EMAIL]));
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill', element: EMAIL, value });
        await request.controller.evaluateAssert(passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);
    recordingStorage.writes.length = 0;

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error?.details).toEqual({ detector });
    expect(JSON.stringify(error?.details ?? {})).not.toContain(value);
    expect(session.operations().filter((operation) => operation.type === 'perform')).toEqual([]);
    expect(recordingStorage.writes).toEqual([]);
  });

  it.each(CREDENTIAL_LITERALS)('rejects a stored fill with %s before replay or fresh-agentic fallback', async (_description, value, detector) => {
    const session = createFakeBrowserSession(liveEntries([EMAIL]));
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep()],
      aiGrounding(legacyTrace([{ type: 'fill', element: EMAIL, value }], [passingText('Dashboard')])),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error?.details).toEqual({ detector });
    expect(JSON.stringify(error?.details ?? {})).not.toContain(value);
    expect(session.operations()).toEqual([]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  it('accepts a fresh-agentic fill with the original symbol-containing literal outside the token shape', async () => {
    const value = 'aB3!dE5@fG7#hI9$jK2%mN4^pQ6&rS8T';
    const session = createFakeBrowserSession(liveEntries([EMAIL]));
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill', element: EMAIL, value });
        await evaluateTerminalAssert(request, passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(outcome.results[0]?.error).not.toBeInstanceOf(IntegrityViolationError);
  });

  it.each([
    ['navigate URL', async (request: AiAgenticRequest, target: ElementRef, literal: string) => {
      await request.controller.perform({ type: 'navigate', url: literal });
    }],
    ['text-visible assertion text', async (request: AiAgenticRequest, target: ElementRef, literal: string) => {
      await request.controller.evaluateAssert({ type: 'assert', check: 'text-visible', text: literal });
    }],
    ['text-equals assertion text', async (request: AiAgenticRequest, target: ElementRef, literal: string) => {
      await request.controller.evaluateAssert({ type: 'assert', check: 'text-equals', element: target, text: literal });
    }],
    ['URL-match assertion pattern', async (request: AiAgenticRequest, _target: ElementRef, literal: string) => {
      await request.controller.evaluateAssert({ type: 'assert', check: 'url-matches', pattern: literal });
    }],
    ['fill target name', async (request: AiAgenticRequest, target: ElementRef) => {
      await request.controller.perform({ type: 'fill', element: target, value: 'ordinary fill value' });
    }],
  ] as const)('does not apply the fill-value heuristic to fresh-agentic %s', async (_description, script) => {
    const literal = 'sk-scope-exclusion-value';
    const credentialShapedTarget: ElementRef = { ...EMAIL, name: literal };
    const session = createFakeBrowserSession(liveEntries([EMAIL, credentialShapedTarget]));
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await script(request, credentialShapedTarget, literal);
        await request.controller.perform({ type: 'navigate', url: '/dashboard' });
        await evaluateTerminalAssert(request, passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(outcome.results[0]?.error).toBeUndefined();
  });

  it.each([
    ['navigate URL', (target: ElementRef, literal: string) => coveredTrace(
      [{ type: 'navigate', url: literal }],
      [passingText('Dashboard')],
    )],
    ['text-visible assertion text', (_target: ElementRef, literal: string) => coveredTrace(
      [],
      [{ type: 'assert', check: 'text-visible', text: literal }],
    )],
    ['text-equals assertion text', (target: ElementRef, literal: string) => coveredTrace(
      [],
      [{ type: 'assert', check: 'text-equals', element: target, text: literal }],
    )],
    ['URL-match assertion pattern', (_target: ElementRef, literal: string) => coveredTrace(
      [{ type: 'assert', check: 'url-matches', pattern: literal }],
      [passingText('Dashboard')],
    )],
    ['fill target name', (target: ElementRef) => coveredTrace(
      [{ type: 'fill', element: target, value: 'ordinary fill value' }],
      [passingText('Dashboard')],
    )],
  ] as const)('does not apply the fill-value heuristic to stored-trace %s', async (_description, buildTrace) => {
    const literal = 'sk-scope-exclusion-value';
    const credentialShapedTarget: ElementRef = { ...EMAIL, name: literal };
    const session = createFakeBrowserSession(liveEntries([EMAIL, credentialShapedTarget]));
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep()],
      aiGrounding(buildTrace(credentialShapedTarget, literal)),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(outcome.results[0]?.error).toBeUndefined();
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  it('keeps the known-resolved-secret rejection ahead of the fresh-agentic fill heuristic', async () => {
    const secretRef = '{{secrets.auth.overlap}}';
    const secretValue = 'sk-overlap-secret-value';
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]));
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        await request.controller.perform({ type: 'fill', element: EMAIL, value: secretValue });
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep('recorded-ai', [secretRef])]);

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error?.message).toBe('The AI adapter supplied a materialized value instead of an unresolved reference.');
    expect(error?.details).toBeUndefined();
  });

  it('keeps the known-resolved-secret rejection ahead of the stored-trace fill heuristic', async () => {
    const secretRef = '{{secrets.auth.overlap}}';
    const secretValue = 'sk-overlap-secret-value';
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]));
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
      aiGrounding(legacyTrace([
        { type: 'fill-secret', element: PASSWORD, secretRef },
        { type: 'fill', element: EMAIL, value: secretValue },
      ], [passingText('Dashboard')])),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error?.message).toBe('An AI trace contains a materialized secret value.');
    expect(error?.details).toBeUndefined();
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  it.each([
    ['click', async (request: AiAgenticRequest, target: ElementRef) => {
      await request.controller.perform({ type: 'click', element: target });
    }],
    ['press', async (request: AiAgenticRequest, target: ElementRef) => {
      await request.controller.perform({ type: 'press', element: target, key: 'Enter' });
    }],
  ] as const)('rejects a resolved secret echoed in a fresh-agentic %s target name', async (_description, perform) => {
    const secretRef = '{{secrets.auth.target_name}}';
    const secretValue = 'TARGET-NAME-SECRET-VALUE';
    const secretNamedTarget: ElementRef = { strategy: 'accessibility', role: 'button', name: secretValue };
    const session = createFakeBrowserSession(liveEntries([PASSWORD, secretNamedTarget]));
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        await perform(request, secretNamedTarget);
        await request.controller.evaluateAssert(passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep('recorded-ai', [secretRef])]);

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error?.message).toBe('The AI adapter supplied a materialized value instead of an unresolved reference.');
    expect(error?.details).toBeUndefined();
    expect(JSON.stringify(error?.details ?? {})).not.toContain(secretValue);
    expect(session.operations().filter((operation) => operation.type === 'perform')).toEqual([]);
  });

  it.each([
    ['click', (target: ElementRef) => legacyTrace([
      { type: 'fill-secret', element: PASSWORD, secretRef: '{{secrets.auth.target_name}}' },
      { type: 'click', element: target },
    ], [passingText('Dashboard')])],
    ['press', (target: ElementRef) => legacyTrace([
      { type: 'fill-secret', element: PASSWORD, secretRef: '{{secrets.auth.target_name}}' },
      { type: 'press', element: target, key: 'Enter' },
    ], [passingText('Dashboard')])],
  ] as const)('rejects a resolved secret echoed in a stored-trace %s target name before replay', async (_description, buildTrace) => {
    const secretRef = '{{secrets.auth.target_name}}';
    const secretValue = 'TARGET-NAME-SECRET-VALUE';
    const secretNamedTarget: ElementRef = { strategy: 'accessibility', role: 'button', name: secretValue };
    const session = createFakeBrowserSession(liveEntries([PASSWORD, secretNamedTarget]));
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
      aiGrounding(buildTrace(secretNamedTarget)),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error?.message).toBe('An AI trace contains a materialized secret value.');
    expect(error?.details).toBeUndefined();
    expect(JSON.stringify(error?.details ?? {})).not.toContain(secretValue);
    expect(session.operations()).toEqual([]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  it.each([
    [
      'type',
      new Map([['{{secrets.trace.type}}', 'click']]),
      coveredTrace([
        { type: 'fill-secret', element: PASSWORD, secretRef: '{{secrets.trace.type}}' },
        { type: 'click', element: SUBMIT },
      ], [passingText('Dashboard')]),
    ],
    [
      'check',
      new Map([['{{secrets.trace.check}}', 'element-visible']]),
      coveredTrace([
        { type: 'fill-secret', element: PASSWORD, secretRef: '{{secrets.trace.check}}' },
      ], [{ type: 'assert', check: 'element-visible', element: SUBMIT }]),
    ],
    [
      'target.strategy',
      new Map([['{{secrets.trace.strategy}}', 'accessibility']]),
      coveredTrace([
        { type: 'fill-secret', element: PASSWORD, secretRef: '{{secrets.trace.strategy}}' },
        { type: 'click', element: SUBMIT },
      ], [passingText('Dashboard')]),
    ],
    [
      'key',
      new Map([['{{secrets.trace.key}}', 'Enter']]),
      coveredTrace([
        { type: 'fill-secret', element: PASSWORD, secretRef: '{{secrets.trace.key}}' },
        { type: 'press', element: SUBMIT, key: 'Enter' },
      ], [passingText('Dashboard')]),
    ],
    [
      'secretRef',
      new Map([
        ['{{secrets.trace.token}}', 'first-secret-value'],
        ['{{secrets.trace.tok}}', 'tok'],
      ]),
      coveredTrace([
        { type: 'fill-secret', element: PASSWORD, secretRef: '{{secrets.trace.token}}' },
        { type: 'fill-secret', element: PASSWORD, secretRef: '{{secrets.trace.tok}}' },
      ], [passingText('Dashboard')]),
    ],
  ] as const)('permits incidental resolved-secret matches in stored-trace %s closed vocabulary', async (_path, secretValues, priorTrace) => {
    const secretRefs = [...secretValues.keys()];
    const session = createFakeBrowserSession(liveEntries([PASSWORD, SUBMIT]));
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(secretValues),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', secretRefs)],
      aiGrounding(priorTrace),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(outcome.results[0]?.error).toBeUndefined();
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  /*
   * The same `TRACE_ENTRY_CLOSED_VOCABULARY_PATHS` exclusion backs both call
   * sites of `traceEntryContainsResolvedSecret`, so a resolved secret that
   * happens to equal a `type`/`check`/`target.strategy`/`key`/`secretRef`
   * literal must not be misread as a leaked secret on path B either (#157).
   *
   * Every row ends with `snapshotForResolution()` rather than a passing
   * trailing assertion. `finalize()` only persists a new grounding entry
   * after a passing, trailing assertion; the grounding-persistence boundary's
   * own `jsonContainsResolvedSecret` call has no closed-vocabulary exclusion
   * (unlike the trace-entry scan), so a passing row would be correctly waved
   * through the check this test targets and then incorrectly rejected by the
   * unrelated, unexcluded persistence check — defeating the test. Ending in a
   * snapshot keeps the journal unpersisted, isolating the trace-entry-level
   * contract under test.
   *
   * The `secretRef` row resolves its two secrets in the reverse order from
   * the stored-trace version: path B has no whole-trace pre-resolution pass,
   * so the shorter secret (`'tok'`) must already be resolved by an earlier
   * `fill-secret` call before the entry whose own `secretRef` field text
   * contains it as a substring (`'{{secrets.trace.token}}'`) is scanned —
   * otherwise the row would pass even without the exclusion.
   */
  it.each([
    [
      'type',
      new Map([['{{secrets.trace.type}}', 'click']]),
      async (request: AiAgenticRequest, secretRefs: readonly string[]) => {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef: secretRefs[0]! });
        await request.controller.perform({ type: 'click', element: SUBMIT });
      },
    ],
    [
      'check',
      new Map([['{{secrets.trace.check}}', 'element-visible']]),
      async (request: AiAgenticRequest, secretRefs: readonly string[]) => {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef: secretRefs[0]! });
        await request.controller.evaluateAssert({ type: 'assert', check: 'element-visible', element: SUBMIT });
      },
    ],
    [
      'target.strategy',
      new Map([['{{secrets.trace.strategy}}', 'accessibility']]),
      async (request: AiAgenticRequest, secretRefs: readonly string[]) => {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef: secretRefs[0]! });
        await request.controller.perform({ type: 'click', element: SUBMIT });
      },
    ],
    [
      'key',
      new Map([['{{secrets.trace.key}}', 'Enter']]),
      async (request: AiAgenticRequest, secretRefs: readonly string[]) => {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef: secretRefs[0]! });
        await request.controller.perform({ type: 'press', element: SUBMIT, key: 'Enter' });
      },
    ],
    [
      'secretRef',
      new Map([
        ['{{secrets.trace.tok}}', 'tok'],
        ['{{secrets.trace.token}}', 'first-secret-value'],
      ]),
      async (request: AiAgenticRequest, secretRefs: readonly string[]) => {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef: secretRefs[0]! });
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef: secretRefs[1]! });
      },
    ],
  ] as const)('permits incidental resolved-secret matches in fresh-agentic %s closed vocabulary', async (_path, secretValues, performOffendingCalls) => {
    const secretRefs = [...secretValues.keys()];
    const session = createFakeBrowserSession(liveEntries([PASSWORD, SUBMIT]));
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await performOffendingCalls(request, secretRefs);
        await request.controller.snapshotForResolution();
        return { outcome: 'success' };
      },
    });
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(secretValues),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep('recorded-ai', secretRefs)]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(outcome.results[0]?.error).toBeUndefined();
    expect(resolveAiExecutor).toHaveBeenCalledTimes(1);
    expect(aiCalls(events)).toEqual([expectedAiCall('ai-1', 'recorded-ai')]);
  });

  it('does not scan object keys while inspecting stored traces', async () => {
    const secretRef = '{{secrets.trace.object_key}}';
    const secretValue = 'target';
    const priorTrace = coveredTrace([
      { type: 'fill-secret', element: PASSWORD, secretRef },
      { type: 'click', element: SUBMIT },
    ], [passingText('Dashboard')]);
    const scannedValues = [
      'fill-secret', PASSWORD.strategy, PASSWORD.role, PASSWORD.name, secretRef,
      'click', SUBMIT.strategy, SUBMIT.role, SUBMIT.name,
      'assert', 'text-visible', 'Dashboard',
    ];
    expect(scannedValues.some((value) => value.includes(secretValue))).toBe(false);
    const session = createFakeBrowserSession(liveEntries([PASSWORD, SUBMIT]));
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
      aiGrounding(priorTrace),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(outcome.results[0]?.error).toBeUndefined();
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  it('does not treat a fill-secret reference name containing its resolved value as materialized in fresh-agentic execution', async () => {
    const secretRef = '{{secrets.auth.tok}}';
    const secretValue = 'tok';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]));
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        await request.controller.snapshotForResolution();
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep('recorded-ai', [secretRef])]);

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(outcome.results[0]?.error).toBeUndefined();
  });

  it('does not treat a fill-secret reference name containing its resolved value as materialized before stored-trace replay', async () => {
    const secretRef = '{{secrets.auth.tok}}';
    const secretValue = 'tok';
    const session = createFakeBrowserSession(liveEntries([PASSWORD]));
    const executor = createFakeAiExecutor();
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
      aiGrounding(coveredTrace([
        { type: 'fill-secret', element: PASSWORD, secretRef },
      ], [passingText('Dashboard')])),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(outcome.results[0]?.error).toBeUndefined();
  });

  it('rejects a resolved secret echoed in a fresh-agentic fill-secret target name', async () => {
    const secretRef = '{{secrets.auth.fill_secret_target_name}}';
    const secretValue = 'FILL-SECRET-TARGET-NAME-VALUE';
    const secretNamedTarget: ElementRef = { strategy: 'accessibility', role: 'textbox', name: secretValue };
    const session = createFakeBrowserSession(liveEntries([PASSWORD, secretNamedTarget]));
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        await request.controller.perform({ type: 'fill-secret', element: secretNamedTarget, secretRef });
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep('recorded-ai', [secretRef])]);

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error?.message).toBe('The AI adapter supplied a materialized value instead of an unresolved reference.');
    expect(error?.details).toBeUndefined();
    expect(JSON.stringify(error?.details ?? {})).not.toContain(secretValue);
    expect(session.operations().filter((operation) => operation.type === 'fill-secret')).toHaveLength(1);
  });

  /*
   * `target.role` is scanned like any other trace field — it is not in
   * `TRACE_ENTRY_CLOSED_VOCABULARY_PATHS` — so a resolved secret echoed into
   * an ARIA role must be rejected the same way on both replay paths, because
   * `traceEntryContainsResolvedSecret` backs `preScanTraceEntry` (path C) and
   * `assertNoMaterializedLiteral` (path B) alike (#157).
   *
   * Unlike path C, which pre-scans a whole historical trace before any
   * browser operation, path B has no such pre-pass: the secret must already
   * be resolved by an earlier `fill-secret` call before the role-echoing
   * action can even be attempted, so every row primes `resolvedSecrets` with
   * one `fill-secret` first. That priming call is itself a real session
   * operation, so a plain `session.operations()` toEqual([]) assertion
   * (path C's shape) would not hold here; each row instead carries the
   * operation-type its own offending call would have produced, plus the
   * count expected to have completed before the rejection, and the shared
   * assertion body filters on that rather than hard-coding per-row logic.
   */
  it.each([
    [
      'click',
      (secretRef: string, target: ElementRef) => async (request: AiAgenticRequest) => {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        await request.controller.perform({ type: 'click', element: target });
      },
      'perform',
      0,
    ],
    [
      'press',
      (secretRef: string, target: ElementRef) => async (request: AiAgenticRequest) => {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        await request.controller.perform({ type: 'press', element: target, key: 'Enter' });
      },
      'perform',
      0,
    ],
    [
      'fill-secret',
      (secretRef: string, target: ElementRef) => async (request: AiAgenticRequest) => {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        await request.controller.perform({ type: 'fill-secret', element: target, secretRef });
      },
      'fill-secret',
      1,
    ],
    [
      'element-visible',
      (secretRef: string, target: ElementRef) => async (request: AiAgenticRequest) => {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        await request.controller.evaluateAssert({ type: 'assert', check: 'element-visible', element: target });
      },
      'evaluate-assert',
      0,
    ],
    [
      'element-count',
      (secretRef: string, target: ElementRef) => async (request: AiAgenticRequest) => {
        await request.controller.perform({ type: 'fill-secret', element: PASSWORD, secretRef });
        await request.controller.evaluateAssert({ type: 'assert', check: 'element-count', element: target, count: 1 });
      },
      'evaluate-assert',
      0,
    ],
  ] as const)('rejects a materialized secret in a fresh-agentic %s target role', async (_description, buildActions, operationType, expectedCount) => {
    const secretRef = '{{secrets.auth.target_role}}';
    const secretValue = 'TARGET-ROLE-SECRET-VALUE';
    const secretRoleTarget: ElementRef = { strategy: 'accessibility', role: secretValue, name: 'Secret-independent target' };
    const session = createFakeBrowserSession(liveEntries([PASSWORD, secretRoleTarget]));
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await buildActions(secretRef, secretRoleTarget)(request);
        return { outcome: 'success' };
      },
    });
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep('recorded-ai', [secretRef])]);

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error?.message).toBe('The AI adapter supplied a materialized value instead of an unresolved reference.');
    expect(error?.details).toBeUndefined();
    expect(JSON.stringify(error?.details ?? {})).not.toContain(secretValue);
    expect(session.operations().filter((operation) => operation.type === operationType)).toHaveLength(expectedCount);
    expect(resolveAiExecutor).toHaveBeenCalledTimes(1);
  });

  it('rejects a resolved secret echoed in a stored fill-secret target name before replay', async () => {
    const secretRef = '{{secrets.auth.fill_secret_target_name}}';
    const secretValue = 'FILL-SECRET-TARGET-NAME-VALUE';
    const secretNamedTarget: ElementRef = { strategy: 'accessibility', role: 'textbox', name: secretValue };
    const session = createFakeBrowserSession(liveEntries([PASSWORD, secretNamedTarget]));
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      secrets: createFakeSecretsProvider(new Map([[secretRef, secretValue]])),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage, 'login.test.md', PROMPT);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [aiStep('recorded-ai', [secretRef])],
      aiGrounding(legacyTrace([
        { type: 'fill-secret', element: PASSWORD, secretRef },
        { type: 'fill-secret', element: secretNamedTarget, secretRef },
      ], [passingText('Dashboard')])),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(IntegrityViolationError);
    expect(error?.message).toBe('An AI trace contains a materialized secret value.');
    expect(error?.details).toBeUndefined();
    expect(JSON.stringify(error?.details ?? {})).not.toContain(secretValue);
    expect(session.operations()).toEqual([]);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  it.each([
    ['fill value', async (request: AiAgenticRequest, runValue: string) => {
      await request.controller.perform({ type: 'fill', element: PASSWORD, value: runValue });
    }],
    ['text-visible assertion text', async (request: AiAgenticRequest, runValue: string) => {
      await request.controller.evaluateAssert({ type: 'assert', check: 'text-visible', text: runValue });
    }],
    ['text-equals assertion text', async (request: AiAgenticRequest, runValue: string) => {
      await request.controller.evaluateAssert({ type: 'assert', check: 'text-equals', element: PASSWORD, text: runValue });
    }],
    ['URL-match assertion pattern', async (request: AiAgenticRequest, runValue: string) => {
      await request.controller.evaluateAssert({ type: 'assert', check: 'url-matches', pattern: runValue });
    }],
  ] as const)('continues to reject an exact captured run value in fresh-agentic %s', async (_description, emit) => {
    const runValue = 'CAPTURED-RUN-EXACT-VALUE';
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: runValue, value: '' }]]),
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await emit(request, runValue);
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
        aiStep(),
      ],
      elementGrounding(['capture-token']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(outcome.results[0]?.error?.message).toBe('The AI adapter supplied a materialized value instead of an unresolved reference.');
  });

  it('permits a fresh-agentic fill whose high-entropy content is fully explained by a captured run value', async () => {
    const runValue = 'aB3!dE5@fG7#hI9$jK2%mN4^pQ6&rS8T';
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: runValue, value: '' }]]),
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill', element: PASSWORD, value: `welcome-${runValue}` });
        await evaluateTerminalAssert(request, passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
        aiStep(),
      ],
      elementGrounding(['capture-token']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(outcome.results[0]?.error).toBeUndefined();
  });

  it('permits a fresh-agentic fill whose overlapping captured value is stripped longest-first', async () => {
    const capturedPrefix = 'aB3!dE5@';
    const capturedToken = `${capturedPrefix}fG7#hI9$jK2%mN4^pQ6&rS8T`;
    const session = createFakeBrowserSession(liveEntries([EMAIL, SUBMIT, PASSWORD]), {
      captureValues: new Map([
        [elementRefKey(EMAIL), { text: capturedPrefix, value: '' }],
        [elementRefKey(SUBMIT), { text: capturedToken, value: '' }],
      ]),
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill', element: PASSWORD, value: `welcome-${capturedToken}` });
        await evaluateTerminalAssert(request, passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'capture-prefix', kind: 'capture', target: EMAIL, variable: 'prefix' },
        { id: 'capture-token', kind: 'capture', target: SUBMIT, variable: 'token' },
        aiStep(),
      ],
      elementGrounding(['capture-prefix', 'capture-token']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(outcome.results[0]?.error).toBeUndefined();
  });

  it('permits a stored fill whose high-entropy content is fully explained by a captured run value', async () => {
    const runValue = 'aB3!dE5@fG7#hI9$jK2%mN4^pQ6&rS8T';
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: runValue, value: '' }]]),
    });
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
        aiStep(),
      ],
      {
        ...elementGrounding(['capture-token']),
        ...aiGrounding(coveredTrace([
          { type: 'fill', element: PASSWORD, value: `welcome-${runValue}` },
        ], [passingText('Dashboard')])),
      },
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(outcome.results[0]?.error).toBeUndefined();
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  it.each([
    ['sk prefix', 'sk-live-secret-value', 'credential-prefix-sk'],
    ['GitHub token prefix', 'ghp_secret-value', 'credential-prefix-ghp'],
    ['AWS access-key prefix', 'AKIASECRET123456789', 'credential-prefix-aws-access-key'],
  ] as const)('does not exempt a fresh-agentic %s fill when it also contains a captured run value', async (_description, literal, detector) => {
    const runValue = 'captured-run-value';
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: runValue, value: '' }]]),
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill', element: PASSWORD, value: `${literal}-${runValue}` });
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
        aiStep(),
      ],
      elementGrounding(['capture-token']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(outcome.results[0]?.error?.details).toEqual({ detector });
  });

  it.each([
    ['sk prefix', 'sk-live-secret-value', 'credential-prefix-sk'],
    ['GitHub token prefix', 'ghp_secret-value', 'credential-prefix-ghp'],
    ['AWS access-key prefix', 'AKIASECRET123456789', 'credential-prefix-aws-access-key'],
  ] as const)('does not exempt a stored %s fill when it also contains a captured run value', async (_description, literal, detector) => {
    const runValue = 'captured-run-value';
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: runValue, value: '' }]]),
    });
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
        aiStep(),
      ],
      {
        ...elementGrounding(['capture-token']),
        ...aiGrounding(legacyTrace([
          { type: 'fill', element: PASSWORD, value: `${literal}-${runValue}` },
        ], [passingText('Dashboard')])),
      },
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(outcome.results[0]?.error?.details).toEqual({ detector });
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  it('rejects a fresh-agentic high-entropy fill whose residue is not a captured run value', async () => {
    const capturedValue = 'ordinary-case-value';
    const fabricatedValue = HIGH_ENTROPY_TOKEN_LITERAL;
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: capturedValue, value: '' }]]),
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill', element: PASSWORD, value: `${capturedValue}${fabricatedValue}` });
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
        aiStep(),
      ],
      elementGrounding(['capture-token']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(outcome.results[0]?.error?.details).toEqual({ detector: 'high-entropy-token' });
  });

  it('rejects a stored high-entropy fill whose residue is not a captured run value', async () => {
    const capturedValue = 'ordinary-case-value';
    const fabricatedValue = HIGH_ENTROPY_TOKEN_LITERAL;
    const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
      captureValues: new Map([[elementRefKey(EMAIL), { text: capturedValue, value: '' }]]),
    });
    const executor = createFakeAiExecutor();
    const resolveAiExecutor = vi.fn<RunDeps['resolveAiExecutor']>(async () => executor);
    const { deps, events, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'capture-token', kind: 'capture', target: EMAIL, variable: 'token' },
        aiStep(),
      ],
      {
        ...elementGrounding(['capture-token']),
        ...aiGrounding(legacyTrace([
          { type: 'fill', element: PASSWORD, value: `${capturedValue}${fabricatedValue}` },
        ], [passingText('Dashboard')])),
      },
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(outcome.results[0]?.error?.details).toEqual({ detector: 'high-entropy-token' });
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(aiCalls(events)).toEqual([]);
  });

  // The heuristic intentionally permits values assembled entirely from trusted captured partitions; the separate trace-entry scan is the hard boundary for known resolved secrets.
  it('permits a fresh-agentic fill reassembled from two captured high-entropy-token partitions', async () => {
    const secretShapedValue = HIGH_ENTROPY_TOKEN_LITERAL;
    const firstPartition = secretShapedValue.slice(0, secretShapedValue.length / 2);
    const secondPartition = secretShapedValue.slice(secretShapedValue.length / 2);
    const session = createFakeBrowserSession(liveEntries([EMAIL, SUBMIT, PASSWORD]), {
      captureValues: new Map([
        [elementRefKey(EMAIL), { text: firstPartition, value: '' }],
        [elementRefKey(SUBMIT), { text: secondPartition, value: '' }],
      ]),
    });
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.perform({ type: 'fill', element: PASSWORD, value: secretShapedValue });
        await evaluateTerminalAssert(request, passingText('Dashboard'));
        return { outcome: 'success' };
      },
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(
      recordingStorage.storage,
      testPath,
      [
        { id: 'capture-first', kind: 'capture', target: EMAIL, variable: 'first' },
        { id: 'capture-second', kind: 'capture', target: SUBMIT, variable: 'second' },
        aiStep(),
      ],
      elementGrounding(['capture-first', 'capture-second']),
    );

    const outcome = await run(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(outcome.results[0]?.error).toBeUndefined();
  });
});
