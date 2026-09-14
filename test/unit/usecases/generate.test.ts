import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GENERATOR_INSTRUCTION_COVERAGE_POLICY_TEMPLATE,
  GENERATOR_SECRET_POLICY_TEMPLATE,
  promptTemplateFingerprint,
} from '#core/ai/prompt-envelope.js';
import { createCallIdAllocator } from '#core/ai/call-id-allocator.js';
import {
  PlanDocument,
  type GeneratedPlanResponse,
  type GroundingDocument,
  type JsonValueT,
  type Step,
} from '#core/ir/schema.js';
import { computeInputsDigest, computePlanDigest } from '#core/ir/digest.js';
import * as planProducerBundle from '#core/ai/plan-producer-bundle.js';
import * as planInputProvenance from '#core/ai/plan-input-provenance.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { normalizeTestMd } from '#core/ir/normalize.js';
import { createLayoutResolver } from '#core/layout/resolve.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { AiExecutorUnavailableError } from '#core/errors/ai-executor-unavailable-error.js';
import { ConfigInvalidError } from '#core/errors/config-invalid-error.js';
import { FsIoError } from '#core/errors/fs-io-error.js';
import { SecretLiteralRejectedError } from '#core/errors/secret-literal-rejected-error.js';
import { SecretEnvVarCollisionError } from '#core/errors/secret-env-var-collision-error.js';
import { SecretConsentRequiredError } from '#core/errors/secret-consent-required-error.js';
import { UnexpectedCrashError } from '#core/errors/unexpected-crash-error.js';
import { PromptPathInvalidError } from '#core/errors/prompt-path-invalid-error.js';
import { TargetUnresolvedError } from '#core/errors/target-unresolved-error.js';
import { AmbercastError } from '#core/errors/types.js';
import type { AiExecuteRequest, AiExecuteResult } from '#ports/ai.js';
import type { StorageAdapter } from '#ports/storage.js';
import type { Clock, RunEvent } from '#ports/system.js';
import { generate, type GenerateDeps, type GenerateOptions } from '#usecases/generate.js';
import { BatchInterruptionTracker } from '#usecases/batch-interruption.js';
import { validateCommittedInstructionCoverage } from '#usecases/instruction-coverage-policy.js';
import { REDACTED_ISSUE_PATH_SEGMENT } from '#core/ai/response-issue-path.js';
import { createInMemoryStorage } from '../../doubles/create-in-memory-storage.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { createRecordingEventSink } from '../../doubles/create-recording-event-sink.js';

const envVarNameMocks = vi.hoisted(() => ({
  assertNoEnvVarCollision: vi.fn(),
  actualAssertNoEnvVarCollision: undefined as
    | typeof import('#core/secrets/env-var-name.js')['assertNoEnvVarCollision']
    | undefined,
}));

vi.mock('#core/secrets/env-var-name.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#core/secrets/env-var-name.js')>();
  envVarNameMocks.actualAssertNoEnvVarCollision = actual.assertNoEnvVarCollision;
  envVarNameMocks.assertNoEnvVarCollision.mockImplementation(actual.assertNoEnvVarCollision);
  return { ...actual, assertNoEnvVarCollision: envVarNameMocks.assertNoEnvVarCollision };
});

const secretNamingMocks = vi.hoisted(() => ({
  deriveSecretNames: vi.fn(),
  actualDeriveSecretNames: undefined as
    | typeof import('#usecases/secret-naming.js')['deriveSecretNames']
    | undefined,
}));

vi.mock('#usecases/secret-naming.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#usecases/secret-naming.js')>();
  secretNamingMocks.actualDeriveSecretNames = actual.deriveSecretNames;
  secretNamingMocks.deriveSecretNames.mockImplementation(actual.deriveSecretNames);
  return { ...actual, deriveSecretNames: secretNamingMocks.deriveSecretNames };
});

afterEach(() => {
  const actualAssertNoEnvVarCollision = envVarNameMocks.actualAssertNoEnvVarCollision;
  const actualDeriveSecretNames = secretNamingMocks.actualDeriveSecretNames;
  if (actualAssertNoEnvVarCollision === undefined || actualDeriveSecretNames === undefined) {
    throw new Error('Expected module mock passthrough implementations to be initialized.');
  }
  envVarNameMocks.assertNoEnvVarCollision.mockReset();
  envVarNameMocks.assertNoEnvVarCollision.mockImplementation(actualAssertNoEnvVarCollision);
  secretNamingMocks.deriveSecretNames.mockReset();
  secretNamingMocks.deriveSecretNames.mockImplementation(actualDeriveSecretNames);
});

const TEST_DIR = '/workspace/tests';
const RUNS_DIR = '/workspace/tests/.runs';
const TARGETS = { web: { baseUrl: 'https://example.test', browser: 'chromium' } } as const;
const RESOLVED_TARGETS = { web: { ...TARGETS.web, healReplayIsolation: 'stateful' as const } } as const;
const PROMPT = '# Sign in\n\nWhen I submit valid credentials, I reach the dashboard.\n';
const RESPONSE: GeneratedPlanResponse = { steps: [], ambiguities: [] };
const FIRST_SECRET_REF = '{{secrets.FOO}}';
const PASSWORD_TARGET = { strategy: 'accessibility', role: 'textbox', name: 'Password' } as const;
const INSTRUCTION_PROOF_FIELD = ['cita', 'tion'].join('');
const coveredResponse = {
  steps: [{
    id: 'reach-dashboard',
    kind: 'ai',
    instruction: 'Reach the dashboard.',
    instructionCoverage: [{
      id: 'dashboard-reached',
      kind: 'success',
      [INSTRUCTION_PROOF_FIELD]: 'When I submit valid credentials, I reach the dashboard.',
    }],
    verificationIntent: [{
      criterionId: 'dashboard-reached',
      assertion: { type: 'assert', check: 'text-visible', text: 'Dashboard' },
    }],
  }],
  ambiguities: [],
} as unknown as GeneratedPlanResponse;

const DEFAULT_OPTIONS: GenerateOptions = {
  files: [],
  strict: false,
  force: false,
  maxAttempts: 2,
  dryRun: false,
  allowEmpty: false,
  list: false,
};

interface RecordingStorage {
  readonly storage: StorageAdapter;
  readonly reads: string[];
  readonly exists: string[];
  readonly writes: { readonly path: string; readonly content: string }[];
  reset(): void;
}

function createRecordingStorage(
  fail: { readonly read?: string; readonly write?: string } = {},
): RecordingStorage {
  const backing = createInMemoryStorage();
  const reads: string[] = [];
  const exists: string[] = [];
  const writes: { path: string; content: string }[] = [];

  return {
    reads,
    exists,
    writes,
    storage: {
      ...backing,
      async readText(path) {
        reads.push(path);
        if (path === fail.read) {
          throw new Error(`read failed: ${path}`);
        }
        return backing.readText(path);
      },
      async exists(path) {
        exists.push(path);
        return backing.exists(path);
      },
      async writeText(path, content) {
        if (path === fail.write) {
          throw new Error(`write failed: ${path}`);
        }
        writes.push({ path, content });
        return backing.writeText(path, content);
      },
    },
    reset() {
      reads.splice(0);
      exists.splice(0);
      writes.splice(0);
    },
  };
}

function createScenario(overrides: Partial<GenerateDeps> = {}) {
  const recordingStorage = createRecordingStorage();
  const events = createRecordingEventSink();
  const execute = vi.fn(async (_request: AiExecuteRequest<unknown>) => ({
    data: RESPONSE,
    raw: JSON.stringify(RESPONSE),
  }));
  const deps: GenerateDeps = {
    storage: recordingStorage.storage,
    layout: createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR }),
    resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
    events: events.sink,
    clock: { now: () => new Date(0), monotonicMs: () => 0 },
    allocateCallId: createCallIdAllocator(),
    discoverTestFiles: vi.fn(async () => ['login.test.md']),
    config: {
      testDir: TEST_DIR,
      testMatch: ['**/*.test.md'],
      testIgnore: ['**/.runs/**'],
      targets: RESOLVED_TARGETS,
      defaultTarget: 'web',
      ai: { provider: 'codex', timeoutMs: 100, maxGenerateAttempts: 2 },
    },
    ...overrides,
  };

  return { deps, events, execute, recordingStorage };
}

function withSecretConfig(deps: GenerateDeps, allow: readonly string[] | '*'): GenerateDeps {
  return {
    ...deps,
    config: { ...deps.config, secrets: { allow }, projectRoot: '/workspace' } as unknown as GenerateDeps['config'],
    configSource: { path: '/workspace/ambercast.config.json' },
  } as unknown as GenerateDeps;
}

function sequenceClock(readings: readonly number[]): Clock {
  let index = 0;
  return {
    now: () => new Date(0),
    monotonicMs() {
      const reading = readings[index];
      index += 1;
      if (reading === undefined) {
        throw new Error(`Unexpected monotonic clock read ${index}.`);
      }
      return reading;
    },
  };
}

function aiEvents(events: readonly RunEvent[]): readonly RunEvent[] {
  return events.filter((event) => event.type === 'ai-call' || event.type === 'ai-result');
}

function aiCallEvents(events: readonly RunEvent[]) {
  return events.filter((event) => event.type === 'ai-call');
}

function interceptTimeouts(controllersByTimeoutMs: ReadonlyMap<number, AbortController>) {
  return vi.spyOn(AbortSignal, 'timeout').mockImplementation((timeoutMs) => {
    const controller = controllersByTimeoutMs.get(timeoutMs);
    if (controller === undefined) {
      throw new Error(`Unexpected deadline timeout: ${timeoutMs}`);
    }
    return controller.signal;
  });
}

function captureComposedTimeoutSignals(timeoutSignals: readonly AbortSignal[]): AbortSignal[] {
  const originalAny = AbortSignal.any;
  const composedTimeoutSignals: AbortSignal[] = [];

  vi.spyOn(AbortSignal, 'any').mockImplementation((signals) => {
    const timeoutSignal = signals.find((signal) => timeoutSignals.includes(signal));
    if (timeoutSignal !== undefined) {
      composedTimeoutSignals.push(timeoutSignal);
    }
    return originalAny.call(AbortSignal, signals);
  });

  return composedTimeoutSignals;
}

function sequentialTimeoutConfig(timeoutMsValues: readonly number[]) {
  let timeoutMsIndex = 0;

  return {
    provider: 'codex' as const,
    maxGenerateAttempts: 2,
    get timeoutMs() {
      const timeoutMs = timeoutMsValues[timeoutMsIndex];
      timeoutMsIndex += 1;
      if (timeoutMs === undefined) {
        throw new Error('Unexpected deadline creation.');
      }
      return timeoutMs;
    },
  };
}

async function writePrompt(storage: StorageAdapter, relativePath = 'login.test.md', contents = PROMPT): Promise<string> {
  const path = `${TEST_DIR}/${relativePath}`;
  await storage.writeText(path, contents);
  return path;
}

async function createFreshPlan(
  storage: StorageAdapter,
  testPath: string,
  steps: readonly Step[] = [],
  targetDefinitions: PlanDocument['targets'] = TARGETS,
): Promise<PlanDocument> {
  const layout = createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR });
  const normalizedTestMd = normalizeTestMd(await storage.readText(testPath));
  const inputsDigest = computeInputsDigest({
    normalizedTestMd,
    schemaVersion: 3,
    generatorPromptTemplateFingerprint: promptTemplateFingerprint(),
    planProducerBundleFingerprint: planProducerBundle.planProducerBundleFingerprint(),
    targetDefinitions,
  });
  const plan = {
    schemaVersion: 3,
    source: { inputsDigest },
    targets: targetDefinitions,
    steps: [...steps],
  } as unknown as PlanDocument;

  await storage.writeText(layout.planPathFor(testPath), toCanonicalArtifactText(plan as unknown as JsonValueT));
  return plan;
}

async function seedFreshArtifacts(
  storage: StorageAdapter,
  testPath: string,
  steps: readonly Step[] = [],
  targetDefinitions: PlanDocument['targets'] = TARGETS,
): Promise<void> {
  const layout = createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR });
  const plan = await createFreshPlan(storage, testPath, steps, targetDefinitions);
  const grounding: GroundingDocument = { schemaVersion: 1, planDigest: computePlanDigest(plan), entries: {} };

  await storage.writeText(
    layout.groundingPathFor(testPath),
    toCanonicalArtifactText(grounding as unknown as JsonValueT),
  );
}

describe('generate', () => {

  it('keeps the generated success-span fixture locally re-extractable from its prompt', () => {
    const result = validateCommittedInstructionCoverage([{
      id: 'dashboard-reached',
      kind: 'success',
      sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 56 },
    }], normalizeTestMd(PROMPT));

    expect(result).toEqual({
      success: true,
      data: [expect.objectContaining({ text: 'When I submit valid credentials, I reach the dashboard.' })],
    });
  });

  it.each([
    ['ordinary', DEFAULT_OPTIONS, 'generated', 2],
    ['forced', { ...DEFAULT_OPTIONS, force: true }, 'generated', 2],
    ['dry-run', { ...DEFAULT_OPTIONS, dryRun: true }, 'would-generate', 0],
  ] as const)(
    'attributes and discards provider-only instruction proof on the %s generation path',
    async (_mode, options, status, expectedWrites) => {
      const raw = JSON.stringify(coveredResponse);
      const { deps, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({
          execute: async () => ({ data: coveredResponse, raw }),
        }),
      });
      const testPath = await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, options);

      expect(outcome.results[0]).toMatchObject({ file: testPath, status });
      expect(recordingStorage.writes).toHaveLength(expectedWrites);
      if (options.dryRun) {
        return;
      }
      const planText = await recordingStorage.storage.readText(deps.layout.planPathFor(testPath));
      const plan = JSON.parse(planText) as Record<string, unknown>;
      expect(plan).toMatchObject({
        schemaVersion: 3,
        steps: [{
          id: 'reach-dashboard',
          kind: 'ai',
          instructionCoverage: [{
            id: 'dashboard-reached',
            kind: 'success',
            sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 56 },
          }],
        }],
      });
      expect(planText).not.toContain(INSTRUCTION_PROOF_FIELD);
      expect(planText).not.toContain('verificationIntent');
      expect(planText).not.toContain('When I submit valid credentials');
    },
  );

  it.each([
    ['missing success intent', [], ['verificationIntent', REDACTED_ISSUE_PATH_SEGMENT], 'intent-id-missing'],
    ['unknown success intent', [{ criterionId: 'unknown', assertion: { type: 'assert', check: 'text-visible', text: 'Dashboard' } }], ['verificationIntent', 0, 'criterionId'], 'intent-id-unknown'],
    ['duplicate success intent', [
      { criterionId: 'dashboard-reached', assertion: { type: 'assert', check: 'text-visible', text: 'Dashboard' } },
      { criterionId: 'dashboard-reached', assertion: { type: 'assert', check: 'text-visible', text: 'Dashboard' } },
    ], ['verificationIntent', 1, 'criterionId'], 'intent-id-duplicate'],
    ['unsupported assertion shape', [{
      criterionId: 'dashboard-reached',
      assertion: { type: 'assert', check: 'element-count', target: PASSWORD_TARGET, min: 0 },
    }], ['verificationIntent', 0, 'assertion'], 'intent-assertion-unsupported'],
    ['terminal url intent', [{ criterionId: 'dashboard-reached', assertion: { type: 'assert', check: 'url-matches', pattern: '/dashboard$' } }], ['verificationIntent', 0, 'assertion'], 'terminal-url-matches-forbidden'],
  ] as const)(
    'preserves raw response and a path for %s without writing either artifact',
    async (_name, verificationIntent, expectedPath, expectedCode) => {
      const response = {
        ...coveredResponse,
        steps: [{ ...coveredResponse.steps[0], verificationIntent }],
      } as unknown as GeneratedPlanResponse;
      const raw = `RAW:${JSON.stringify(response)}`;
      const execute = vi.fn(async () => ({ data: response, raw }));
      const { deps, events, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({
          execute,
        }),
      });
      await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, DEFAULT_OPTIONS);
      const error = outcome.results[0]?.error;

      expect(outcome.results[0]).toMatchObject({ status: 'failed' });
      expect(error).toBeInstanceOf(AiResponseInvalidError);
      expect(error).toMatchObject({
        details: {
          raw,
          issues: expect.arrayContaining([expect.objectContaining({ path: expectedPath, code: expectedCode })]),
        },
      });
      const attempts = expectedCode === 'terminal-url-matches-forbidden' ? 1 : DEFAULT_OPTIONS.maxAttempts;
      expect(execute).toHaveBeenCalledTimes(attempts);
      expect(aiCallEvents(events.emitted())).toHaveLength(attempts);
      expect(aiEvents(events.emitted())).toHaveLength(attempts * 2);
      expect(error).toMatchObject({ details: { attempts: Array.from({ length: attempts }, (_, index) => ({ attempt: index + 1, code: 'AI_RESPONSE_INVALID' })) } });
      expect(recordingStorage.writes).toEqual([]);
    },
  );

  it('preserves coverage-issue order around two redacted missing intent IDs without deduplication', async () => {
    const prompt = '# Sign in\n\nFirst success criterion.\nSecond success criterion.\n';
    const response = {
      ...coveredResponse,
      steps: [{
        ...coveredResponse.steps[0],
        instructionCoverage: [
          { id: 'first-ready', kind: 'success', [INSTRUCTION_PROOF_FIELD]: 'First success criterion.' },
          { id: 'second-ready', kind: 'success', [INSTRUCTION_PROOF_FIELD]: 'Second success criterion.' },
        ],
        verificationIntent: [{
          criterionId: 'unknown-ready',
          assertion: { type: 'assert', check: 'text-visible', text: 'Dashboard' },
        }],
      }],
    } as unknown as GeneratedPlanResponse;
    const raw = `RAW:${JSON.stringify(response)}`;
    const execute = vi.fn(async () => ({ data: response, raw }));
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
    });
    await writePrompt(recordingStorage.storage, 'login.test.md', prompt);
    recordingStorage.reset();

    const outcome = await generate(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toMatchObject({
      details: {
        raw,
        issues: [
          { code: 'intent-id-unknown', path: ['verificationIntent', 0, 'criterionId'] },
          { code: 'intent-id-missing', path: ['verificationIntent', REDACTED_ISSUE_PATH_SEGMENT] },
          { code: 'intent-id-missing', path: ['verificationIntent', REDACTED_ISSUE_PATH_SEGMENT] },
        ],
      },
    });
    expect(execute).toHaveBeenCalledTimes(DEFAULT_OPTIONS.maxAttempts);
    expect(outcome.results[0]?.error).toMatchObject({
      details: { attempts: [{ attempt: 1, code: 'AI_RESPONSE_INVALID' }, { attempt: 2, code: 'AI_RESPONSE_INVALID' }] },
    });
    expect(recordingStorage.writes).toEqual([]);
  });

  it('redacts a dynamic generatorMeta key when the policy-boundary Zod validation rejects it', async () => {
    const response = { steps: [], ambiguities: [], generatorMeta: { providerSecret: undefined } } as unknown as GeneratedPlanResponse;
    const raw = 'RAW:generator-meta-policy-failure';
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw }) }),
    });
    await writePrompt(recordingStorage.storage);
    recordingStorage.reset();

    const outcome = await generate(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toMatchObject({
      details: { raw, issues: [{ code: 'schema-mismatch', path: ['generatorMeta', REDACTED_ISSUE_PATH_SEGMENT] }] },
    });
    expect(recordingStorage.writes).toEqual([]);
  });

  it('redacts the dynamic target name and field when final PlanDocument validation rejects a target', async () => {
    const response = { steps: [], ambiguities: [] } as GeneratedPlanResponse;
    const raw = 'RAW:target-plan-failure';
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw }) }),
    });
    const invalidTargetDeps = {
      ...deps,
      config: {
        ...deps.config,
        targets: {
          ...deps.config.targets,
          web: { ...deps.config.targets.web, baseUrl: 'not a URL' },
        },
      },
    } as GenerateDeps;
    await writePrompt(recordingStorage.storage);
    recordingStorage.reset();

    const outcome = await generate(invalidTargetDeps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toMatchObject({
      details: { raw, issues: [{ code: 'schema-mismatch', path: ['targets', REDACTED_ISSUE_PATH_SEGMENT, REDACTED_ISSUE_PATH_SEGMENT] }] },
    });
    expect(recordingStorage.writes).toEqual([]);
  });

  it('rejects an action criterion named by terminal intent with raw output, path, and zero writes', async () => {
    const response = {
      ...coveredResponse,
      steps: [{
        id: 'reach-dashboard',
        kind: 'ai',
        instruction: 'Reach the dashboard.',
        instructionCoverage: [
          {
            id: 'dashboard-reached',
            kind: 'success',
            [INSTRUCTION_PROOF_FIELD]: 'When I submit valid credentials, I reach the dashboard.',
          },
          { id: 'sign-in-action', kind: 'action', [INSTRUCTION_PROOF_FIELD]: '# Sign in' },
        ],
        verificationIntent: [
          {
            criterionId: 'dashboard-reached',
            assertion: { type: 'assert', check: 'text-visible', text: 'Dashboard' },
          },
          { criterionId: 'sign-in-action', assertion: { type: 'assert', check: 'text-visible', text: 'Sign in' } },
        ],
      }],
    } as unknown as GeneratedPlanResponse;
    const raw = `RAW:${JSON.stringify(response)}`;
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw }) }),
    });
    await writePrompt(recordingStorage.storage);
    recordingStorage.reset();

    const outcome = await generate(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(AiResponseInvalidError);
    expect(outcome.results[0]?.error).toMatchObject({
      details: {
        raw,
        issues: expect.arrayContaining([expect.objectContaining({
          path: ['verificationIntent', 1, 'criterionId'],
        })]),
      },
    });
    expect(recordingStorage.writes).toEqual([]);
  });

  it('rejects action-only coverage with empty intent while preserving raw/path evidence and zero writes', async () => {
    const response = {
      ...coveredResponse,
      steps: [{
        ...coveredResponse.steps[0],
        instructionCoverage: [{ id: 'sign-in-action', kind: 'action', [INSTRUCTION_PROOF_FIELD]: '# Sign in' }],
        verificationIntent: [],
      }],
    } as unknown as GeneratedPlanResponse;
    const raw = `RAW:${JSON.stringify(response)}`;
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw }) }),
    });
    await writePrompt(recordingStorage.storage);
    recordingStorage.reset();

    const outcome = await generate(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(AiResponseInvalidError);
    expect(outcome.results[0]?.error).toMatchObject({
      details: {
        raw,
        issues: expect.arrayContaining([expect.objectContaining({
          code: 'success-criterion-missing',
          path: ['instructionCoverage'],
        })]),
      },
    });
    expect(recordingStorage.writes).toEqual([]);
  });

  it.each([
    ['missing', 'This proof is absent.', PROMPT],
    ['ambiguous', 'When I submit valid credentials, I reach the dashboard.', `${PROMPT}When I submit valid credentials, I reach the dashboard.\n`],
  ] as const)('rejects a %s instruction proof with raw/path evidence and zero writes', async (_name, proof, prompt) => {
    const response = {
      ...coveredResponse,
      steps: [{
        ...coveredResponse.steps[0],
        instructionCoverage: [{ id: 'dashboard-reached', kind: 'success', [INSTRUCTION_PROOF_FIELD]: proof }],
      }],
    } as unknown as GeneratedPlanResponse;
    const raw = `RAW:${JSON.stringify(response)}`;
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw }) }),
    });
    await writePrompt(recordingStorage.storage, 'login.test.md', prompt);
    recordingStorage.reset();

    const outcome = await generate(deps, DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(AiResponseInvalidError);
    expect(outcome.results[0]?.error).toMatchObject({
      details: {
        raw,
        issues: expect.arrayContaining([expect.objectContaining({
          path: ['instructionCoverage', 0, INSTRUCTION_PROOF_FIELD],
        })]),
      },
    });
    expect(recordingStorage.writes).toEqual([]);
  });

  it.each([
    ['lone high surrogate', '\uD83D'],
    ['lone low surrogate', '\uDE00'],
  ] as const)(
    'rejects a %s provider proof against emoji text with raw/path evidence and zero writes',
    async (_name, proof) => {
      const response = {
        ...coveredResponse,
        steps: [{
          ...coveredResponse.steps[0],
          instructionCoverage: [{ id: 'dashboard-reached', kind: 'success', [INSTRUCTION_PROOF_FIELD]: proof }],
        }],
      } as unknown as GeneratedPlanResponse;
      const raw = `RAW:${JSON.stringify(response)}`;
      const { deps, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw }) }),
      });
      await writePrompt(recordingStorage.storage, 'login.test.md', '# Emoji\n\n😀 Ready\n');
      recordingStorage.reset();

      const outcome = await generate(deps, DEFAULT_OPTIONS);

      expect(outcome.results[0]?.error).toBeInstanceOf(AiResponseInvalidError);
      expect(outcome.results[0]?.error).toMatchObject({
        details: {
          raw,
          issues: expect.arrayContaining([expect.objectContaining({
            path: ['instructionCoverage', 0, INSTRUCTION_PROOF_FIELD],
          })]),
        },
      });
      expect(recordingStorage.writes).toEqual([]);
    },
  );

  it.each([
    ['text-visible', { type: 'assert', check: 'text-visible', text: 'Dashboard' }],
    ['text-equals', { type: 'assert', check: 'text-equals', target: PASSWORD_TARGET, text: 'Dashboard' }],
    ['element-visible', { type: 'assert', check: 'element-visible', target: PASSWORD_TARGET }],
    ['element-count exact zero', { type: 'assert', check: 'element-count', target: PASSWORD_TARGET, count: 0 }],
  ] as const)('accepts provider terminal intent vocabulary %s', async (_name, assertion) => {
    const response = {
      ...coveredResponse,
      steps: [{
        ...coveredResponse.steps[0],
        verificationIntent: [{ criterionId: 'dashboard-reached', assertion }],
      }],
    } as unknown as GeneratedPlanResponse;
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw: JSON.stringify(response) }) }),
    });
    await writePrompt(recordingStorage.storage);

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      results: [{ status: 'generated' }],
    });
  });

  it('prefixes the deterministic generation task with the exact exported generator policy', async () => {
    let request: AiExecuteRequest<unknown> | undefined;
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({
        execute: async (nextRequest) => {
          request = nextRequest;
          return { data: coveredResponse, raw: JSON.stringify(coveredResponse) };
        },
      }),
    });
    await writePrompt(recordingStorage.storage);

    await generate(deps, DEFAULT_OPTIONS);

    expect(request?.prompt).toBe(
      `${GENERATOR_INSTRUCTION_COVERAGE_POLICY_TEMPLATE.trim()}\n\n${GENERATOR_SECRET_POLICY_TEMPLATE.trim()}\n\nGenerate a deterministic ambercast execution plan.`,
    );
    expect(request?.context).toEqual({
      testMd: normalizeTestMd(PROMPT),
      targets: TARGETS,
      allowedSecretNames: [], // SPEC-C1 C1-10
    });
    expect(request?.responseSchema).toMatchObject({
      type: 'object',
      properties: {
        steps: expect.objectContaining({ type: 'array' }),
        ambiguities: expect.objectContaining({ type: 'array' }),
      },
    });

    const responseSchema = request?.responseSchema as Record<string, unknown>;
    const properties = responseSchema.properties as Record<string, unknown>;
    const steps = properties.steps as Record<string, unknown>;
    const items = steps.items;

    function findAiSchemas(node: unknown): Record<string, unknown>[] {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) {
        return [];
      }

      const schemaNode = node as Record<string, unknown>;
      const matches: Record<string, unknown>[] = [];
      const nodeProperties = schemaNode.properties;
      if (
        typeof nodeProperties === 'object'
        && nodeProperties !== null
        && !Array.isArray(nodeProperties)
        && Object.hasOwn(nodeProperties, 'verificationIntent')
      ) {
        matches.push(schemaNode);
      }

      for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
        const alternatives = schemaNode[keyword];
        if (Array.isArray(alternatives)) {
          for (const alternative of alternatives) {
            matches.push(...findAiSchemas(alternative));
          }
        }
      }

      return matches;
    }

    const aiSchemas = findAiSchemas(items);

    expect(aiSchemas).toHaveLength(1);
    const aiProperties = (aiSchemas[0] as Record<string, unknown>).properties as Record<string, unknown>;
    const verificationIntent = aiProperties.verificationIntent as Record<string, unknown>;
    expect(verificationIntent.minItems).toBeUndefined();
  });

  it('uses configured discovery when files are absent and reports deterministic discovered paths', async () => {
    const { deps, recordingStorage } = createScenario({ discoverTestFiles: async () => ['a.test.md', 'z.test.md'] });
    await writePrompt(recordingStorage.storage, 'a.test.md');
    await writePrompt(recordingStorage.storage, 'z.test.md');
    recordingStorage.reset();

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      noTestsFound: false,
      results: [
        { file: `${TEST_DIR}/a.test.md`, status: 'generated' },
        { file: `${TEST_DIR}/z.test.md`, status: 'generated' },
      ],
    });
  });

  it('embeds configured secret-sink origins verbatim in a generated plan target snapshot', async () => {
    const targets = {
      web: {
        baseUrl: 'https://example.test',
        browser: 'chromium' as const,
        secretSinkOrigins: { '{{secrets.app.password}}': ['https://idp.example.test'] },
        healReplayIsolation: 'stateful' as const,
      },
    };
    const { deps, recordingStorage } = createScenario({
      config: {
        testDir: TEST_DIR,
        testMatch: ['**/*.test.md'],
        testIgnore: ['**/.runs/**'],
        targets,
        defaultTarget: 'web',
        ai: { provider: 'codex', timeoutMs: 100, maxGenerateAttempts: 2 },
      },
    });
    await writePrompt(recordingStorage.storage);

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      results: [{ status: 'generated' }],
    });

    const plan = PlanDocument.parse(JSON.parse(await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.plan.json`)));
    expect(plan.targets).toEqual({
      web: {
        baseUrl: targets.web.baseUrl,
        browser: targets.web.browser,
        secretSinkOrigins: targets.web.secretSinkOrigins,
      },
    });
  });

  it.each([
    ['default', DEFAULT_OPTIONS],
    ['allow-empty', { ...DEFAULT_OPTIONS, allowEmpty: true }],
    ['list', { ...DEFAULT_OPTIONS, list: true }],
  ] as const)('reports a zero match for %s policy without calling AI', async (_policy, options) => {
    const { deps, execute } = createScenario({ discoverTestFiles: async () => [] });

    await expect(generate(deps, options)).resolves.toEqual({ results: [], noTestsFound: true, interrupted: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it('gives list precedence over dry-run, force, and strict without reading prompts or writing artifacts', async () => {
    const { deps, events, execute, recordingStorage } = createScenario({ discoverTestFiles: async () => ['login.test.md'] });

    await expect(generate(deps, { ...DEFAULT_OPTIONS, list: true, dryRun: true, force: true, strict: true }))
      .resolves.toEqual({ results: [{ file: `${TEST_DIR}/login.test.md`, status: 'listed' }], noTestsFound: false, interrupted: false });
    expect(execute).not.toHaveBeenCalled();
    expect(events.emitted()).toEqual([]);
    expect(recordingStorage.reads).toEqual([]);
    expect(recordingStorage.writes).toEqual([]);
  });

  it('never resolves AI for list mode with an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(new Error('list remains atomic'));
    const resolveAiExecutor = vi.fn(async () => createFakeAiExecutor());
    const { deps } = createScenario({
      signal: controller.signal,
      discoverTestFiles: async () => ['login.test.md'],
      resolveAiExecutor,
    });

    await expect(generate(deps, { ...DEFAULT_OPTIONS, list: true })).resolves.toEqual({
      results: [{ file: `${TEST_DIR}/login.test.md`, status: 'listed' }],
      noTestsFound: false,
      interrupted: false,
    });
    expect(resolveAiExecutor).not.toHaveBeenCalled();
  });

  it.each([
    ['outside the test directory', '/workspace/outside.test.md', 'outside-test-dir'],
    ['inside the test directory without the test suffix', `${TEST_DIR}/login.md`, 'not-test-md'],
    ['anonymous inside the test directory', `${TEST_DIR}/.test.md`, 'no-name'],
  ] as const)('rejects a literal prompt path %s before generation work begins', async (_description, path, reason) => {
    const { deps } = createScenario();

    await expect(generate(deps, { ...DEFAULT_OPTIONS, files: [path] })).rejects.toMatchObject({
      kind: 'prompt-path-invalid',
      exitCode: 2,
      details: { path, reason },
    } satisfies Partial<PromptPathInvalidError>);
  });

  it('processes a boundary-valid direct child of testDir without a prompt-path error', async () => {
    const { deps, recordingStorage } = createScenario();
    const path = await writePrompt(recordingStorage.storage, 'x.test.md');

    await expect(generate(deps, { ...DEFAULT_OPTIONS, files: [path] })).resolves.toMatchObject({
      results: [{ file: path, status: 'generated' }],
      noTestsFound: false,
    });
  });

  it('keeps list mode lenient for an ineligible literal prompt path', async () => {
    const { deps } = createScenario();
    const path = '/workspace/outside.test.md';

    await expect(generate(deps, { ...DEFAULT_OPTIONS, files: [path], list: true })).resolves.toEqual({
      results: [{ file: path, status: 'listed' }],
      noTestsFound: false,
      interrupted: false,
    });
  });

  it('preflights the whole selection before reading an eligible first prompt or resolving AI', async () => {
    const resolveAiExecutor = vi.fn(async () => createFakeAiExecutor());
    const { deps, recordingStorage } = createScenario({ resolveAiExecutor });
    const eligiblePath = await writePrompt(recordingStorage.storage, 'eligible.test.md');
    const ineligiblePath = `${TEST_DIR}/ineligible.md`;
    recordingStorage.reset();

    await expect(generate(deps, {
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

    await expect(generate(deps, { ...DEFAULT_OPTIONS, files: [path] })).rejects.toMatchObject({
      kind: 'prompt-path-invalid',
      details: { path, reason: 'not-test-md' },
    } satisfies Partial<PromptPathInvalidError>);
  });

  it('reports the first ineligible file reason in document order', async () => {
    const { deps } = createScenario();
    const firstPath = `${TEST_DIR}/.test.md`;
    const secondPath = '/workspace/outside.test.md';

    await expect(generate(deps, { ...DEFAULT_OPTIONS, files: [firstPath, secondPath] })).rejects.toMatchObject({
      kind: 'prompt-path-invalid',
      details: { path: firstPath, reason: 'no-name' },
    } satisfies Partial<PromptPathInvalidError>);
  });

  it('rejects a discovery-sourced anonymous test file before prompt I/O', async () => {
    const discoverTestFiles = vi.fn(async () => ['.test.md']);
    const { deps, recordingStorage } = createScenario({ discoverTestFiles });
    const path = `${TEST_DIR}/.test.md`;

    await expect(generate(deps, DEFAULT_OPTIONS)).rejects.toMatchObject({
      kind: 'prompt-path-invalid',
      details: { path, reason: 'no-name' },
    } satisfies Partial<PromptPathInvalidError>);
    expect(discoverTestFiles).toHaveBeenCalledOnce();
    expect(recordingStorage.reads).toEqual([]);
  });

  it('never resolves AI when discovery finds no tests outside list mode', async () => {
    const resolveAiExecutor = vi.fn(async () => createFakeAiExecutor());
    const { deps } = createScenario({ discoverTestFiles: async () => [], resolveAiExecutor });

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toEqual({
      results: [],
      noTestsFound: true,
      interrupted: false,
    });
    expect(resolveAiExecutor).not.toHaveBeenCalled();
  });

  it('never resolves AI for an all-fresh batch while repairing stale grounding', async () => {
    const resolveAiExecutor = vi.fn(async () => createFakeAiExecutor());
    const { deps, recordingStorage } = createScenario({
      discoverTestFiles: async () => ['first.test.md', 'second.test.md'],
      resolveAiExecutor,
    });
    const first = await writePrompt(recordingStorage.storage, 'first.test.md', 'first');
    const second = await writePrompt(recordingStorage.storage, 'second.test.md', 'second');
    const firstPlan = await createFreshPlan(recordingStorage.storage, first);
    await seedFreshArtifacts(recordingStorage.storage, second);
    recordingStorage.reset();

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toEqual({
      results: [
        {
          file: first,
          status: 'skipped-fresh',
          planFile: `${TEST_DIR}/first.ambercast.plan.json`,
          durationMs: 0,
          aiCalls: 0,
        },
        {
          file: second,
          status: 'skipped-fresh',
          planFile: `${TEST_DIR}/second.ambercast.plan.json`,
          durationMs: 0,
          aiCalls: 0,
        },
      ],
      noTestsFound: false,
      interrupted: false,
    });
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    expect(JSON.parse(await recordingStorage.storage.readText(`${TEST_DIR}/first.ambercast.grounding.json`))).toEqual({
      schemaVersion: 1,
      planDigest: computePlanDigest(firstPlan),
      entries: {},
    });
  });

  it('resolves once and reuses the same executor instance across a multi-file batch', async () => {
    const dispatchedBy: object[] = [];
    const trackedExecutor = () => {
      const instance: ReturnType<typeof createFakeAiExecutor> = createFakeAiExecutor({
        execute: async () => {
          dispatchedBy.push(instance);
          return { data: RESPONSE, raw: JSON.stringify(RESPONSE) };
        },
      });
      return instance;
    };
    const executors = [trackedExecutor(), trackedExecutor(), trackedExecutor()];
    let nextExecutor = 0;
    const resolveAiExecutor = vi.fn(async () => {
      const executor = executors[nextExecutor];
      nextExecutor += 1;
      if (executor === undefined) {
        throw new Error('The resolver was called more times than this batch allows.');
      }
      return executor;
    });
    const { deps, recordingStorage } = createScenario({
      discoverTestFiles: async () => ['first.test.md', 'second.test.md', 'third.test.md'],
      resolveAiExecutor,
    });
    await writePrompt(recordingStorage.storage, 'first.test.md', 'first');
    await writePrompt(recordingStorage.storage, 'second.test.md', 'second');
    await writePrompt(recordingStorage.storage, 'third.test.md', 'third');
    recordingStorage.reset();

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      results: [
        { file: `${TEST_DIR}/first.test.md`, status: 'generated' },
        { file: `${TEST_DIR}/second.test.md`, status: 'generated' },
        { file: `${TEST_DIR}/third.test.md`, status: 'generated' },
      ],
    });
    expect(resolveAiExecutor).toHaveBeenCalledTimes(1);
    expect(dispatchedBy).toEqual([executors[0], executors[0], executors[0]]);
  });

  it('does not resolve AI for a dry-run containing only fresh non-forced prompts', async () => {
    const resolveAiExecutor = vi.fn(async () => createFakeAiExecutor());
    const { deps, recordingStorage } = createScenario({ resolveAiExecutor });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath);
    recordingStorage.reset();

    await expect(generate(deps, { ...DEFAULT_OPTIONS, dryRun: true })).resolves.toMatchObject({
      results: [{ file: testPath, status: 'skipped-fresh' }],
    });
    expect(resolveAiExecutor).not.toHaveBeenCalled();
  });

  it('resolves AI for a dry-run containing a stale prompt', async () => {
    const execute = vi.fn(async () => ({ data: RESPONSE, raw: JSON.stringify(RESPONSE) }));
    const resolveAiExecutor = vi.fn(async () => createFakeAiExecutor({ execute }));
    const { deps, recordingStorage } = createScenario({ resolveAiExecutor });
    const testPath = await writePrompt(recordingStorage.storage);
    recordingStorage.reset();

    await expect(generate(deps, { ...DEFAULT_OPTIONS, dryRun: true })).resolves.toMatchObject({
      results: [{ file: testPath, status: 'would-generate' }],
    });
    expect(resolveAiExecutor).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('constructs the deadline and emits ai-call only after a pending resolver fulfills', async () => {
    const order: string[] = [];
    const timeoutController = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      order.push('deadline');
      return timeoutController.signal;
    });
    const events = { emit: vi.fn((event: { readonly type: string }) => { order.push(event.type); }) };
    const executor = createFakeAiExecutor({
      execute: async () => {
        order.push('execute');
        return { data: RESPONSE, raw: JSON.stringify(RESPONSE) };
      },
    });
    let releaseResolver!: (executor: ReturnType<typeof createFakeAiExecutor>) => void;
    let markResolverStarted!: () => void;
    const resolverStarted = new Promise<void>((resolve) => { markResolverStarted = resolve; });
    const resolveAiExecutor = vi.fn(() => new Promise<ReturnType<typeof createFakeAiExecutor>>((resolve) => {
      releaseResolver = resolve;
      markResolverStarted();
    }));
    const { deps, recordingStorage } = createScenario({ events, resolveAiExecutor });
    await writePrompt(recordingStorage.storage);
    recordingStorage.reset();

    try {
      const running = generate(deps, DEFAULT_OPTIONS);
      await resolverStarted;
      expect(timeoutSpy).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();

      releaseResolver(executor);
      await expect(running).resolves.toMatchObject({ results: [{ status: 'generated' }] });

      expect(order).toEqual(['deadline', 'ai-call', 'execute', 'ai-result']);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('emits neither a deadline nor ai-call when a pending resolver rejects', async () => {
    const rejection = new Error('provider resolution failed');
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const events = createRecordingEventSink();
    let rejectResolver!: (error: Error) => void;
    let markResolverStarted!: () => void;
    const resolverStarted = new Promise<void>((resolve) => { markResolverStarted = resolve; });
    const resolveAiExecutor = vi.fn(() => new Promise<never>((_resolve, reject) => {
      rejectResolver = reject;
      markResolverStarted();
    }));
    const { deps, recordingStorage } = createScenario({ events: events.sink, resolveAiExecutor });
    await writePrompt(recordingStorage.storage);
    recordingStorage.reset();

    try {
      const running = generate(deps, DEFAULT_OPTIONS);
      await resolverStarted;
      rejectResolver(rejection);

      await expect(running).rejects.toBe(rejection);
      expect(timeoutSpy).not.toHaveBeenCalled();
      expect(events.emitted()).toEqual([]);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('propagates a plain resolver rejection unchanged without producing file results', async () => {
    const rejection = new Error('plain provider resolution rejection');
    const resolveAiExecutor = vi.fn(async () => { throw rejection; });
    const { deps, events, execute, recordingStorage } = createScenario({ resolveAiExecutor });
    await writePrompt(recordingStorage.storage);

    await expect(generate(deps, DEFAULT_OPTIONS)).rejects.toBe(rejection);
    expect(execute).not.toHaveBeenCalled();
    expect(events.emitted()).toEqual([]);
  });

  it('propagates an Ambercast resolver rejection unchanged without producing file results', async () => {
    const rejection = new AiExecutorUnavailableError('classified provider resolution rejection');
    const resolveAiExecutor = vi.fn(async () => { throw rejection; });
    const { deps, events, execute, recordingStorage } = createScenario({ resolveAiExecutor });
    await writePrompt(recordingStorage.storage);

    await expect(generate(deps, DEFAULT_OPTIONS)).rejects.toBe(rejection);
    expect(execute).not.toHaveBeenCalled();
    expect(events.emitted()).toEqual([]);
  });

  it('keeps Stage 1 artifact-free when later resolver resolution rejects', async () => {
    const rejection = new Error('second file needs an unavailable provider');
    const resolveAiExecutor = vi.fn(async () => { throw rejection; });
    const { deps, recordingStorage } = createScenario({
      discoverTestFiles: async () => ['fresh.test.md', 'stale.test.md', 'unused.test.md'],
      resolveAiExecutor,
    });
    const fresh = await writePrompt(recordingStorage.storage, 'fresh.test.md', 'fresh');
    await writePrompt(recordingStorage.storage, 'stale.test.md', 'stale');
    await writePrompt(recordingStorage.storage, 'unused.test.md', 'unused');
    await createFreshPlan(recordingStorage.storage, fresh);
    recordingStorage.reset();

    await expect(generate(deps, DEFAULT_OPTIONS)).rejects.toBe(rejection);
    expect(resolveAiExecutor).toHaveBeenCalledOnce();
    await expect(recordingStorage.storage.exists(`${TEST_DIR}/fresh.ambercast.grounding.json`)).resolves.toBe(false);
  });

  it('propagates caller abort during resolver resolution with the exact supplied signal', async () => {
    const controller = new AbortController();
    const reason = new Error('abort pending provider resolution');
    let markResolverStarted!: () => void;
    const resolverStarted = new Promise<void>((resolve) => { markResolverStarted = resolve; });
    const resolveAiExecutor = vi.fn((signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      if (signal === undefined) {
        throw new Error('generate must pass its caller signal to the resolver.');
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      markResolverStarted();
    }));
    const { deps, events, recordingStorage } = createScenario({
      signal: controller.signal,
      resolveAiExecutor,
    });
    await writePrompt(recordingStorage.storage);

    const running = generate(deps, DEFAULT_OPTIONS);
    await resolverStarted;
    controller.abort(reason);

    await expect(running).rejects.toBe(reason);
    expect(resolveAiExecutor).toHaveBeenCalledExactlyOnceWith(controller.signal);
    expect(events.emitted()).toEqual([]);
  });

  it('skips a valid canonical fresh plan without calling AI or rewriting artifacts', async () => {
    const { deps, events, execute, recordingStorage } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath);
    recordingStorage.reset();
    const derive = vi.spyOn(planInputProvenance, 'deriveCurrentPlanInputProvenance');

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      results: [{ file: testPath, status: 'skipped-fresh', planFile: `${TEST_DIR}/login.ambercast.plan.json` }],
    });
    expect(derive).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(events.emitted()).toEqual([]);
    expect(recordingStorage.writes).toEqual([]);
  });

  it('skips a current-digest covered AI plan only after committed coverage policy accepts it', async () => {
    const { deps, events, execute, recordingStorage } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [{
      id: 'reach-dashboard',
      kind: 'ai',
      instruction: 'Reach the dashboard.',
      instructionCoverage: [{
        id: 'dashboard-reached',
        kind: 'success',
        sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 56 },
      }],
    } as unknown as Step]);
    recordingStorage.reset();

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      results: [{ file: testPath, status: 'skipped-fresh' }],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(events.emitted()).toEqual([]);
    expect(recordingStorage.writes).toEqual([]);
  });

  it.each([
    ['out-of-range span', [{
      id: 'dashboard-reached',
      kind: 'success',
      sourceSpan: { startLine: 99, startColumn: 1, endLine: 99, endColumn: 2 },
    }]],
    ['noncanonical order', [
      {
        id: 'dashboard-reached',
        kind: 'success',
        sourceSpan: { startLine: 3, startColumn: 33, endLine: 3, endColumn: 56 },
      },
      {
        id: 'submit-action',
        kind: 'action',
        sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 32 },
      },
    ]],
    ['duplicate criterion ID', [
      {
        id: 'dashboard-reached',
        kind: 'success',
        sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 },
      },
      {
        id: 'dashboard-reached',
        kind: 'success',
        sourceSpan: { startLine: 3, startColumn: 6, endLine: 3, endColumn: 10 },
      },
    ]],
  ] as const)(
    'does not skip a same-digest AI plan with %s and regenerates or previews it',
    async (_name, instructionCoverage) => {
      for (const dryRun of [false, true]) {
        const { deps, events, execute, recordingStorage } = createScenario();
        const testPath = await writePrompt(recordingStorage.storage);
        await seedFreshArtifacts(recordingStorage.storage, testPath, [{
          id: 'reach-dashboard',
          kind: 'ai',
          instruction: 'Reach the dashboard.',
          instructionCoverage,
        } as unknown as Step]);
        recordingStorage.reset();

        await expect(generate(deps, { ...DEFAULT_OPTIONS, dryRun })).resolves.toMatchObject({
          results: [{
            file: testPath,
            status: dryRun ? 'would-generate' : 'generated',
          }],
        });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(aiCallEvents(events.emitted())).toHaveLength(1);
        expect(aiEvents(events.emitted())).toHaveLength(2);
        expect(recordingStorage.writes).toHaveLength(dryRun ? 0 : 2);
      }
    },
  );

  it.each([
    [false, { dryRun: false }],
    [true, { dryRun: true }],
  ] as const)('handles an unauthorized fresh plan without calling AI in dry-run=%s', async (dryRun, options) => {
    const secretRef = FIRST_SECRET_REF;
    const scenario = createScenario();
    const deps = withSecretConfig(scenario.deps, []);
    const testPath = await writePrompt(scenario.recordingStorage.storage);
    await seedFreshArtifacts(scenario.recordingStorage.storage, testPath, [{
      id: 'fill-password',
      kind: 'action',
      action: 'fill-secret',
      target: PASSWORD_TARGET,
      secretRef,
    }]);
    scenario.recordingStorage.reset();

    if (!dryRun) {
      await expect(generate(deps, { ...DEFAULT_OPTIONS, ...options })).rejects.toBeInstanceOf(UnexpectedCrashError);
      return;
    }
    const outcome = await generate(deps, { ...DEFAULT_OPTIONS, ...options });

    if (dryRun) {
      expect(outcome.results).toMatchObject([{
        file: testPath,
        status: 'skipped-fresh',
        planFile: `${TEST_DIR}/login.ambercast.plan.json`,
        secrets: [{
          name: 'FOO',
          stepId: 'fill-password',
          envVar: 'AMBERCAST_SECRET_FOO',
          allowed: false,
          selectionSource: 'existing-plan',
        }],
        durationMs: expect.any(Number),
        aiCalls: 0,
      }]);
    } else {
      expect(outcome.results).toMatchObject([{
        file: testPath,
        status: 'skipped-fresh',
      }]);
      expect(Object.hasOwn(outcome.results[0] ?? {}, 'secrets')).toBe(false);
    }
    expect(scenario.execute).not.toHaveBeenCalled();
  });

  it('sorts skipped-fresh reuse warnings by UTF-16 code units rather than host locale order', async () => {
    const { deps, recordingStorage, execute } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [
      { id: 'z-first', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Z first' }, secretRef: '{{secrets.Z}}' },
      { id: 'z-second', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Z second' }, secretRef: '{{secrets.Z}}' },
      { id: 'a-first', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'A first' }, secretRef: '{{secrets.a}}' },
      { id: 'a-second', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'A second' }, secretRef: '{{secrets.a}}' },
    ] as unknown as Step[]);
    recordingStorage.reset();

    const outcome = await generate(deps, { ...DEFAULT_OPTIONS, dryRun: true });

    expect(outcome.results[0]).toMatchObject({
      status: 'skipped-fresh',
      warnings: [
        { kind: 'secret-name-reused-across-targets', name: 'Z', stepIds: ['z-first', 'z-second'] },
        { kind: 'secret-name-reused-across-targets', name: 'a', stepIds: ['a-first', 'a-second'] },
      ],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('treats a v1-tagged grounding document as stale, rewrites it empty, and keeps the plan fresh', async () => {
    const { deps, execute, recordingStorage } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    const plan = await createFreshPlan(recordingStorage.storage, testPath);
    const groundingPath = `${TEST_DIR}/login.ambercast.grounding.json`;
    await recordingStorage.storage.writeText(groundingPath, toCanonicalArtifactText({
      schemaVersion: 1,
      planDigest: computePlanDigest(plan),
      entries: {
        'click-submit': {
          kind: 'element',
          fingerprint: { algorithm: 'a11y-neighborhood-v1', hash: 'a'.repeat(64) },
        },
        'still-valid-v2': {
          kind: 'element',
          fingerprint: { algorithm: 'a11y-neighborhood-v2', hash: 'b'.repeat(64) },
        },
      },
    } as unknown as JsonValueT));
    recordingStorage.reset();

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      results: [{ file: testPath, status: 'skipped-fresh' }],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(recordingStorage.writes).toEqual([expect.objectContaining({ path: groundingPath })]);
    const rewrittenGrounding = JSON.parse(await recordingStorage.storage.readText(groundingPath)) as {
      readonly schemaVersion: number;
      readonly planDigest: string;
      readonly entries: unknown;
    };
    expect(rewrittenGrounding).toMatchObject({
      schemaVersion: 1,
      planDigest: computePlanDigest(plan),
    });
    expect(rewrittenGrounding.entries).toStrictEqual({});
  });

  it.each([
    ['a stale plan', { force: false, dryRun: false }, 'generated'],
    ['a fresh plan forced to regenerate', { force: true, dryRun: false }, 'generated'],
    ['a stale plan in dry-run', { force: false, dryRun: true }, 'would-generate'],
    ['a fresh plan forced in dry-run', { force: true, dryRun: true }, 'would-generate'],
  ] as const)('generates or previews %s according to force and dry-run policy', async (_description, policy, status) => {
    const { deps, events, execute, recordingStorage } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    if (policy.force) {
      await seedFreshArtifacts(recordingStorage.storage, testPath);
    } else {
      await recordingStorage.storage.writeText(`${TEST_DIR}/login.ambercast.plan.json`, '{ malformed');
    }
    recordingStorage.reset();

    await expect(generate(deps, { ...DEFAULT_OPTIONS, ...policy })).resolves.toMatchObject({
      results: [{ file: testPath, status }],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(aiCallEvents(events.emitted())).toHaveLength(1);
    expect(aiEvents(events.emitted())).toHaveLength(2);
    expect(recordingStorage.writes.length).toBe(policy.dryRun ? 0 : 2);
  });

  it('regenerates a schema-valid plan whose inputs digest is stale', async () => {
    const { deps, execute, recordingStorage } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    const freshPlan = await createFreshPlan(recordingStorage.storage, testPath);
    await recordingStorage.storage.writeText(
      `${TEST_DIR}/login.ambercast.plan.json`,
      toCanonicalArtifactText({ ...freshPlan, source: { inputsDigest: 'f'.repeat(64) } } as JsonValueT),
    );
    recordingStorage.reset();

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({ results: [{ status: 'generated' }] });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('regenerates a schema-invalid existing plan instead of treating its matching-looking file as fresh', async () => {
    const { deps, execute, recordingStorage } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    const freshPlan = await createFreshPlan(recordingStorage.storage, testPath);
    await recordingStorage.storage.writeText(`${TEST_DIR}/login.ambercast.plan.json`, JSON.stringify({
      ...freshPlan,
      steps: [{ id: 'missing-kind' }],
    }, null, 2));
    recordingStorage.reset();

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({ results: [{ file: testPath, status: 'generated' }] });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('regenerates a same-digest plan that is valid but not canonically serialized', async () => {
    const { deps, execute, recordingStorage } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    await createFreshPlan(recordingStorage.storage, testPath);
    const planPath = `${TEST_DIR}/login.ambercast.plan.json`;
    const canonical = await recordingStorage.storage.readText(planPath);
    await recordingStorage.storage.writeText(planPath, `${JSON.stringify(JSON.parse(canonical), null, 4)}\n`);
    recordingStorage.reset();

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({ results: [{ status: 'generated' }] });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('honors fresh status during dry-run unless force explicitly requests a preview', async () => {
    const { deps, execute, recordingStorage } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath);
    recordingStorage.reset();

    await expect(generate(deps, { ...DEFAULT_OPTIONS, dryRun: true })).resolves.toMatchObject({
      results: [{ status: 'skipped-fresh' }],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('selects the sole own target when configuration omits defaultTarget', async () => {
    const soleTargets = {
      replacement: { baseUrl: 'https://replacement.example.test', browser: 'chromium' as const, healReplayIsolation: 'stateful' as const },
    };
    const { deps, execute, recordingStorage } = createScenario({
      config: {
        testDir: TEST_DIR,
        testMatch: ['**/*.test.md'],
        testIgnore: [],
        targets: soleTargets,
        ai: { provider: 'codex', timeoutMs: 100, maxGenerateAttempts: 2 },
      },
    });
    await writePrompt(recordingStorage.storage);

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      results: [{ status: 'generated' }],
    });
    expect(execute).toHaveBeenCalledOnce();
    const context = execute.mock.calls[0]?.[0].context as {
      readonly targets: GenerateDeps['config']['targets'];
    };
    expect(Object.keys(context.targets)).toEqual(['replacement']);
    expect(context.targets.replacement).toEqual({
      baseUrl: soleTargets.replacement.baseUrl,
      browser: soleTargets.replacement.browser,
    });
    expect(context.targets.replacement).not.toHaveProperty('healReplayIsolation');
    const plan = PlanDocument.parse(JSON.parse(
      await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.plan.json`),
    ));
    expect(Object.keys(plan.targets)).toEqual(['replacement']);
    expect(plan.targets).toEqual({
      replacement: {
        baseUrl: soleTargets.replacement.baseUrl,
        browser: soleTargets.replacement.browser,
      },
    });
  });

  it.each([
    [
      'an invalid explicit target',
      {
        testDir: TEST_DIR,
        testMatch: ['**/*.test.md'],
        testIgnore: [],
        targets: RESOLVED_TARGETS,
        defaultTarget: 'web',
        ai: { provider: 'codex' as const, timeoutMs: 100, maxGenerateAttempts: 2 },
      },
      { target: 'missing' },
      'The requested target is not configured.',
      { target: 'missing' },
    ],
    [
      'an ambiguous implicit target',
      {
        testDir: TEST_DIR,
        testMatch: ['**/*.test.md'],
        testIgnore: [],
        targets: {
          web: RESOLVED_TARGETS.web,
          admin: { baseUrl: 'https://admin.example.test', browser: 'chromium' as const, healReplayIsolation: 'stateful' as const },
        },
        ai: { provider: 'codex' as const, timeoutMs: 100, maxGenerateAttempts: 2 },
      },
      {},
      'A target could not be selected from the configured targets.',
      { target: '(default)', targetNames: ['admin', 'web'] },
    ],
  ] as const)('records two ordered shared failures for %s without downstream work', async (
    _description,
    config,
    optionOverride,
    message,
    details,
  ) => {
    const { deps, events, execute, recordingStorage } = createScenario({
      config,
      discoverTestFiles: async () => ['first.test.md', 'second.test.md'],
    });
    const firstPath = await writePrompt(recordingStorage.storage, 'first.test.md', 'first');
    const secondPath = await writePrompt(recordingStorage.storage, 'second.test.md', 'second');
    recordingStorage.reset();

    const outcome = await generate(deps, { ...DEFAULT_OPTIONS, ...optionOverride });

    expect(outcome.results.map(({ file, status }) => ({ file, status }))).toEqual([
      { file: firstPath, status: 'failed' },
      { file: secondPath, status: 'failed' },
    ]);
    for (const result of outcome.results) {
      expect(result.error).toBeInstanceOf(TargetUnresolvedError);
      expect(result.error).toMatchObject({
        kind: 'target-unresolved',
        exitCode: 2,
        message,
        details,
      });
      expect(result.error?.details).toEqual(details);
    }
    expect(recordingStorage.reads).toEqual([firstPath, secondPath]);
    expect(recordingStorage.exists).toEqual([]);
    expect(recordingStorage.writes).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
    expect(events.emitted()).toEqual([]);
  });

  it('rejects an inherited explicit target without falling back to a valid own default', async () => {
    const inheritedName = 'inherited-preview';
    const inheritedDefinition = {
      baseUrl: 'https://inherited.example.test',
      browser: 'chromium' as const,
      healReplayIsolation: 'stateful' as const,
    };
    const prototype = Object.fromEntries([[inheritedName, inheritedDefinition]]);
    const targets = Object.assign(
      Object.create(prototype) as Record<string, Readonly<typeof inheritedDefinition>>,
      { web: RESOLVED_TARGETS.web },
    ) as GenerateDeps['config']['targets'];
    expect(Object.hasOwn(targets, 'web')).toBe(true);
    expect(Object.hasOwn(targets, inheritedName)).toBe(false);
    expect(targets[inheritedName]).toBe(inheritedDefinition);

    const { deps, events, execute, recordingStorage } = createScenario({
      config: {
        testDir: TEST_DIR,
        testMatch: ['**/*.test.md'],
        testIgnore: [],
        targets,
        defaultTarget: 'web',
        ai: { provider: 'codex', timeoutMs: 100, maxGenerateAttempts: 2 },
      },
      discoverTestFiles: async () => ['first.test.md', 'second.test.md'],
    });
    const firstPath = await writePrompt(recordingStorage.storage, 'first.test.md', 'first');
    const secondPath = await writePrompt(recordingStorage.storage, 'second.test.md', 'second');
    recordingStorage.reset();

    const outcome = await generate(deps, { ...DEFAULT_OPTIONS, target: inheritedName });

    expect(outcome.results.map(({ file, status }) => ({ file, status }))).toEqual([
      { file: firstPath, status: 'failed' },
      { file: secondPath, status: 'failed' },
    ]);
    for (const result of outcome.results) {
      expect(result.error).toBeInstanceOf(TargetUnresolvedError);
      expect(result.error).toMatchObject({
        kind: 'target-unresolved',
        exitCode: 2,
        message: 'The requested target is not configured.',
      });
      expect(result.error?.details).toEqual({ target: inheritedName });
    }
    expect(recordingStorage.reads).toEqual([firstPath, secondPath]);
    expect(recordingStorage.exists).toEqual([]);
    expect(recordingStorage.writes).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
    expect(events.emitted()).toEqual([]);
  });

  it.each([
    ['the configured default', undefined, 'web'],
    ['an explicit override', 'admin', 'admin'],
  ] as const)('uses %s before sending the selected target to AI', async (
    _selection,
    target,
    expectedName,
  ) => {
    const targets = {
      web: RESOLVED_TARGETS.web,
      admin: { baseUrl: 'https://admin.example.test', browser: 'chromium' as const, healReplayIsolation: 'stateful' as const },
    };
    const { deps, execute, recordingStorage } = createScenario({
      config: {
        testDir: TEST_DIR,
        testMatch: ['**/*.test.md'],
        testIgnore: [],
        targets,
        defaultTarget: 'web',
        ai: { provider: 'codex', timeoutMs: 100, maxGenerateAttempts: 2 },
      },
    });
    await writePrompt(recordingStorage.storage);

    await generate(deps, { ...DEFAULT_OPTIONS, ...(target === undefined ? {} : { target }) });

    expect(execute).toHaveBeenCalledOnce();
    const expectedDefinition = {
      baseUrl: targets[expectedName].baseUrl,
      browser: targets[expectedName].browser,
    };
    const otherName = expectedName === 'web' ? 'admin' : 'web';
    const context = execute.mock.calls[0]?.[0].context as {
      readonly targets: GenerateDeps['config']['targets'];
    };
    expect(Object.keys(context.targets)).toEqual([expectedName]);
    expect(context.targets[expectedName]).toEqual(expectedDefinition);
    expect(context.targets[expectedName]).not.toHaveProperty('healReplayIsolation');
    expect(Object.hasOwn(context.targets, otherName)).toBe(false);
    const plan = PlanDocument.parse(JSON.parse(
      await recordingStorage.storage.readText(`${TEST_DIR}/login.ambercast.plan.json`),
    ));
    expect(Object.keys(plan.targets)).toEqual([expectedName]);
    expect(plan.targets[expectedName]).toEqual(expectedDefinition);
    expect(Object.hasOwn(plan.targets, otherName)).toBe(false);
  });

  it('regenerates for a changed selected target but ignores an unrelated target change', async () => {
    const selectedChanged = {
      web: { baseUrl: 'https://changed.example.test', browser: 'chromium' as const, healReplayIsolation: 'stateful' as const },
      admin: { baseUrl: 'https://admin.example.test', browser: 'chromium' as const, healReplayIsolation: 'stateful' as const },
    };
    const unrelatedChanged = {
      web: RESOLVED_TARGETS.web,
      admin: { baseUrl: 'https://changed-admin.example.test', browser: 'chromium' as const, healReplayIsolation: 'stateful' as const },
    };

    const changedScenario = createScenario({
      config: {
        testDir: TEST_DIR,
        testMatch: ['**/*.test.md'],
        testIgnore: [],
        targets: selectedChanged,
        defaultTarget: 'web',
        ai: { provider: 'codex', timeoutMs: 100, maxGenerateAttempts: 2 },
      },
    });
    const changedPath = await writePrompt(changedScenario.recordingStorage.storage);
    await createFreshPlan(changedScenario.recordingStorage.storage, changedPath, [], TARGETS);
    changedScenario.recordingStorage.reset();

    await expect(generate(changedScenario.deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      results: [{ status: 'generated' }],
    });
    expect(changedScenario.execute).toHaveBeenCalledOnce();

    const unrelatedScenario = createScenario({
      config: {
        testDir: TEST_DIR,
        testMatch: ['**/*.test.md'],
        testIgnore: [],
        targets: unrelatedChanged,
        defaultTarget: 'web',
        ai: { provider: 'codex', timeoutMs: 100, maxGenerateAttempts: 2 },
      },
    });
    const unrelatedPath = await writePrompt(unrelatedScenario.recordingStorage.storage);
    await createFreshPlan(unrelatedScenario.recordingStorage.storage, unrelatedPath, [], TARGETS);
    unrelatedScenario.recordingStorage.reset();

    await expect(generate(unrelatedScenario.deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      results: [{ status: 'skipped-fresh' }],
    });
    expect(unrelatedScenario.execute).not.toHaveBeenCalled();
  });

  it.each([
    [
      'provider rejection',
      new AiExecutorUnavailableError('provider unavailable'),
      'ai-executor-unavailable',
      2,
      [{ attempt: 1, code: 'AI_EXECUTOR_UNAVAILABLE' }],
    ],
    [
      'invalid response rejection',
      new AiResponseInvalidError('invalid response'),
      'ai-response-invalid',
      3,
      [{ attempt: 1, code: 'AI_RESPONSE_INVALID' }, { attempt: 2, code: 'AI_RESPONSE_INVALID' }],
    ],
  ] as const)('keeps %s as a failed file and continues to later files', async (_description, error, kind, expectedAiCalls, expectedAttempts) => {
    const execute = vi.fn(async (request: AiExecuteRequest<unknown>) => {
      if (request.context !== null && typeof request.context === 'object' && 'testMd' in request.context && String(request.context.testMd).includes('first')) {
        throw error;
      }
      return { data: RESPONSE, raw: JSON.stringify(RESPONSE) };
    });
    const { deps, events, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({
        execute,
      }),
      discoverTestFiles: async () => ['first.test.md', 'second.test.md'],
    });
    await writePrompt(recordingStorage.storage, 'first.test.md', 'first');
    await writePrompt(recordingStorage.storage, 'second.test.md', 'second');

    const request = vi.fn(async () => ({ kind: 'allowed' as const, renames: [] }));
    const commitAllowlist = vi.fn(async () => undefined);
    const outcome = await generate(withSecretConfig({
      ...deps,
      consent: {
        request,
        commitAllowlist,
      },
    }, '*'), DEFAULT_OPTIONS);
    expect(outcome).toMatchObject({
      results: [
        { file: `${TEST_DIR}/first.test.md`, status: 'failed', error: { kind } },
        { file: `${TEST_DIR}/second.test.md`, status: 'generated' },
      ],
    });
    expect(outcome.results[0]?.error).toMatchObject({ details: { attempts: expectedAttempts } });
    expect(execute).toHaveBeenCalledTimes(expectedAiCalls);
    expect(aiCallEvents(events.emitted())).toHaveLength(expectedAiCalls);
    expect(aiEvents(events.emitted())).toHaveLength(expectedAiCalls * 2);
    expect(request).not.toHaveBeenCalled();
    expect(commitAllowlist).not.toHaveBeenCalled();
  });

  it('wraps a per-call timeout as an unavailable executor failure and continues the batch', async () => {
    const caller = new AbortController();
    const timeoutController = new AbortController();
    const secondTimeoutController = new AbortController();
    const timeoutReason = new Error('controlled local timeout');
    const timeoutSpy = interceptTimeouts(new Map([
      [101, timeoutController],
      [102, secondTimeoutController],
    ]));
    const composedTimeoutSignals = captureComposedTimeoutSignals([
      timeoutController.signal,
      secondTimeoutController.signal,
    ]);
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const { deps, recordingStorage } = createScenario({
      signal: caller.signal,
      config: { testDir: TEST_DIR, testMatch: ['**/*.test.md'], testIgnore: [], targets: RESOLVED_TARGETS, defaultTarget: 'web', ai: sequentialTimeoutConfig([101, 102]) },
      resolveAiExecutor: async () => createFakeAiExecutor({
        execute: (request) => {
          if (request.context !== null && typeof request.context === 'object' && 'testMd' in request.context && request.context.testMd === 'first') {
            observedSignal = request.signal;
            markStarted?.();
            return new Promise<never>(() => undefined);
          }
          return { data: RESPONSE, raw: JSON.stringify(RESPONSE) };
        },
      }),
      discoverTestFiles: async () => ['first.test.md', 'second.test.md'],
    });
    await writePrompt(recordingStorage.storage, 'first.test.md', 'first');
    await writePrompt(recordingStorage.storage, 'second.test.md', 'second');

    try {
      const running = generate(deps, DEFAULT_OPTIONS);
      await started;
      expect(timeoutSpy).toHaveBeenNthCalledWith(1, 101);
      expect(composedTimeoutSignals[0]).toBe(timeoutController.signal);
      expect(observedSignal).not.toBe(caller.signal);
      expect(observedSignal).not.toBe(timeoutController.signal);
      timeoutController.abort(timeoutReason);

      await expect(running).resolves.toMatchObject({
        results: [
          {
            status: 'failed',
            error: {
              kind: 'ai-executor-unavailable',
              message: 'The AI provider did not respond within the configured timeout.',
            },
          },
          { status: 'generated' },
        ],
      });
      expect(timeoutSpy).toHaveBeenNthCalledWith(2, 102);
      expect(composedTimeoutSignals[1]).toBe(secondTimeoutController.signal);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('preserves a caller TimeoutError rather than attributing it to the local timeout', async () => {
    const caller = new AbortController();
    const timeoutController = new AbortController();
    const callerReason = new DOMException('caller cancelled', 'TimeoutError');
    const localReason = new DOMException('fabricated local timeout', 'TimeoutError');
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const execute = vi.fn((request: { readonly signal?: AbortSignal }) => {
      observedSignal = request.signal;
      markStarted?.();
      return new Promise<never>(() => undefined);
    });
    const { deps, recordingStorage } = createScenario({
      signal: caller.signal,
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: async () => ['first.test.md', 'second.test.md'],
    });
    await writePrompt(recordingStorage.storage, 'first.test.md', 'first');
    await writePrompt(recordingStorage.storage, 'second.test.md', 'second');

    try {
      const running = generate(deps, DEFAULT_OPTIONS);
      await started;
      caller.abort(callerReason);
      timeoutController.abort(localReason);

      await expect(running).resolves.toMatchObject({ interrupted: true, results: [{ file: `${TEST_DIR}/first.test.md`, status: 'skipped' }, { file: `${TEST_DIR}/second.test.md`, status: 'skipped' }], noTestsFound: false });
      expect(execute).toHaveBeenCalledOnce();
      expect(observedSignal).not.toBe(caller.signal);
      expect(observedSignal).not.toBe(timeoutController.signal);
      expect(observedSignal?.reason).toBe(callerReason);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('keeps an unrelated TimeoutError-named provider rejection generic', async () => {
    const timeoutController = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    const providerError = new DOMException('provider returned a timeout-shaped failure', 'TimeoutError');
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({
        execute: async (request) => {
          if (request.context !== null && typeof request.context === 'object' && 'testMd' in request.context && request.context.testMd === 'first') {
            throw providerError;
          }
          return { data: RESPONSE, raw: JSON.stringify(RESPONSE) };
        },
      }),
      discoverTestFiles: async () => ['first.test.md', 'second.test.md'],
    });
    await writePrompt(recordingStorage.storage, 'first.test.md', 'first');
    await writePrompt(recordingStorage.storage, 'second.test.md', 'second');

    try {
      await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
        results: [
          { status: 'failed', error: { kind: 'ai-executor-unavailable', message: 'The AI provider call failed.' } },
          { status: 'generated' },
        ],
      });
      expect(timeoutController.signal.aborted).toBe(false);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('classifies a non-abort adapter failure as unavailable without claiming that the call timed out', async () => {
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({
        execute: async (request) => {
          if (request.context !== null && typeof request.context === 'object' && 'testMd' in request.context && request.context.testMd === 'first') {
            throw new Error('temporary schema write failed');
          }
          return { data: RESPONSE, raw: JSON.stringify(RESPONSE) };
        },
      }),
      discoverTestFiles: async () => ['first.test.md', 'second.test.md'],
    });
    await writePrompt(recordingStorage.storage, 'first.test.md', 'first');
    await writePrompt(recordingStorage.storage, 'second.test.md', 'second');

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      results: [
        {
          status: 'failed',
          error: {
            kind: 'ai-executor-unavailable',
            message: 'The AI provider call failed.',
          },
        },
        { status: 'generated' },
      ],
    });
  });

  it('returns collected results without starting a file when the caller has already aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('caller stopped generation');
    const { deps, execute, recordingStorage } = createScenario({ signal: controller.signal, discoverTestFiles: async () => ['first.test.md', 'second.test.md'] });
    await writePrompt(recordingStorage.storage, 'first.test.md');
    await writePrompt(recordingStorage.storage, 'second.test.md');
    recordingStorage.reset();
    controller.abort(reason);

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toEqual({ results: [{ file: `${TEST_DIR}/first.test.md`, status: 'skipped' }, { file: `${TEST_DIR}/second.test.md`, status: 'skipped' }], noTestsFound: false, interrupted: true });
    expect(execute).not.toHaveBeenCalled();
    expect(recordingStorage.reads).toEqual([]);
  });

  it('returns collected partial results when the caller aborts a pending AI call and never starts the second file', async () => {
    const controller = new AbortController();
    const reason = new Error('stop after first AI call starts');
    let signalStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let resolveFirst: ((value: { data: GeneratedPlanResponse; raw: string }) => void) | undefined;
    const firstResponse = new Promise<{ data: GeneratedPlanResponse; raw: string }>((resolve) => {
      resolveFirst = resolve;
    });
    const execute = vi.fn(() => {
      signalStarted?.();
      return firstResponse;
    });
    const recordingStorage = createRecordingStorage();
    const { deps } = createScenario({
      signal: controller.signal,
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      storage: recordingStorage.storage,
      discoverTestFiles: async () => ['first.test.md', 'second.test.md'],
    });
    await writePrompt(recordingStorage.storage, 'first.test.md');
    await writePrompt(recordingStorage.storage, 'second.test.md');
    recordingStorage.reset();

    const running = generate(deps, DEFAULT_OPTIONS);
    await started;
    controller.abort(reason);

    await expect(running).resolves.toMatchObject({ interrupted: true, results: [{ file: `${TEST_DIR}/first.test.md`, status: 'skipped' }, { file: `${TEST_DIR}/second.test.md`, status: 'skipped' }], noTestsFound: false });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(recordingStorage.reads).toContain(`${TEST_DIR}/first.test.md`);
    expect(recordingStorage.reads).not.toContain(`${TEST_DIR}/second.test.md`);
    resolveFirst?.({ data: RESPONSE, raw: JSON.stringify(RESPONSE) });
  });

  it('converts prompt-read, plan-write, and grounding-write failures to classified per-file failures', async () => {
    const testPath = `${TEST_DIR}/login.test.md`;
    for (const failure of ['read', 'plan', 'grounding'] as const) {
      const storage = createRecordingStorage({
        ...(failure === 'read' ? { read: testPath } : {}),
        ...(failure === 'plan' ? { write: `${TEST_DIR}/login.ambercast.plan.json` } : {}),
        ...(failure === 'grounding' ? { write: `${TEST_DIR}/login.ambercast.grounding.json` } : {}),
      });
      if (failure !== 'read') {
        await writePrompt(storage.storage);
      }
      const { deps, execute } = createScenario({ storage: storage.storage });

      const outcome = await generate(deps, { ...DEFAULT_OPTIONS, files: [testPath] });
      expect(outcome).toMatchObject({
        results: [{ status: 'failed', error: { kind: 'fs-io-error' } }],
      });
      expect(execute).toHaveBeenCalledTimes(failure === 'read' ? 0 : 1);
      expect(outcome.results[0]?.error?.details?.['attempts']).toBeUndefined();
    }
  });

  it.each(['missing', 'malformed', 'digest-mismatched'] as const)(
    'repairs a %s grounding cache for a fresh plan without regenerating it',
    async (groundingState) => {
      const { deps, execute, recordingStorage } = createScenario();
      const testPath = await writePrompt(recordingStorage.storage);
      await createFreshPlan(recordingStorage.storage, testPath);
      const groundingPath = `${TEST_DIR}/login.ambercast.grounding.json`;
      if (groundingState === 'malformed') {
        await recordingStorage.storage.writeText(groundingPath, '{ malformed');
      }
      if (groundingState === 'digest-mismatched') {
        const staleGrounding: GroundingDocument = { schemaVersion: 1, planDigest: 'f'.repeat(64), entries: {} };
        await recordingStorage.storage.writeText(
          groundingPath,
          toCanonicalArtifactText(staleGrounding as unknown as JsonValueT),
        );
      }
      recordingStorage.reset();

      await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({ results: [{ status: 'skipped-fresh' }] });
      expect(execute).not.toHaveBeenCalled();
      expect(recordingStorage.writes).toEqual([expect.objectContaining({ path: groundingPath })]);
    },
  );

  it.each(['missing', 'malformed', 'digest-mismatched'] as const)(
    'does not repair a %s grounding cache while dry-running a fresh plan',
    async (groundingState) => {
      const { deps, execute, recordingStorage } = createScenario();
      const testPath = await writePrompt(recordingStorage.storage);
      await createFreshPlan(recordingStorage.storage, testPath);
      const groundingPath = `${TEST_DIR}/login.ambercast.grounding.json`;
      if (groundingState === 'malformed') {
        await recordingStorage.storage.writeText(groundingPath, '{ malformed');
      }
      if (groundingState === 'digest-mismatched') {
        const staleGrounding: GroundingDocument = { schemaVersion: 1, planDigest: 'f'.repeat(64), entries: {} };
        await recordingStorage.storage.writeText(
          groundingPath,
          toCanonicalArtifactText(staleGrounding as unknown as JsonValueT),
        );
      }
      recordingStorage.reset();

      await expect(generate(deps, { ...DEFAULT_OPTIONS, dryRun: true })).resolves.toMatchObject({
        results: [{ status: 'skipped-fresh' }],
      });
      expect(execute).not.toHaveBeenCalled();
      expect(recordingStorage.writes).toEqual([]);
    },
  );

  it('leaves the written plan after grounding write failure, then repairs grounding without another AI call', async () => {
    const recordingStorage = createRecordingStorage();
    const planPath = `${TEST_DIR}/login.ambercast.plan.json`;
    const groundingPath = `${TEST_DIR}/login.ambercast.grounding.json`;
    let failGroundingWrite = true;
    const storage: StorageAdapter = {
      ...recordingStorage.storage,
      async writeText(path, content) {
        if (path === groundingPath && failGroundingWrite) {
          failGroundingWrite = false;
          throw new Error('grounding write failed once');
        }
        await recordingStorage.storage.writeText(path, content);
      },
    };
    const { deps, execute } = createScenario({ storage });
    await writePrompt(storage);
    recordingStorage.reset();

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      results: [{ status: 'failed', error: { kind: 'fs-io-error' } }],
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(PlanDocument.safeParse(JSON.parse(await storage.readText(planPath))).success).toBe(true);
    await expect(storage.exists(groundingPath)).resolves.toBe(false);

    recordingStorage.reset();
    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({ results: [{ status: 'skipped-fresh' }] });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(recordingStorage.writes).toEqual([expect.objectContaining({ path: groundingPath })]);
  });

  it('preserves provider ambiguities for generated and previewed plans regardless of strict policy', async () => {
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: { steps: [], ambiguities: ['unclear target'] }, raw: '{...}' }) }),
    });
    await writePrompt(recordingStorage.storage);

    await expect(generate(deps, { ...DEFAULT_OPTIONS, strict: true })).resolves.toMatchObject({
      results: [{ status: 'generated', ambiguities: ['unclear target'] }],
    });
    await expect(generate(deps, { ...DEFAULT_OPTIONS, dryRun: true, strict: false, force: true })).resolves.toMatchObject({
      results: [{ status: 'would-generate', ambiguities: ['unclear target'] }],
    });
  });

  it.each([
    ['generated', { ...DEFAULT_OPTIONS }],
    ['dry-run', { ...DEFAULT_OPTIONS, dryRun: true }],
  ] as const)('rejects a literal secret in %s response ambiguities before exposing or writing it', async (_mode, options) => {
    const secret = 'sk-live-secret-in-ambiguity';
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({
        execute: async () => ({ data: { steps: [], ambiguities: [secret] }, raw: '{...}' }),
      }),
    });
    await writePrompt(recordingStorage.storage);
    recordingStorage.reset();

    await expect(generate(deps, options)).resolves.toMatchObject({
      results: [{ status: 'failed', error: { kind: 'secret-literal-rejected' } }],
    });
    expect(recordingStorage.writes).toEqual([]);
  });

  it('rejects literal secrets before either artifact write and continues with the next file', async () => {
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({
        execute: async (request) => request.context !== null && typeof request.context === 'object' && 'testMd' in request.context && request.context.testMd === 'unsafe'
          ? { data: { steps: [], ambiguities: [], generatorMeta: { token: 'sk-live-secret-value' } }, raw: '{...}' }
          : { data: RESPONSE, raw: '{...}' },
      }),
      discoverTestFiles: async () => ['unsafe.test.md', 'safe.test.md'],
    });
    await writePrompt(recordingStorage.storage, 'unsafe.test.md', 'unsafe');
    await writePrompt(recordingStorage.storage, 'safe.test.md', 'safe');
    recordingStorage.reset();

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      results: [
        { file: `${TEST_DIR}/unsafe.test.md`, status: 'failed', error: { kind: 'secret-literal-rejected' } },
        { file: `${TEST_DIR}/safe.test.md`, status: 'generated' },
      ],
    });
    expect(recordingStorage.writes.map(({ path }) => path)).not.toContain(`${TEST_DIR}/unsafe.ambercast.plan.json`);
    expect(recordingStorage.writes.map(({ path }) => path)).not.toContain(`${TEST_DIR}/unsafe.ambercast.grounding.json`);
  });

  it('classifies duplicate assembled plan step IDs as a final PlanDocument validation failure', async () => {
    const duplicateResponse: GeneratedPlanResponse = {
      steps: [
        { id: 'open-home', kind: 'action', action: 'navigate', url: 'https://example.test/one' },
        { id: 'open-home', kind: 'action', action: 'navigate', url: 'https://example.test/two' },
      ],
      ambiguities: [],
    };
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({
        execute: async () => ({ data: duplicateResponse, raw: JSON.stringify(duplicateResponse) }),
      }),
    });
    await writePrompt(recordingStorage.storage);
    recordingStorage.reset();

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      results: [{ status: 'failed', error: { kind: 'ai-response-invalid' } }],
    });
    expect(recordingStorage.writes).toEqual([]);
  });

  it('round-trips a generated secret-bearing plan with byte-identical artifact text', async () => {
    const response: GeneratedPlanResponse = {
      steps: [{
        id: 'fill-password',
        kind: 'action',
        action: 'fill-secret',
        target: PASSWORD_TARGET,
        secret: { nameHint: 'login_password' },
      }],
      ambiguities: [],
    };
    const { deps, recordingStorage } = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({
        execute: async () => ({ data: response, raw: JSON.stringify(response) }),
      }),
    });
    const testPath = await writePrompt(recordingStorage.storage);

    const request = vi.fn(async () => ({ kind: 'allowed' as const, renames: [] }));
    const commitAllowlist = vi.fn(async () => undefined);
    const outcome = await generate(withSecretConfig({
      ...deps,
      consent: {
        request,
        commitAllowlist,
      },
    }, '*'), DEFAULT_OPTIONS);
    const text = await recordingStorage.storage.readText(deps.layout.planPathFor(testPath));
    const parsed = PlanDocument.parse(JSON.parse(text));

    expect(outcome.results[0]).toMatchObject({ status: 'generated' });
    expect(toCanonicalArtifactText(parsed as unknown as JsonValueT)).toBe(text);
    expect(request).not.toHaveBeenCalled();
    expect(commitAllowlist).not.toHaveBeenCalled();
  });

  const producerBundleMeta = () => {
    const inputs = planProducerBundle.liveProducerBundleInputs();
    return {
      fingerprint: planProducerBundle.computePlanProducerBundleFingerprint(inputs),
      components: planProducerBundle.planProducerBundleComponentDiagnostics(inputs),
    };
  };

  it.each([
    ['creates the producer bundle when the provider omits generatorMeta', undefined, () => ({ planProducerBundle: producerBundleMeta() })],
    ['preserves unrelated provider generatorMeta keys', { provider: 'fixture' }, () => ({ provider: 'fixture', planProducerBundle: producerBundleMeta() })],
    ['overrides a provider-supplied producer bundle', { planProducerBundle: { fingerprint: 'provider-value', providerOwnedField: 'must-not-survive' } }, () => ({ planProducerBundle: producerBundleMeta() })],
  ] as const)('%s', async (_name, generatorMeta, expectedGeneratorMeta) => {
    const response = { ...RESPONSE, ...(generatorMeta === undefined ? {} : { generatorMeta }) } as GeneratedPlanResponse;
    const { deps, recordingStorage } = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw: JSON.stringify(response) }) }) });
    const testPath = await writePrompt(recordingStorage.storage);

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({ results: [{ status: 'generated' }] });
    const artifact = JSON.parse(await recordingStorage.storage.readText(deps.layout.planPathFor(testPath))) as { generatorMeta: unknown };
    expect(artifact.generatorMeta).toEqual(expectedGeneratorMeta());
  });

  it('derives the written digest and producer-bundle diagnostics from one live snapshot', async () => {
    const firstSnapshot = {
      generatorPromptTemplate: 'first template',
      generatorTaskInstruction: 'first task',
      generatedPlanResponseSchema: { type: 'object', title: 'first' },
      generatedPlanResponseLocalContract: { type: 'object', title: 'first local contract' },
      instructionCoveragePolicyRevision: 101,
      generatorSecretPolicyRevision: 102,
    };
    const secondSnapshot = {
      generatorPromptTemplate: 'second template',
      generatorTaskInstruction: 'second task',
      generatedPlanResponseSchema: { type: 'object', title: 'second' },
      generatedPlanResponseLocalContract: { type: 'object', title: 'second local contract' },
      instructionCoveragePolicyRevision: 201,
      generatorSecretPolicyRevision: 202,
    };
    const liveInputs = vi.spyOn(planProducerBundle, 'liveProducerBundleInputs')
      .mockReturnValueOnce(firstSnapshot)
      .mockReturnValueOnce(secondSnapshot);
    const { deps, recordingStorage } = createScenario();
    const testPath = await writePrompt(recordingStorage.storage);

    try {
      await generate(deps, DEFAULT_OPTIONS);
      const artifact = JSON.parse(await recordingStorage.storage.readText(deps.layout.planPathFor(testPath))) as {
        source: { inputsDigest: string };
        generatorMeta: { planProducerBundle: { fingerprint: string; components: unknown } };
      };
      const firstFingerprint = planProducerBundle.computePlanProducerBundleFingerprint(firstSnapshot);

      expect(liveInputs).toHaveBeenCalledTimes(1);
      expect(artifact.generatorMeta.planProducerBundle).toEqual({
        fingerprint: firstFingerprint,
        components: planProducerBundle.planProducerBundleComponentDiagnostics(firstSnapshot),
      });
      expect(artifact.source.inputsDigest).toBe(computeInputsDigest({
        normalizedTestMd: normalizeTestMd(PROMPT),
        schemaVersion: 3,
        generatorPromptTemplateFingerprint: promptTemplateFingerprint(),
        planProducerBundleFingerprint: firstFingerprint,
        targetDefinitions: TARGETS,
      }));
    } finally {
      liveInputs.mockRestore();
    }
  });

  it('changes the written inputs digest when the producer bundle fingerprint changes', async () => {
    const firstFingerprint = 'a'.repeat(64);
    const secondFingerprint = 'b'.repeat(64);
    const inputs = {
      generatorPromptTemplate: 'template',
      generatorTaskInstruction: 'task',
      generatedPlanResponseSchema: { type: 'object' },
      generatedPlanResponseLocalContract: { type: 'object' },
      instructionCoveragePolicyRevision: 1,
      generatorSecretPolicyRevision: 1,
    };
    const components = {
      generatorPromptTemplate: '1'.repeat(64),
      generatorTaskInstruction: '2'.repeat(64),
      generatedPlanResponseSchema: '3'.repeat(64),
      generatedPlanResponseLocalContract: '4'.repeat(64),
      instructionCoveragePolicyRevision: 1,
      generatorSecretPolicyRevision: 1,
    };
    const inputsSpy = vi.spyOn(planProducerBundle, 'liveProducerBundleInputs').mockReturnValue(inputs);
    const diagnosticsSpy = vi.spyOn(planProducerBundle, 'planProducerBundleComponentDiagnostics').mockReturnValue(components);
    const fingerprintSpy = vi.spyOn(planProducerBundle, 'computePlanProducerBundleFingerprint')
      .mockReturnValueOnce(firstFingerprint)
      .mockReturnValueOnce(secondFingerprint);
    const { deps, recordingStorage } = createScenario();
    const firstPath = await writePrompt(recordingStorage.storage, 'first.test.md');
    const secondPath = await writePrompt(recordingStorage.storage, 'second.test.md');

    await generate(deps, { ...DEFAULT_OPTIONS, files: [firstPath] });
    await generate(deps, { ...DEFAULT_OPTIONS, files: [secondPath] });

    const firstArtifact = JSON.parse(await recordingStorage.storage.readText(deps.layout.planPathFor(firstPath))) as { source: { inputsDigest: string } };
    const secondArtifact = JSON.parse(await recordingStorage.storage.readText(deps.layout.planPathFor(secondPath))) as { source: { inputsDigest: string } };
    expect(firstArtifact.source.inputsDigest).not.toBe(secondArtifact.source.inputsDigest);
    fingerprintSpy.mockRestore();
    diagnosticsSpy.mockRestore();
    inputsSpy.mockRestore();
  });

  describe('K6 provider lifecycle and per-occurrence metrics', () => {
    it('emits one command-numbered call/result pair per fulfilled retry attempt with exact attempt metadata and rounded durations', async () => {
      const rejected = {
        ...coveredResponse,
        steps: [{ ...coveredResponse.steps[0], verificationIntent: [] }],
      } as unknown as GeneratedPlanResponse;
      const responses = [rejected, coveredResponse] as const;
      let responseIndex = 0;
      const execute = vi.fn(async () => {
        const response = responses[responseIndex];
        responseIndex += 1;
        if (response === undefined) throw new Error('Unexpected provider dispatch.');
        return { data: response, raw: JSON.stringify(response) };
      });
      const { deps, events, recordingStorage } = createScenario({
        clock: sequenceClock([10, 100.1, 112.6, 200, 219.5, 310.4]),
        resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      });
      const file = await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, DEFAULT_OPTIONS);

      expect(outcome.results).toMatchObject([{
        file,
        status: 'generated',
        durationMs: 300,
        aiCalls: 2,
      }]);
      expect(events.emitted()).toEqual([
        { type: 'ai-call', callId: 'ai-1', file, attempt: 1, attemptLimit: 2 },
        { type: 'ai-result', callId: 'ai-1', durationMs: 13, outcome: 'ok' },
        { type: 'ai-call', callId: 'ai-2', file, attempt: 2, attemptLimit: 2 },
        { type: 'ai-result', callId: 'ai-2', durationMs: 20, outcome: 'ok' },
      ]);
    });

    it('marks a rejected executor call as error and retains its exact dispatch count on the failed row', async () => {
      const rejection = new AiExecutorUnavailableError('provider unavailable');
      const execute = vi.fn(async () => { throw rejection; });
      const { deps, events, recordingStorage } = createScenario({
        clock: sequenceClock([20, 50, 58.4, 80.5]),
        resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      });
      const file = await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, DEFAULT_OPTIONS);

      expect(outcome.results).toMatchObject([{
        file,
        status: 'failed',
        durationMs: 61,
        aiCalls: 1,
      }]);
      expect(events.emitted()).toEqual([
        { type: 'ai-call', callId: 'ai-1', file, attempt: 1, attemptLimit: 2 },
        { type: 'ai-result', callId: 'ai-1', durationMs: 8, outcome: 'error' },
      ]);
    });

    it('emits exactly one error result when the executor method throws synchronously', async () => {
      const rejection = new Error('synchronous provider failure');
      const invoked = vi.fn();
      const executor = {
        ...createFakeAiExecutor(),
        execute<T>(_request: AiExecuteRequest<T>): Promise<AiExecuteResult<T>> {
          invoked();
          throw rejection;
        },
      };
      const { deps, events, recordingStorage } = createScenario({
        clock: sequenceClock([1, 10, 16.6, 20]),
        resolveAiExecutor: async () => executor,
      });
      const file = await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, { ...DEFAULT_OPTIONS, maxAttempts: 1 });

      expect(invoked).toHaveBeenCalledOnce();
      expect(outcome.results[0]).toMatchObject({ status: 'failed', durationMs: 19, aiCalls: 1 });
      expect(events.emitted()).toEqual([
        { type: 'ai-call', callId: 'ai-1', file, attempt: 1, attemptLimit: 1 },
        { type: 'ai-result', callId: 'ai-1', durationMs: 7, outcome: 'error' },
      ]);
    });

    it('adds exact durationMs and aiCalls to a would-generate row', async () => {
      const { deps, events, recordingStorage } = createScenario({
        clock: sequenceClock([10, 20, 21.4, 25.1]),
      });
      const file = await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, { ...DEFAULT_OPTIONS, dryRun: true });

      expect(outcome.results).toEqual([{
        file,
        status: 'would-generate',
        planFile: `${TEST_DIR}/login.ambercast.plan.json`,
        ambiguities: [],
        durationMs: 15,
        aiCalls: 1,
        secrets: [], // SPEC-C1 C1-8
      }]);
      expect(events.emitted()).toEqual([
        { type: 'ai-call', callId: 'ai-1', file, attempt: 1, attemptLimit: 2 },
        { type: 'ai-result', callId: 'ai-1', durationMs: 1, outcome: 'ok' },
      ]);
    });

    it('adds a duration and zero AI calls to a fresh-plan skip without lifecycle events', async () => {
      const { deps, events, execute, recordingStorage } = createScenario({
        clock: sequenceClock([0.2, 10.6]),
      });
      const file = await writePrompt(recordingStorage.storage);
      await seedFreshArtifacts(recordingStorage.storage, file);
      recordingStorage.reset();

      const outcome = await generate(deps, DEFAULT_OPTIONS);

      expect(outcome.results).toEqual([{
        file,
        status: 'skipped-fresh',
        planFile: `${TEST_DIR}/login.ambercast.plan.json`,
        durationMs: 10,
        aiCalls: 0,
      }]);
      expect(execute).not.toHaveBeenCalled();
      expect(events.emitted()).toEqual([]);
    });

    it('adds clamped durationMs and zero AI calls to a failure before provider dispatch', async () => {
      const { deps, events, execute } = createScenario({
        clock: sequenceClock([100, 40]),
      });
      const readFailure = new Error('read failed before dispatch');
      const storage: StorageAdapter = {
        ...deps.storage,
        readText: async () => { throw readFailure; },
      };

      const outcome = await generate({ ...deps, storage }, DEFAULT_OPTIONS);

      expect(outcome.results).toMatchObject([{
        file: `${TEST_DIR}/login.test.md`,
        status: 'failed',
        durationMs: 0,
        aiCalls: 0,
      }]);
      expect(execute).not.toHaveBeenCalled();
      expect(events.emitted()).toEqual([]);
    });

    it('clamps a negative executor delta to zero without changing the fulfilled outcome', async () => {
      const { deps, events, recordingStorage } = createScenario({
        clock: sequenceClock([100, 80, 70, 60]),
      });
      const file = await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, DEFAULT_OPTIONS);

      expect(outcome.results[0]).toMatchObject({ status: 'generated', durationMs: 0, aiCalls: 1 });
      expect(events.emitted()).toEqual([
        { type: 'ai-call', callId: 'ai-1', file, attempt: 1, attemptLimit: 2 },
        { type: 'ai-result', callId: 'ai-1', durationMs: 0, outcome: 'ok' },
      ]);
    });

    it('emits no lifecycle event when local deadline construction throws before executor invocation', async () => {
      const localFailure = new Error('request deadline construction failed');
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { throw localFailure; });
      const { deps, events, execute, recordingStorage } = createScenario();
      await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      try {
        await expect(generate(deps, DEFAULT_OPTIONS)).rejects.toBe(localFailure);
        expect(execute).not.toHaveBeenCalled();
        expect(events.emitted()).toEqual([]);
      } finally {
        timeout.mockRestore();
      }
    });
  });

  describe('bounded validation retries', () => {
    const responseWithMissingSuccessIntent = () => ({
      ...coveredResponse,
      steps: [{ ...coveredResponse.steps[0], id: 'sign-in', verificationIntent: [] }],
    } as unknown as GeneratedPlanResponse);

    function requireRawPreviousAttempts(context: unknown): unknown[] {
      if (context === null || typeof context !== 'object') {
        throw new Error('Expected a raw object context.');
      }
      const previousAttempts = Reflect.get(context, 'previousAttempts');
      if (!Array.isArray(previousAttempts)) {
        throw new Error('Expected raw context.previousAttempts to be an array.');
      }
      return previousAttempts;
    }

    function requireRawObject(value: unknown, name: string): object {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Expected ${name} to be a raw object.`);
      }
      return value;
    }

    it('retries coverage rejection, supplies only projected feedback, and preserves context key order', async () => {
      const rejected = responseWithMissingSuccessIntent();
      const responses = [rejected, coveredResponse] as const;
      let index = 0;
      const execute = vi.fn(async (_request: AiExecuteRequest<unknown>) => {
        const response = responses[index++];
        if (response === undefined) throw new Error('Unexpected retry dispatch.');
        return { data: response, raw: JSON.stringify(response) };
      });
      const { deps, events, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      });
      await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, DEFAULT_OPTIONS);
      const firstContext = execute.mock.calls[0]?.[0].context as Record<string, unknown>;
      const secondContext = execute.mock.calls[1]?.[0].context as Record<string, unknown>;

      expect(outcome.results).toMatchObject([{ status: 'generated' }]);
      expect(outcome.results[0]).not.toHaveProperty('error');
      expect(execute).toHaveBeenCalledTimes(2);
      expect(aiCallEvents(events.emitted())).toHaveLength(2);
      expect(aiEvents(events.emitted())).toHaveLength(4);
      expect(Object.keys(firstContext)).toEqual(['testMd', 'targets', 'allowedSecretNames']); // SPEC-C1 C1-10
      expect(Object.keys(secondContext)).toEqual(['testMd', 'targets', 'allowedSecretNames', 'previousAttempts']); // SPEC-C1 C1-10
      expect(secondContext).toEqual({
        testMd: normalizeTestMd(PROMPT),
        targets: TARGETS,
        allowedSecretNames: [], // SPEC-C1 C1-10
        previousAttempts: [{
          attempt: 1,
          code: 'AI_RESPONSE_INVALID',
          issues: [{
            code: 'intent-id-missing',
            path: ['verificationIntent', REDACTED_ISSUE_PATH_SEGMENT],
            stepId: 'sign-in',
          }],
        }],
      });
    });

    it('exhausts three retryable coverage failures with complete ordered retry feedback and attempts history', async () => {
      const rejected = responseWithMissingSuccessIntent();
      const execute = vi.fn(async (_request: AiExecuteRequest<unknown>) => ({ data: rejected, raw: JSON.stringify(rejected) }));
      const { deps, events, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      });
      await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, { ...DEFAULT_OPTIONS, maxAttempts: 3 });
      const thirdContext = execute.mock.calls[2]?.[0].context;

      expect(outcome.results[0]).toMatchObject({ status: 'failed' });
      expect(outcome.results[0]?.error).toBeInstanceOf(AiResponseInvalidError);
      expect(outcome.results[0]?.error).toMatchObject({ details: {
        attempts: [
          { attempt: 1, code: 'AI_RESPONSE_INVALID' },
          { attempt: 2, code: 'AI_RESPONSE_INVALID' },
          { attempt: 3, code: 'AI_RESPONSE_INVALID' },
        ],
      } });
      expect(execute).toHaveBeenCalledTimes(3);
      expect(aiCallEvents(events.emitted())).toHaveLength(3);
      expect(aiEvents(events.emitted())).toHaveLength(6);
      expect(thirdContext).toEqual({
        testMd: normalizeTestMd(PROMPT),
        targets: TARGETS,
        allowedSecretNames: [], // SPEC-C1 C1-10
        previousAttempts: [
          {
            attempt: 1,
            code: 'AI_RESPONSE_INVALID',
            issues: [{
              code: 'intent-id-missing',
              path: ['verificationIntent', REDACTED_ISSUE_PATH_SEGMENT],
              stepId: 'sign-in',
            }],
          },
          {
            attempt: 2,
            code: 'AI_RESPONSE_INVALID',
            issues: [{
              code: 'intent-id-missing',
              path: ['verificationIntent', REDACTED_ISSUE_PATH_SEGMENT],
              stepId: 'sign-in',
            }],
          },
        ],
      });
    });

    it('retries an invalid response with an explicit empty issues list', async () => {
      let dispatch = 0;
      const execute = vi.fn(async (_request: AiExecuteRequest<unknown>) => {
        if (dispatch++ === 0) throw new AiResponseInvalidError('No issue details were supplied.', { issues: [] });
        return { data: RESPONSE, raw: JSON.stringify(RESPONSE) };
      });
      const { deps, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      });
      await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, DEFAULT_OPTIONS);

      expect(outcome.results).toMatchObject([{ status: 'generated' }]);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute.mock.calls[1]?.[0].context).toMatchObject({
        previousAttempts: [{ attempt: 1, code: 'AI_RESPONSE_INVALID', issues: [] }],
      });
    });

    it('normalizes a non-array invalid-response issues value to empty retry feedback', async () => {
      let dispatch = 0;
      const execute = vi.fn(async (_request: AiExecuteRequest<unknown>) => {
        if (dispatch++ === 0) {
          throw new AiResponseInvalidError('Malformed issue details.', { issues: 'not-an-array' });
        }
        return { data: RESPONSE, raw: JSON.stringify(RESPONSE) };
      });
      const { deps, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      });
      await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, DEFAULT_OPTIONS);

      expect(outcome.results).toMatchObject([{ status: 'generated' }]);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute.mock.calls[1]?.[0].context).toMatchObject({
        previousAttempts: [{ attempt: 1, code: 'AI_RESPONSE_INVALID', issues: [] }],
      });
    });

    it('normalizes no-details invalid responses before attaching terminal history', async () => {
      const execute = vi.fn(async () => { throw new AiResponseInvalidError('No details.'); });
      const { deps, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      });
      await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, { ...DEFAULT_OPTIONS, maxAttempts: 1 });

      expect(outcome.results[0]?.error).toBeInstanceOf(AiResponseInvalidError);
      expect(outcome.results[0]?.error?.details).toEqual({
        issues: [],
        attempts: [{ attempt: 1, code: 'AI_RESPONSE_INVALID' }],
      });
      expect(execute).toHaveBeenCalledOnce();
    });

    it('preserves an adapter invalid-response cause while attaching terminal history', async () => {
      const cause = new SyntaxError('provider JSON could not be parsed');
      const execute = vi.fn(async (_request: AiExecuteRequest<unknown>) => {
        throw new AiResponseInvalidError('Invalid provider response.', { issues: [] }, { cause });
      });
      const { deps, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      });
      await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, { ...DEFAULT_OPTIONS, maxAttempts: 1 });

      expect(outcome.results[0]?.error).toBeInstanceOf(AiResponseInvalidError);
      expect(outcome.results[0]?.error?.cause).toBe(cause);
      expect(outcome.results[0]?.error?.details).toEqual({
        issues: [],
        attempts: [{ attempt: 1, code: 'AI_RESPONSE_INVALID' }],
      });
      expect(execute).toHaveBeenCalledOnce();
    });

    it('retries and exhausts a literal secret found by the plan safety policy without dropping diagnostics', async () => {
      const literal = 'sk-live-secret-in-provider-ambiguity';
      const response: GeneratedPlanResponse = { steps: [], ambiguities: [literal] };
      const execute = vi.fn(async (_request: AiExecuteRequest<unknown>) => ({ data: response, raw: JSON.stringify(response) }));
      const { deps, events, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      });
      await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, { ...DEFAULT_OPTIONS, maxAttempts: 3 });

      expect(outcome.results[0]?.error).toBeInstanceOf(SecretLiteralRejectedError);
      expect(outcome.results[0]?.error?.details).toMatchObject({
        detector: 'credential-prefix-sk',
        path: '[0]',
      });
      expect(outcome.results[0]?.error?.details?.attempts).toEqual([
        { attempt: 1, code: 'SECRET_LITERAL_REJECTED' },
        { attempt: 2, code: 'SECRET_LITERAL_REJECTED' },
        { attempt: 3, code: 'SECRET_LITERAL_REJECTED' },
      ]);
      expect(execute).toHaveBeenCalledTimes(3);
      expect(aiCallEvents(events.emitted())).toHaveLength(3);
      expect(aiEvents(events.emitted())).toHaveLength(6);
      const secondPreviousAttempts = requireRawPreviousAttempts(execute.mock.calls[1]?.[0].context);
      const thirdPreviousAttempts = requireRawPreviousAttempts(execute.mock.calls[2]?.[0].context);
      expect(secondPreviousAttempts).toEqual([{ attempt: 1, code: 'SECRET_LITERAL_REJECTED' }]);
      expect(thirdPreviousAttempts).toEqual([
        { attempt: 1, code: 'SECRET_LITERAL_REJECTED' },
        { attempt: 2, code: 'SECRET_LITERAL_REJECTED' },
      ]);
      expect(Object.keys(requireRawObject(secondPreviousAttempts[0], 'the second dispatch first previous attempt')))
        .toEqual(['attempt', 'code']);
      expect(Object.keys(requireRawObject(thirdPreviousAttempts[0], 'the third dispatch first previous attempt')))
        .toEqual(['attempt', 'code']);
      expect(Object.keys(requireRawObject(thirdPreviousAttempts[1], 'the third dispatch second previous attempt')))
        .toEqual(['attempt', 'code']);
    });

    it('retries a literal-secret rejection with projected feedback and succeeds on the next response', async () => {
      const literal = 'sk-live-secret-in-provider-ambiguity';
      const rejected: GeneratedPlanResponse = { steps: [], ambiguities: [literal] };
      const responses = [rejected, RESPONSE] as const;
      let index = 0;
      const execute = vi.fn(async (_request: AiExecuteRequest<unknown>) => {
        const response = responses[index++];
        if (response === undefined) throw new Error('Unexpected retry dispatch.');
        return { data: response, raw: JSON.stringify(response) };
      });
      const { deps, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      });
      await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, DEFAULT_OPTIONS);
      const secondContext = execute.mock.calls[1]?.[0].context as Record<string, unknown>;

      expect(outcome.results).toMatchObject([{ status: 'generated' }]);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(Object.keys(secondContext)).toEqual(['testMd', 'targets', 'allowedSecretNames', 'previousAttempts']); // SPEC-C1 C1-10
      expect(secondContext).toEqual({
        testMd: normalizeTestMd(PROMPT),
        targets: TARGETS,
        allowedSecretNames: [], // SPEC-C1 C1-10
        previousAttempts: [{ attempt: 1, code: 'SECRET_LITERAL_REJECTED' }],
      });
    });

    it('uses one whole-prompt retry budget across alternating retryable codes', async () => {
      const literal = 'sk-live-secret-in-provider-ambiguity';
      const literalRejected: GeneratedPlanResponse = { steps: [], ambiguities: [literal] };
      let dispatch = 0;
      const execute = vi.fn(async (_request: AiExecuteRequest<unknown>) => {
        if (dispatch++ === 0) throw new AiResponseInvalidError('Invalid provider response.', { issues: [] });
        if (dispatch === 2) return { data: literalRejected, raw: JSON.stringify(literalRejected) };
        if (dispatch === 3) throw new AiResponseInvalidError('Invalid provider response.', { issues: [] });
        throw new Error('Unexpected fourth retry dispatch.');
      });
      const { deps, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      });
      await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, { ...DEFAULT_OPTIONS, maxAttempts: 3 });

      expect(outcome.results[0]?.error).toBeInstanceOf(AiResponseInvalidError);
      expect(outcome.results[0]?.error?.details?.attempts).toEqual([
        { attempt: 1, code: 'AI_RESPONSE_INVALID' },
        { attempt: 2, code: 'SECRET_LITERAL_REJECTED' },
        { attempt: 3, code: 'AI_RESPONSE_INVALID' },
      ]);
      expect(execute).toHaveBeenCalledTimes(3);
      const thirdContext = execute.mock.calls[2]?.[0].context as Record<string, unknown>;
      expect(thirdContext.previousAttempts).toEqual([
        { attempt: 1, code: 'AI_RESPONSE_INVALID', issues: [] },
        { attempt: 2, code: 'SECRET_LITERAL_REJECTED' },
      ]);
    });

    it('preserves an unmapped classified terminal error without attaching retry history', async () => {
      class UnmappedGenerationError extends AmbercastError {
        readonly kind = 'assertion-failed' as const;
      }

      const terminal = new UnmappedGenerationError('A future classified error reached generation.', { origin: 'test' });
      let dispatch = 0;
      const execute = vi.fn(async (_request: AiExecuteRequest<unknown>) => {
        if (dispatch++ === 0) {
          throw new AiResponseInvalidError('Retryable invalid response.', { issues: [] });
        }
        throw terminal;
      });
      const { deps, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      });
      await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, { ...DEFAULT_OPTIONS, maxAttempts: 3 });

      expect(outcome.results[0]).toMatchObject({ status: 'failed' });
      expect(outcome.results[0]?.error).toBe(terminal);
      expect(Object.hasOwn(terminal.details ?? {}, 'attempts')).toBe(false);
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it.each([
      [
        'an unavailable executor',
        'AI_EXECUTOR_UNAVAILABLE',
        (cause: Error) => new AiExecutorUnavailableError('Provider unavailable.', undefined, { cause }),
      ],
      [
        'a literal-secret rejection',
        'SECRET_LITERAL_REJECTED',
        (cause: Error) => new SecretLiteralRejectedError(
          'Literal secret rejected.',
          { detector: 'credential-prefix-sk', path: 'generatorMeta.token' },
          { cause },
        ),
      ],
    ] as const)(
      'preserves the original cause while attaching terminal history for %s',
      async (_description, code, createError) => {
        const cause = new Error(`Original cause for ${code}`);
        const terminal = createError(cause);
        const execute = vi.fn(async () => { throw terminal; });
        const { deps, recordingStorage } = createScenario({
          resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
        });
        await writePrompt(recordingStorage.storage);
        recordingStorage.reset();

        const outcome = await generate(deps, { ...DEFAULT_OPTIONS, maxAttempts: 1 });

        expect(outcome.results[0]?.error).toBeInstanceOf(terminal.constructor);
        expect(outcome.results[0]?.error?.cause).toBe(cause);
        expect(outcome.results[0]?.error?.details).toMatchObject({
          attempts: [{ attempt: 1, code }],
        });
        expect(execute).toHaveBeenCalledOnce();
      },
    );

    it('does not retry a terminal-url-matches-only rejection but retries a mixed issue list', async () => {
      const terminalOnly = {
        ...coveredResponse,
        steps: [{
          ...coveredResponse.steps[0],
          verificationIntent: [{
            criterionId: 'dashboard-reached',
            assertion: { type: 'assert', check: 'url-matches', pattern: '/dashboard$' },
          }],
        }],
      } as unknown as GeneratedPlanResponse;
      const terminalExecute = vi.fn(async () => ({ data: terminalOnly, raw: JSON.stringify(terminalOnly) }));
      const terminalScenario = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute: terminalExecute }),
      });
      await writePrompt(terminalScenario.recordingStorage.storage, 'terminal.test.md');
      terminalScenario.recordingStorage.reset();

      const terminalOutcome = await generate(terminalScenario.deps, { ...DEFAULT_OPTIONS, files: [`${TEST_DIR}/terminal.test.md`] });

      expect(terminalOutcome.results).toMatchObject([{ status: 'failed', error: { kind: 'ai-response-invalid' } }]);
      expect(terminalExecute).toHaveBeenCalledOnce();

      const mixed = {
        ...terminalOnly,
        steps: [{
          ...terminalOnly.steps[0],
          verificationIntent: [
            { criterionId: 'dashboard-reached', assertion: { type: 'assert', check: 'url-matches', pattern: '/dashboard$' } },
            { criterionId: 'unknown', assertion: { type: 'assert', check: 'text-visible', text: 'Dashboard' } },
          ],
        }],
      } as unknown as GeneratedPlanResponse;
      let mixedDispatch = 0;
      const mixedExecute = vi.fn(async (_request: AiExecuteRequest<unknown>) => {
        const response = mixedDispatch++ === 0 ? mixed : RESPONSE;
        return { data: response, raw: JSON.stringify(response) };
      });
      const mixedScenario = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute: mixedExecute }),
      });
      await writePrompt(mixedScenario.recordingStorage.storage, 'mixed.test.md');
      mixedScenario.recordingStorage.reset();

      await expect(generate(mixedScenario.deps, { ...DEFAULT_OPTIONS, files: [`${TEST_DIR}/mixed.test.md`] }))
        .resolves.toMatchObject({ results: [{ status: 'generated' }] });
      expect(mixedExecute).toHaveBeenCalledTimes(2);
      expect(mixedExecute.mock.calls[1]?.[0].context).toMatchObject({
        previousAttempts: [{
          attempt: 1,
          code: 'AI_RESPONSE_INVALID',
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'terminal-url-matches-forbidden' }),
            expect.objectContaining({ code: 'intent-id-unknown' }),
          ]),
        }],
      });
    });

    it('stops an unavailable executor after an earlier retryable failure and retains both attempts', async () => {
      const rejected = responseWithMissingSuccessIntent();
      let dispatch = 0;
      const execute = vi.fn(async () => {
        if (dispatch++ === 0) return { data: rejected, raw: JSON.stringify(rejected) };
        throw new AiExecutorUnavailableError('Provider became unavailable.');
      });
      const { deps, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      });
      await writePrompt(recordingStorage.storage);
      recordingStorage.reset();

      const outcome = await generate(deps, DEFAULT_OPTIONS);

      expect(outcome.results[0]?.error).toBeInstanceOf(AiExecutorUnavailableError);
      expect(outcome.results[0]?.error?.details).toEqual({
        attempts: [{ attempt: 1, code: 'AI_RESPONSE_INVALID' }, { attempt: 2, code: 'AI_EXECUTOR_UNAVAILABLE' }],
      });
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it('propagates coverage step identity but leaves schema-mismatch issues unscoped', async () => {
      const coverageExecute = vi.fn(async () => ({
        data: responseWithMissingSuccessIntent(),
        raw: 'coverage failure',
      }));
      const coverageScenario = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute: coverageExecute }),
      });
      await writePrompt(coverageScenario.recordingStorage.storage, 'coverage.test.md');
      coverageScenario.recordingStorage.reset();

      const coverageOutcome = await generate(coverageScenario.deps, {
        ...DEFAULT_OPTIONS,
        files: [`${TEST_DIR}/coverage.test.md`],
        maxAttempts: 1,
      });
      const coverageIssues = (coverageOutcome.results[0]?.error as AiResponseInvalidError | undefined)?.details?.issues as readonly Record<string, unknown>[];
      expect(coverageIssues).not.toHaveLength(0);
      expect(coverageIssues.every((issue) => issue.stepId === 'sign-in')).toBe(true);

      const schemaExecute = vi.fn(async () => ({ data: { steps: 'not-an-array', ambiguities: [] }, raw: 'schema failure' }));
      const schemaScenario = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute: schemaExecute }),
      });
      await writePrompt(schemaScenario.recordingStorage.storage, 'schema.test.md');
      schemaScenario.recordingStorage.reset();

      const schemaOutcome = await generate(schemaScenario.deps, {
        ...DEFAULT_OPTIONS,
        files: [`${TEST_DIR}/schema.test.md`],
        maxAttempts: 1,
      });
      const issues = (schemaOutcome.results[0]?.error as AiResponseInvalidError | undefined)?.details?.issues as readonly Record<string, unknown>[];
      expect(issues).not.toHaveLength(0);
      expect(issues.every((issue) => !Object.hasOwn(issue, 'stepId'))).toBe(true);
    });

    it('omits schema-mismatch issue step IDs from raw retry feedback instead of assigning undefined', async () => {
      let dispatch = 0;
      const execute = vi.fn(async (_request: AiExecuteRequest<unknown>) => {
        if (dispatch++ === 0) {
          return { data: { steps: 'not-an-array', ambiguities: [] }, raw: 'schema failure' };
        }
        return { data: RESPONSE, raw: JSON.stringify(RESPONSE) };
      });
      const { deps, recordingStorage } = createScenario({
        resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      });
      await writePrompt(recordingStorage.storage, 'schema-retry.test.md');
      recordingStorage.reset();

      const outcome = await generate(deps, {
        ...DEFAULT_OPTIONS,
        files: [`${TEST_DIR}/schema-retry.test.md`],
      });
      const rawPreviousAttempts = requireRawPreviousAttempts(execute.mock.calls[1]?.[0].context);
      const rawFirstAttempt = requireRawObject(rawPreviousAttempts[0], 'the first previous attempt');
      const rawIssues = Reflect.get(rawFirstAttempt, 'issues');

      expect(outcome.results).toMatchObject([{ status: 'generated' }]);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(Array.isArray(rawIssues)).toBe(true);
      if (!Array.isArray(rawIssues)) {
        throw new Error('Expected schema-mismatch retry feedback issues to be an array.');
      }
      expect(rawIssues).not.toHaveLength(0);
      expect(rawIssues.every((issue) => issue !== null
        && typeof issue === 'object'
        && !Object.hasOwn(issue, 'stepId'))).toBe(true);
    });

    it.each(['provider rejection', 'post-response interruption'] as const)(
      'turns the current and pending files into skipped rows at the %s checkpoint without further dispatch',
      async (checkpoint) => {
        const controller = new AbortController();
        let started!: () => void;
        const firstStarted = new Promise<void>((resolve) => { started = resolve; });
        let release!: (value: { data: GeneratedPlanResponse; raw: string }) => void;
        const execute = vi.fn((request: AiExecuteRequest<unknown>) => new Promise<{ data: GeneratedPlanResponse; raw: string }>((resolve, reject) => {
          started();
          if (checkpoint === 'provider rejection') {
            request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true });
            return;
          }
          release = resolve;
        }));
        const { deps, recordingStorage } = createScenario({
          signal: controller.signal,
          resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
          discoverTestFiles: async () => ['first.test.md', 'second.test.md'],
        });
        const first = await writePrompt(recordingStorage.storage, 'first.test.md');
        const second = await writePrompt(recordingStorage.storage, 'second.test.md');
        recordingStorage.reset();

        const running = generate(deps, { ...DEFAULT_OPTIONS, maxAttempts: 1 });
        await firstStarted;
        controller.abort(new Error(`abort at ${checkpoint}`));
        if (checkpoint === 'post-response interruption') release({ data: RESPONSE, raw: JSON.stringify(RESPONSE) });

        await expect(running).resolves.toMatchObject({
          interrupted: true,
          results: [{ file: first, status: 'skipped' }, { file: second, status: 'skipped' }],
        });
        expect(execute).toHaveBeenCalledOnce();
      },
    );
  });
});

describe('generate secret naming and consent boundaries', () => {
  const namedResponse = (secret: unknown): GeneratedPlanResponse => ({
    steps: [{ id: 'fill-password', kind: 'action', action: 'fill-secret', target: PASSWORD_TARGET, ...(secret === undefined ? {} : { secret }) }],
    ambiguities: [],
  } as unknown as GeneratedPlanResponse);

  const committedAiSecretStep = (name: string): Step => ({
    id: 'fill-password',
    kind: 'ai',
    instruction: 'Reach the dashboard.',
    secrets: [{ ref: `{{secrets.${name}}}` }],
    instructionCoverage: [{
      id: 'dashboard-reached',
      kind: 'success',
      sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 56 },
    }],
  } as unknown as Step);

  const generatedAiSecretResponse = (nameHint: string): GeneratedPlanResponse => ({
    steps: [{
      ...coveredResponse.steps[0],
      id: 'fill-password',
      secrets: [{ nameHint }],
    }],
    ambiguities: [],
  } as unknown as GeneratedPlanResponse);

  const targetChangeWarnings = (outcome: Awaited<ReturnType<typeof generate>>) =>
    (outcome.results[0]?.warnings ?? []).filter((warning) => warning.kind === 'secret-target-changed');

  it('retries provider naming violation secret-allowed-name-not-projected as AI_RESPONSE_INVALID', async () => {
    let dispatch = 0;
    const execute = vi.fn(async () => {
      const response = dispatch++ === 0 ? namedResponse({ allowedName: 'LOGIN_PASSWORD' }) : RESPONSE;
      return { data: response, raw: JSON.stringify(response) };
    });
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    const deps = withSecretConfig(scenario.deps, '*');
    await writePrompt(scenario.recordingStorage.storage);
    scenario.recordingStorage.reset();

    const outcome = await generate(deps, DEFAULT_OPTIONS);

    expect(outcome.results).toMatchObject([{ status: 'generated' }]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect((execute.mock.calls as unknown as Array<[{ readonly context: unknown }]>)[1]?.[0].context).toMatchObject({
      allowedSecretNames: [],
      previousAttempts: [{
        attempt: 1,
        code: 'AI_RESPONSE_INVALID',
        issues: [expect.objectContaining({ code: 'secret-allowed-name-not-projected' })],
      }],
    });
  });

  // SPEC-C1 C1-4: generate passes projected: []; explicit allowedName is thus rejected first,
  // so an end-to-end response cannot reach the target-name conflict; mock the boundary to verify retry wiring.
  it('retries provider naming violation secret-conflicting-target-names as AI_RESPONSE_INVALID', async () => {
    const conflictingResponse = {
      steps: [
        { id: 'first-name', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Account' } },
        { id: 'other-target', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Password' } },
        {
          id: 'conflicting-later',
          kind: 'action',
          action: 'fill-secret',
          target: { ...PASSWORD_TARGET, name: 'Account' },
          secret: { allowedName: 'password' },
        },
      ],
      ambiguities: [],
    } as unknown as GeneratedPlanResponse;
    let dispatch = 0;
    const execute = vi.fn(async () => {
      const response = dispatch++ === 0 ? conflictingResponse : RESPONSE;
      return { data: response, raw: JSON.stringify(response) };
    });
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);
    scenario.recordingStorage.reset();
    secretNamingMocks.deriveSecretNames.mockImplementationOnce(() => {
      throw new AiResponseInvalidError('Generated secret names conflict for one target.', {
        issues: [{
          code: 'secret-conflicting-target-names',
          path: 'steps[2].secret',
          stepId: 'conflicting-later',
        }],
      });
    });

    const outcome = await generate(withSecretConfig(scenario.deps, '*'), DEFAULT_OPTIONS);

    expect(outcome.results).toMatchObject([{ status: 'generated' }]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(secretNamingMocks.deriveSecretNames).toHaveBeenCalledTimes(2);
    expect((execute.mock.calls as unknown as Array<[{ readonly context: unknown }]>)[1]?.[0].context).toMatchObject({
      allowedSecretNames: [],
      previousAttempts: [{
        attempt: 1,
        code: 'AI_RESPONSE_INVALID',
        issues: [{
          code: 'secret-conflicting-target-names',
          path: 'steps[2].secret',
          stepId: 'conflicting-later',
        }],
      }],
    });
  });

  it('includes an empty allowedSecretNames projection in both attempt context shapes', async () => {
    let dispatch = 0;
    const rejected = { ...coveredResponse, steps: [{ ...coveredResponse.steps[0], verificationIntent: [] }] } as unknown as GeneratedPlanResponse;
    const execute = vi.fn(async () => {
      const response = dispatch++ === 0 ? rejected : RESPONSE;
      return { data: response, raw: JSON.stringify(response) };
    });
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);
    await generate(withSecretConfig(scenario.deps, '*'), DEFAULT_OPTIONS);
    expect((execute.mock.calls as unknown as Array<[{ readonly context: unknown }]>).map(([request]) => request.context)).toEqual([
      expect.objectContaining({ allowedSecretNames: [] }),
      expect.objectContaining({ allowedSecretNames: [] }),
    ]);
  });

  it.each([false, true])('defers unauthorized generated secrets to the consent gate in %s dry-run mode', async (dryRun) => {
    const execute = vi.fn(async () => ({ data: namedResponse({ nameHint: 'login_password' }), raw: 'named' }));
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    const file = await writePrompt(scenario.recordingStorage.storage);
    scenario.recordingStorage.reset();
    if (!dryRun) {
      await expect(generate(withSecretConfig(scenario.deps, []), { ...DEFAULT_OPTIONS, dryRun })).rejects.toBeInstanceOf(UnexpectedCrashError);
      return;
    }
    const outcome = await generate(withSecretConfig(scenario.deps, []), { ...DEFAULT_OPTIONS, dryRun });
    expect(outcome.results[0]).toMatchObject({ file, status: 'would-generate' });
    expect(execute).toHaveBeenCalledOnce();
    expect(scenario.recordingStorage.writes).toEqual([]);
  });

  it('treats environment-name collisions as terminal and omits them from retry feedback', async () => {
    const response = { steps: [
      { id: 'fill-one', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Token one' }, secret: { nameHint: 'token_one' } },
      { id: 'fill-two', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Token two' }, secret: { nameHint: 'token_two' } },
    ], ambiguities: [] } as unknown as GeneratedPlanResponse;
    const execute = vi.fn(async () => ({ data: response, raw: 'collision' }));
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);
    envVarNameMocks.assertNoEnvVarCollision.mockClear();
    envVarNameMocks.assertNoEnvVarCollision.mockImplementationOnce(() => {
      throw new SecretEnvVarCollisionError('Forced collision for generate wiring.', {
        envVar: 'AMBERCAST_SECRET_TOKEN',
        refs: ['{{secrets.token_one}}', '{{secrets.token_two}}'],
      });
    });

    const outcome = await generate(withSecretConfig(scenario.deps, '*'), DEFAULT_OPTIONS);

    expect(outcome.results[0]?.error).toBeInstanceOf(SecretEnvVarCollisionError);
    expect(envVarNameMocks.assertNoEnvVarCollision).toHaveBeenCalledWith([
      '{{secrets.token_one}}',
      '{{secrets.token_two}}',
    ]);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('rejects an environment-name collision while preparing a fresh candidate before it reaches consent', async () => {
    const scenario = createScenario();
    const file = await writePrompt(scenario.recordingStorage.storage);
    await seedFreshArtifacts(scenario.recordingStorage.storage, file, [
      { id: 'fill-dot', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Dot' }, secretRef: '{{secrets.foo.bar}}' },
      { id: 'fill-underscore', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Underscore' }, secretRef: '{{secrets.foo_bar}}' },
    ] as unknown as Step[]);
    const request = vi.fn(async () => ({ kind: 'allowed' as const, renames: [] }));
    const commitAllowlist = vi.fn(async () => undefined);

    const outcome = await generate(
      withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []),
      DEFAULT_OPTIONS,
    );

    expect(outcome.results).toMatchObject([{ file, status: 'failed', error: { kind: 'secret-env-var-collision' } }]);
    expect(outcome.results[0]?.error).toBeInstanceOf(SecretEnvVarCollisionError);
    expect(scenario.execute).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(commitAllowlist).not.toHaveBeenCalled();
  });

  it('projects one AI secret row after duplicate provider choices normalize to one ref', async () => {
    const response = {
      steps: [{
        ...coveredResponse.steps[0],
        id: 'complete-sign-in',
        kind: 'ai',
        instruction: 'Complete the sign-in flow.',
        secrets: [{ nameHint: 'otp' }, { nameHint: 'otp' }],
      }],
      ambiguities: [],
    } as unknown as GeneratedPlanResponse;
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({
        execute: async () => ({ data: response, raw: JSON.stringify(response) }),
      }),
    });
    const file = await writePrompt(scenario.recordingStorage.storage);
    scenario.recordingStorage.reset();

    const outcome = await generate(withSecretConfig(scenario.deps, ['otp']), DEFAULT_OPTIONS);
    const result = outcome.results[0] as unknown as { readonly secrets: readonly unknown[] };

    expect(outcome.results[0]).toMatchObject({ file, status: 'generated' });
    expect(result.secrets).toEqual([{
      name: 'otp',
      stepId: 'complete-sign-in',
      envVar: 'AMBERCAST_SECRET_OTP',
      allowed: true,
      selectionSource: 'hint',
    }]);
  });

  it('projects secret rows in normalized plan-step order rather than provider-use order', async () => {
    const response = {
      steps: [
        {
          ...coveredResponse.steps[0],
          id: 'complete-sign-in',
          kind: 'ai',
          instruction: 'Complete the sign-in flow.',
          secrets: [{ nameHint: 'zeta' }, { nameHint: 'alpha' }],
        },
        {
          id: 'fill-password',
          kind: 'action',
          action: 'fill-secret',
          target: PASSWORD_TARGET,
          secret: { nameHint: 'password' },
        },
      ],
      ambiguities: [],
    } as unknown as GeneratedPlanResponse;
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({
        execute: async () => ({ data: response, raw: JSON.stringify(response) }),
      }),
    });
    await writePrompt(scenario.recordingStorage.storage);
    scenario.recordingStorage.reset();

    const outcome = await generate(withSecretConfig(scenario.deps, ['alpha', 'password', 'zeta']), DEFAULT_OPTIONS);
    const result = outcome.results[0] as unknown as { readonly secrets: readonly { readonly name: string; readonly stepId: string }[] };

    expect(result.secrets.map(({ name, stepId }) => ({ name, stepId }))).toEqual([
      { name: 'alpha', stepId: 'complete-sign-in' },
      { name: 'zeta', stepId: 'complete-sign-in' },
      { name: 'password', stepId: 'fill-password' },
    ]);
  });

  it('requests one batch consent and commits it before writing any generated artifact', async () => {
    const execute = vi.fn(async () => ({ data: namedResponse({ nameHint: 'login_password' }), raw: 'named' }));
    const request = vi.fn(async () => ({ kind: 'allowed' as const, renames: [] }));
    const commitAllowlist = vi.fn(async () => undefined);
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    const writeText = vi.fn<StorageAdapter['writeText']>(scenario.deps.storage.writeText);
    await writePrompt(scenario.recordingStorage.storage);
    scenario.recordingStorage.reset();

    await expect(generate(withSecretConfig({ ...scenario.deps, storage: { ...scenario.deps.storage, writeText }, consent: { request, commitAllowlist } }, []), DEFAULT_OPTIONS))
      .resolves.toMatchObject({ results: [{ status: 'generated' }] });

    expect(request).toHaveBeenCalledOnce();
    expect(commitAllowlist).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalled();
    expect(commitAllowlist.mock.invocationCallOrder[0]).toBeLessThan(writeText.mock.invocationCallOrder[0]!);
  });

  it('does not request or commit consent for a wildcard allowlist', async () => {
    const execute = vi.fn(async () => ({ data: namedResponse({ nameHint: 'login_password' }), raw: 'named' }));
    const request = vi.fn(async () => ({ kind: 'allowed' as const, renames: [] }));
    const commitAllowlist = vi.fn(async () => undefined);
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);

    await expect(generate(withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, '*'), DEFAULT_OPTIONS))
      .resolves.toMatchObject({ results: [{ status: 'generated' }] });

    expect(request).not.toHaveBeenCalled();
    expect(commitAllowlist).not.toHaveBeenCalled();
  });

  it('forbid mode neither requests nor commits and returns the prepared candidate result without normal settlement', async () => {
    const execute = vi.fn(async () => ({ data: namedResponse({ nameHint: 'login_password' }), raw: 'named' }));
    const request = vi.fn(async () => ({ kind: 'allowed' as const, renames: [] }));
    const commitAllowlist = vi.fn(async () => undefined);
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);
    scenario.recordingStorage.reset();

    const outcome = await generate(
      withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []),
      { ...DEFAULT_OPTIONS, consentMode: 'forbid' },
    );

    expect(request).not.toHaveBeenCalled();
    expect(commitAllowlist).not.toHaveBeenCalled();
    expect(outcome.results).toMatchObject([{ status: 'candidate', plan: expect.any(Object), secrets: [expect.objectContaining({ name: 'password' })] }]);
    expect(scenario.recordingStorage.writes).toEqual([]);
  });

  it('treats a rejected consent request as run-scoped and leaves prepared artifacts uncommitted', async () => {
    const requestFailure = new Error('terminal input failed');
    const execute = vi.fn(async () => ({ data: namedResponse({ nameHint: 'login_password' }), raw: 'named' }));
    const request = vi.fn(async () => { throw requestFailure; });
    const commitAllowlist = vi.fn(async () => undefined);
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);
    scenario.recordingStorage.reset();

    await expect(generate(withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []), DEFAULT_OPTIONS))
      .rejects.toBe(requestFailure);

    expect(request).toHaveBeenCalledOnce();
    expect(commitAllowlist).not.toHaveBeenCalled();
    expect(scenario.recordingStorage.writes).toEqual([]);
  });

  it('isolates not-interactive consent failures to needed candidates while settling unaffected prepared candidates', async () => {
    let dispatch = 0;
    const execute = vi.fn(async () => ({
      data: dispatch++ === 0 ? namedResponse({ nameHint: 'login_password' }) : RESPONSE,
      raw: 'prepared',
    }));
    const request = vi.fn(async () => ({ kind: 'not-interactive' as const }));
    const commitAllowlist = vi.fn(async () => undefined);
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: vi.fn(async () => ['needs-consent.test.md', 'unaffected.test.md']),
    });
    await writePrompt(scenario.recordingStorage.storage, 'needs-consent.test.md');
    await writePrompt(scenario.recordingStorage.storage, 'unaffected.test.md');
    scenario.recordingStorage.reset();

    const outcome = await generate(withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []), DEFAULT_OPTIONS);

    expect(request).toHaveBeenCalledOnce();
    expect(commitAllowlist).not.toHaveBeenCalled();
    expect(outcome.results).toMatchObject([{ status: 'failed' }, { status: 'generated' }]);
    expect(scenario.recordingStorage.writes.map((write) => write.path)).toEqual([
      `${TEST_DIR}/unaffected.ambercast.plan.json`,
      `${TEST_DIR}/unaffected.ambercast.grounding.json`,
    ]);
  });

  it('applies an accepted rename by original file-and-name key, revalidates it, and commits the renamed name', async () => {
    const execute = vi.fn(async () => ({ data: namedResponse({ nameHint: 'login_password' }), raw: 'named' }));
    const request = vi.fn(async (input: Parameters<NonNullable<GenerateDeps['consent']>['request']>[0]) => {
      expect(input.items[0]?.uses[0]).toEqual(expect.objectContaining({
        target: PASSWORD_TARGET,
        stepId: 'fill-password',
      }));
      const renames = [{ file: `${TEST_DIR}/login.test.md`, name: 'password', newName: 'account_password' }] as const;
      expect(input.validateRenames(renames)).toEqual({ ok: true });
      return { kind: 'allowed' as const, renames };
    });
    const commitAllowlist = vi.fn(async () => undefined);
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);

    const outcome = await generate(withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []), DEFAULT_OPTIONS);

    expect(request).toHaveBeenCalledOnce();
    expect(commitAllowlist).toHaveBeenCalledExactlyOnceWith('/workspace/ambercast.config.json', ['account_password'], undefined);
    expect(outcome.results).toMatchObject([{ secrets: [expect.objectContaining({ name: 'account_password', selectionSource: 'interactive-rename' })] }]);
  });

  it('rejects a simultaneous cross-occurrence rename set whose destinations collide as environment variables', async () => {
    const response = {
      steps: [
        { id: 'fill-alpha', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Alpha' }, secret: { nameHint: 'alpha' } },
        { id: 'fill-beta', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Beta' }, secret: { nameHint: 'beta' } },
      ],
      ambiguities: [],
    } as unknown as GeneratedPlanResponse;
    const request = vi.fn(async (input: Parameters<NonNullable<GenerateDeps['consent']>['request']>[0]) => {
      const renames = [
        { file: `${TEST_DIR}/login.test.md`, name: 'alpha', newName: 'foo.bar' },
        { file: `${TEST_DIR}/login.test.md`, name: 'beta', newName: 'foo_bar' },
      ] as const;
      expect(input.validateRenames(renames)).toEqual({
        ok: false,
        failedKeys: [
          { file: `${TEST_DIR}/login.test.md`, name: 'alpha' },
          { file: `${TEST_DIR}/login.test.md`, name: 'beta' },
        ],
      });
      return { kind: 'allowed' as const, renames: [] };
    });
    const commitAllowlist = vi.fn(async () => undefined);
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw: 'two names' }) }) });
    await writePrompt(scenario.recordingStorage.storage);

    await generate(withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []), DEFAULT_OPTIONS);

    expect(request).toHaveBeenCalledOnce();
    expect(commitAllowlist).toHaveBeenCalledExactlyOnceWith('/workspace/ambercast.config.json', ['alpha', 'beta'], undefined);
  });

  it('applies a shared rename consistently to duplicate selected occurrences', async () => {
    const execute = vi.fn(async () => ({ data: namedResponse({ nameHint: 'login_password' }), raw: 'named' }));
    const request = vi.fn(async (input: Parameters<NonNullable<GenerateDeps['consent']>['request']>[0]) => {
      expect(input.items).toHaveLength(2);
      const renames = [{ file: `${TEST_DIR}/login.test.md`, name: 'password', newName: 'account_password' }] as const;
      expect(input.validateRenames(renames)).toEqual({ ok: true });
      return { kind: 'allowed' as const, renames };
    });
    const commitAllowlist = vi.fn(async () => undefined);
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: vi.fn(async () => ['login.test.md', 'login.test.md']),
    });
    const file = await writePrompt(scenario.recordingStorage.storage);

    const outcome = await generate(withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []), DEFAULT_OPTIONS);

    expect(outcome.results).toMatchObject([{ file, status: 'generated' }, { file, status: 'skipped-fresh' }]);
    expect(commitAllowlist).toHaveBeenCalledExactlyOnceWith('/workspace/ambercast.config.json', ['account_password'], undefined);
    const plan = PlanDocument.parse(JSON.parse(await scenario.deps.storage.readText(scenario.deps.layout.planPathFor(file))));
    expect(plan.steps).toMatchObject([{ secretRef: '{{secrets.account_password}}' }]);
  });

  it('keeps an unedited use at a merged destination marked with its original selection source', async () => {
    const response = {
      steps: [
        { id: 'fill-alpha', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Alpha' }, secret: { nameHint: 'alpha' } },
        { id: 'fill-beta', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Beta' }, secret: { nameHint: 'beta' } },
      ],
      ambiguities: [],
    } as unknown as GeneratedPlanResponse;
    const request = vi.fn(async () => ({
      kind: 'allowed' as const,
      renames: [{ file: `${TEST_DIR}/login.test.md`, name: 'alpha', newName: 'beta' }],
    }));
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw: 'two names' }) }) });
    await writePrompt(scenario.recordingStorage.storage);

    const outcome = await generate(withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist: async () => undefined } }, []), DEFAULT_OPTIONS);

    expect(outcome.results[0]).toMatchObject({
      secrets: [
        { name: 'beta', stepId: 'fill-alpha', selectionSource: 'interactive-rename' },
        { name: 'beta', stepId: 'fill-beta', selectionSource: 'target-slug' },
      ],
    });
  });

  it('re-prompts only failed rename keys through the existing request without issuing a second request', async () => {
    const execute = vi.fn(async () => ({ data: namedResponse({ nameHint: 'login_password' }), raw: 'named' }));
    const request = vi.fn(async (input: Parameters<NonNullable<GenerateDeps['consent']>['request']>[0]) => {
      const first = [{ file: `${TEST_DIR}/login.test.md`, name: 'password', newName: '' as never }] as const;
      expect(input.validateRenames(first)).toEqual({ ok: false, failedKeys: [{ file: `${TEST_DIR}/login.test.md`, name: 'password' }] });
      const second = [{ file: `${TEST_DIR}/login.test.md`, name: 'password', newName: 'account_password' }] as const;
      expect(input.validateRenames(second)).toEqual({ ok: true });
      return { kind: 'allowed' as const, renames: second };
    });
    const commitAllowlist = vi.fn(async () => undefined);
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);

    await generate(withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []), DEFAULT_OPTIONS);

    expect(request).toHaveBeenCalledOnce();
    expect(commitAllowlist).toHaveBeenCalledExactlyOnceWith('/workspace/ambercast.config.json', ['account_password'], undefined);
  });

  it('fails closed without artifact writes when unmet consent has no injected capability', async () => {
    const execute = vi.fn(async () => ({ data: namedResponse({ nameHint: 'login_password' }), raw: 'named' }));
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);
    scenario.recordingStorage.reset();

    await expect(generate(withSecretConfig(scenario.deps, []), DEFAULT_OPTIONS))
      .rejects.toBeInstanceOf(UnexpectedCrashError);
    expect(scenario.recordingStorage.writes).toEqual([]);
  });

  it('turns a throwing validateRenames callback into a run-scoped UnexpectedCrashError before artifact settlement', async () => {
    const execute = vi.fn(async () => ({ data: namedResponse(undefined), raw: 'named' }));
    const request = vi.fn(async (input: Parameters<NonNullable<GenerateDeps['consent']>['request']>[0]) => {
      const throwingRenames = new Proxy([], {
        get(target, property, receiver) {
          if (property === Symbol.iterator || property === 'map' || property === 'entries') {
            throw new Error('rename iteration failed');
          }
          return Reflect.get(target, property, receiver);
        },
      });
      input.validateRenames(throwingRenames as never);
      return { kind: 'allowed' as const, renames: [] };
    });
    const commitAllowlist = vi.fn(async () => undefined);
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);
    scenario.recordingStorage.reset();

    await expect(generate(withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []), DEFAULT_OPTIONS))
      .rejects.toBeInstanceOf(UnexpectedCrashError);

    expect(request).toHaveBeenCalledOnce();
    expect(commitAllowlist).not.toHaveBeenCalled();
    expect(scenario.recordingStorage.writes).toEqual([]);
  });

  it('turns a malformed rename-validation handoff into a run-scoped UnexpectedCrashError before artifact settlement', async () => {
    const execute = vi.fn(async () => ({ data: namedResponse(undefined), raw: 'named' }));
    const request = vi.fn(async () => ({ kind: 'allowed', renames: null }) as never);
    const commitAllowlist = vi.fn(async () => undefined);
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);
    scenario.recordingStorage.reset();

    await expect(generate(withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []), DEFAULT_OPTIONS))
      .rejects.toBeInstanceOf(UnexpectedCrashError);

    expect(request).toHaveBeenCalledOnce();
    expect(commitAllowlist).not.toHaveBeenCalled();
    expect(scenario.recordingStorage.writes).toEqual([]);
  });

  it('reuses a successful first duplicate occurrence virtually instead of calling the provider twice', async () => {
    const execute = vi.fn(async () => ({ data: RESPONSE, raw: JSON.stringify(RESPONSE) }));
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: vi.fn(async () => ['login.test.md', 'login.test.md']),
    });
    await writePrompt(scenario.recordingStorage.storage);

    await generate(scenario.deps, DEFAULT_OPTIONS);

    expect(execute).toHaveBeenCalledOnce();
  });

  it('keeps an earlier Stage-1 success before a later Stage-1 failure in selection-occurrence order', async () => {
    const execute = vi.fn(async (request: AiExecuteRequest<unknown>) => {
      if (String((request.context as { readonly testMd: string }).testMd).includes('second')) throw new AiExecutorUnavailableError('later failed');
      return { data: RESPONSE, raw: 'first succeeded' };
    });
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: vi.fn(async () => ['first.test.md', 'second.test.md']),
    });
    const first = await writePrompt(scenario.recordingStorage.storage, 'first.test.md', 'first');
    const second = await writePrompt(scenario.recordingStorage.storage, 'second.test.md', 'second');

    const outcome = await generate(scenario.deps, { ...DEFAULT_OPTIONS, maxAttempts: 1 });

    expect(outcome.results.map(({ file, status }) => ({ file, status }))).toEqual([
      { file: first, status: 'generated' },
      { file: second, status: 'failed' },
    ]);
  });

  it('lets a later duplicate observe a successfully generated virtual plan before settlement makes it durable', async () => {
    const execute = vi.fn(async () => ({ data: RESPONSE, raw: JSON.stringify(RESPONSE) }));
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: vi.fn(async () => ['login.test.md', 'login.test.md']),
    });
    const file = await writePrompt(scenario.recordingStorage.storage);
    const storage: StorageAdapter = {
      ...scenario.deps.storage,
      async writeText(path, content) {
        if (path.endsWith('.ambercast.plan.json') || path.endsWith('.ambercast.grounding.json')) return;
        await scenario.deps.storage.writeText(path, content);
      },
    };

    const outcome = await generate({ ...scenario.deps, storage }, DEFAULT_OPTIONS);

    expect(outcome.results).toMatchObject([
      { file, status: 'generated' },
      { file, status: 'skipped-fresh' },
    ]);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('lets a later duplicate observe a successful fresh virtual plan even when the durable lookup disappears', async () => {
    const scenario = createScenario({
      discoverTestFiles: vi.fn(async () => ['login.test.md', 'login.test.md']),
    });
    const file = await writePrompt(scenario.recordingStorage.storage);
    await seedFreshArtifacts(scenario.recordingStorage.storage, file, [{
      id: 'fill-password',
      kind: 'action',
      action: 'fill-secret',
      target: PASSWORD_TARGET,
      secretRef: '{{secrets.password}}',
    }] as unknown as Step[]);
    const planPath = scenario.deps.layout.planPathFor(file);
    let durablePlanChecks = 0;
    const storage: StorageAdapter = {
      ...scenario.deps.storage,
      async exists(path) {
        if (path === planPath) {
          durablePlanChecks += 1;
          return durablePlanChecks === 1;
        }
        return scenario.deps.storage.exists(path);
      },
    };
    const request = vi.fn(async () => ({ kind: 'allowed' as const, renames: [] }));
    const commitAllowlist = vi.fn(async () => undefined);

    const outcome = await generate(
      withSecretConfig({ ...scenario.deps, storage, consent: { request, commitAllowlist } }, []),
      DEFAULT_OPTIONS,
    );

    expect(outcome.results).toMatchObject([
      { file, status: 'skipped-fresh' },
      { file, status: 'skipped-fresh' },
    ]);
    expect(scenario.execute).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      items: [
        { file, uses: [expect.objectContaining({ name: 'password', stepId: 'fill-password' })] },
        { file, uses: [expect.objectContaining({ name: 'password', stepId: 'fill-password' })] },
      ],
    }));
    expect(commitAllowlist).toHaveBeenCalledExactlyOnceWith(
      '/workspace/ambercast.config.json',
      ['password'],
      undefined,
    );
  });

  it('creates no virtual freshness entry for a failed first duplicate occurrence', async () => {
    let dispatch = 0;
    const execute = vi.fn(async () => {
      dispatch += 1;
      if (dispatch === 1) throw new Error('first occurrence failed');
      return { data: RESPONSE, raw: JSON.stringify(RESPONSE) };
    });
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: vi.fn(async () => ['login.test.md', 'login.test.md']),
    });
    const file = await writePrompt(scenario.recordingStorage.storage);

    const outcome = await generate(scenario.deps, { ...DEFAULT_OPTIONS, maxAttempts: 1 });

    expect(outcome.results).toMatchObject([
      { file, status: 'failed' },
      { file, status: 'generated' },
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('forces every duplicate past durable and virtual freshness while snapshotting each occurrence before dispatch', async () => {
    const execute = vi.fn(async () => ({ data: RESPONSE, raw: JSON.stringify(RESPONSE) }));
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: vi.fn(async () => ['login.test.md', 'login.test.md']),
    });
    const file = await writePrompt(scenario.recordingStorage.storage);
    await seedFreshArtifacts(scenario.recordingStorage.storage, file);
    const readTextSnapshotIfExists = vi.fn(scenario.deps.storage.readTextSnapshotIfExists);

    const outcome = await generate(
      { ...scenario.deps, storage: { ...scenario.deps.storage, readTextSnapshotIfExists } },
      { ...DEFAULT_OPTIONS, force: true, dryRun: true },
    );

    expect(outcome.results).toMatchObject([
      { file, status: 'would-generate' },
      { file, status: 'would-generate' },
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(readTextSnapshotIfExists).toHaveBeenCalledTimes(2);
    expect(readTextSnapshotIfExists).toHaveBeenNthCalledWith(1, scenario.deps.layout.planPathFor(file));
    expect(readTextSnapshotIfExists).toHaveBeenNthCalledWith(2, scenario.deps.layout.planPathFor(file));
    expect(readTextSnapshotIfExists.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]!);
    expect(readTextSnapshotIfExists.mock.invocationCallOrder[1]).toBeLessThan(execute.mock.invocationCallOrder[1]!);
  });

  it('takes the old-plan snapshot before a forced provider call, including dry-run', async () => {
    const execute = vi.fn(async () => ({ data: RESPONSE, raw: JSON.stringify(RESPONSE) }));
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    const readTextSnapshotIfExists = vi.fn(scenario.deps.storage.readTextSnapshotIfExists);
    await writePrompt(scenario.recordingStorage.storage);

    await generate({ ...scenario.deps, storage: { ...scenario.deps.storage, readTextSnapshotIfExists } }, { ...DEFAULT_OPTIONS, force: true, dryRun: true });

    expect(readTextSnapshotIfExists).toHaveBeenCalledWith(`${TEST_DIR}/login.ambercast.plan.json`);
    expect(readTextSnapshotIfExists.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]!);
  });

  it('does not take the C2-12 old-plan snapshot without force', async () => {
    const execute = vi.fn(async () => ({ data: RESPONSE, raw: JSON.stringify(RESPONSE) }));
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    const readTextSnapshotIfExists = vi.fn(scenario.deps.storage.readTextSnapshotIfExists);
    await writePrompt(scenario.recordingStorage.storage);

    await generate(
      { ...scenario.deps, storage: { ...scenario.deps.storage, readTextSnapshotIfExists } },
      DEFAULT_OPTIONS,
    );

    expect(readTextSnapshotIfExists).not.toHaveBeenCalled();
  });

  it('warns when a forced valid-v3 old plan and generated plan use the same name and step with different targets', async () => {
    const response = namedResponse(undefined);
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw: 'named' }) }),
    });
    const file = await writePrompt(scenario.recordingStorage.storage);
    const previousTarget = { ...PASSWORD_TARGET, role: 'searchbox' };
    await createFreshPlan(scenario.recordingStorage.storage, file, [{
      id: 'fill-password',
      kind: 'action',
      action: 'fill-secret',
      target: previousTarget,
      secretRef: '{{secrets.password}}',
    }] as unknown as Step[]);

    const outcome = await generate(withSecretConfig(scenario.deps, '*'), { ...DEFAULT_OPTIONS, force: true, dryRun: true });

    expect(targetChangeWarnings(outcome)).toEqual([{
      kind: 'secret-target-changed',
      name: 'password',
      stepId: 'fill-password',
      previousTarget,
      target: PASSWORD_TARGET,
    }]);
  });

  it('does not warn when both forced-plan targets for the same name and step are equal', async () => {
    const response = namedResponse(undefined);
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw: 'named' }) }),
    });
    const file = await writePrompt(scenario.recordingStorage.storage);
    await createFreshPlan(scenario.recordingStorage.storage, file, [{
      id: 'fill-password',
      kind: 'action',
      action: 'fill-secret',
      target: PASSWORD_TARGET,
      secretRef: '{{secrets.password}}',
    }] as unknown as Step[]);

    const outcome = await generate(withSecretConfig(scenario.deps, '*'), { ...DEFAULT_OPTIONS, force: true, dryRun: true });

    expect(targetChangeWarnings(outcome)).toEqual([]);
  });

  it.each([
    {
      side: 'old plan',
      oldStep: committedAiSecretStep('password'),
      response: namedResponse(undefined),
    },
    {
      side: 'generated plan',
      oldStep: {
        id: 'fill-password',
        kind: 'action',
        action: 'fill-secret',
        target: PASSWORD_TARGET,
        secretRef: '{{secrets.password}}',
      } as unknown as Step,
      response: generatedAiSecretResponse('password'),
    },
  ] as const)('does not warn when the $side side of a forced target comparison is untargeted', async ({ oldStep, response }) => {
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw: 'named' }) }),
    });
    const file = await writePrompt(scenario.recordingStorage.storage);
    await createFreshPlan(scenario.recordingStorage.storage, file, [oldStep]);

    const outcome = await generate(withSecretConfig(scenario.deps, '*'), { ...DEFAULT_OPTIONS, force: true, dryRun: true });

    expect(targetChangeWarnings(outcome)).toEqual([]);
  });

  it.each([
    ['invalid JSON', '{'],
    ['a non-v3 plan', JSON.stringify({ schemaVersion: 2, source: { inputsDigest: '0'.repeat(64) }, targets: {}, steps: [] })],
  ] as const)('does not warn from %s returned by the forced old-plan snapshot', async (_description, text) => {
    const response = namedResponse(undefined);
    const execute = vi.fn(async () => ({ data: response, raw: 'named' }));
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
    });
    await writePrompt(scenario.recordingStorage.storage);
    const readTextSnapshotIfExists = vi.fn<StorageAdapter['readTextSnapshotIfExists']>(async () => ({
      text,
      bytes: new TextEncoder().encode(text),
    }));

    const outcome = await generate(
      withSecretConfig({ ...scenario.deps, storage: { ...scenario.deps.storage, readTextSnapshotIfExists } }, '*'),
      { ...DEFAULT_OPTIONS, force: true, dryRun: true },
    );

    expect(readTextSnapshotIfExists).toHaveBeenCalledOnce();
    expect(targetChangeWarnings(outcome)).toEqual([]);
    expect(outcome.results).toMatchObject([{ status: 'would-generate' }]);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('treats an ENOENT forced old-plan snapshot as null and emits no target-change warning', async () => {
    const response = namedResponse(undefined);
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw: 'named' }) }),
    });
    await writePrompt(scenario.recordingStorage.storage);
    const readTextSnapshotIfExists = vi.fn<StorageAdapter['readTextSnapshotIfExists']>(async () => null);

    const outcome = await generate(
      withSecretConfig({ ...scenario.deps, storage: { ...scenario.deps.storage, readTextSnapshotIfExists } }, '*'),
      { ...DEFAULT_OPTIONS, force: true, dryRun: true },
    );

    expect(readTextSnapshotIfExists).toHaveBeenCalledOnce();
    expect(targetChangeWarnings(outcome)).toEqual([]);
  });

  it('scans legacy secret syntax before target selection and continues later occurrences', async () => {
    const execute = vi.fn(async () => ({ data: RESPONSE, raw: JSON.stringify(RESPONSE) }));
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: vi.fn(async () => ['legacy.test.md', 'valid.test.md']),
    });
    const legacy = await writePrompt(scenario.recordingStorage.storage, 'legacy.test.md', '# Legacy\n\n{{secrets.password}}\n');
    await writePrompt(scenario.recordingStorage.storage, 'valid.test.md');

    const outcome = await generate(scenario.deps, { ...DEFAULT_OPTIONS, target: 'missing-target' });

    expect(outcome.results[0]).toMatchObject({ file: legacy, status: 'failed', error: expect.objectContaining({ kind: 'secret-syntax-rejected' }) });
    expect(outcome.results[1]).toMatchObject({ status: 'failed', error: expect.any(TargetUnresolvedError) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('projects a sorted names-only allowlist through the 64-name provider boundary', async () => {
    const names = Array.from({ length: 65 }, (_value, index) => `name-${String(index).padStart(2, '0')}`);
    const execute = vi.fn(async () => ({ data: RESPONSE, raw: JSON.stringify(RESPONSE) }));
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);

    await generate(withSecretConfig(scenario.deps, [...names].reverse()), DEFAULT_OPTIONS);

    const calls = execute.mock.calls as unknown as Array<[{ readonly context: { readonly allowedSecretNames: readonly string[] } }]>;
    const request = calls[0]?.[0];
    expect(request?.context.allowedSecretNames)
      .toEqual(names.slice(0, 64));
  });

  it('applies the UTF-8 provider-context byte cap after the 64-name cap and reports the complete kept/dropped accounting', async () => {
    const names = Array.from({ length: 65 }, (_value, index) => `${String(index).padStart(2, '0')}-${'x'.repeat(80)}`);
    const execute = vi.fn(async () => ({ data: RESPONSE, raw: JSON.stringify(RESPONSE) }));
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);

    const outcome = await generate(withSecretConfig(scenario.deps, [...names].reverse()), DEFAULT_OPTIONS);
    const request = (execute.mock.calls as unknown as Array<[{ readonly context: { readonly allowedSecretNames: readonly string[] } }]>)[0]?.[0];
    const projected = request?.context.allowedSecretNames ?? [];

    expect(Buffer.byteLength(JSON.stringify(projected), 'utf8')).toBeLessThanOrEqual(4096);
    expect(projected).toEqual(names.slice(0, projected.length));
    expect(projected.length).toBeLessThan(64);
    expect(outcome.results[0]).toMatchObject({
      warnings: [expect.objectContaining({ kind: 'allowed-names-truncated', kept: projected.length, dropped: names.length - projected.length })],
    });
  });

  it.each([
    { name: 'keeps an exactly 4096-byte encoding', bytes: 4096, names: ['a'.repeat(4092)], expected: ['a'.repeat(4092)] },
    { name: 'drops only the tail of an exactly 4097-byte encoding', bytes: 4097, names: ['a'.repeat(4089), 'b'], expected: ['a'.repeat(4089)] },
  ] as const)('$name', async ({ bytes, names, expected }) => {
    expect(Buffer.byteLength(JSON.stringify(names), 'utf8')).toBe(bytes);
    const execute = vi.fn(async () => ({ data: RESPONSE, raw: JSON.stringify(RESPONSE) }));
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);

    await generate(withSecretConfig(scenario.deps, names), DEFAULT_OPTIONS);

    const context = (execute.mock.calls as unknown as Array<[{ readonly context: { readonly allowedSecretNames: readonly string[] } }]>)[0]?.[0].context;
    expect(context?.allowedSecretNames).toEqual(expected);
  });

  it('reuses the invocation-start names-only allowlist projection for every provider retry', async () => {
    const allowlist = ['alpha'];
    let dispatch = 0;
    const execute = vi.fn(async () => {
      if (dispatch++ === 0) {
        allowlist.push('mutated_between_attempts');
        return { data: namedResponse({ allowedName: 'ALPHA' }), raw: 'invalid' };
      }
      return { data: RESPONSE, raw: 'valid' };
    });
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);

    await generate(withSecretConfig(scenario.deps, allowlist), DEFAULT_OPTIONS);

    const contexts = (execute.mock.calls as unknown as Array<[{ readonly context: Record<string, unknown> }]>).map(([request]) => request.context);
    expect(contexts).toHaveLength(2);
    expect(contexts.map((context) => context.allowedSecretNames)).toEqual([['alpha'], ['alpha']]);
    for (const context of contexts) {
      expect(context).toEqual(expect.objectContaining({ allowedSecretNames: ['alpha'] }));
      expect(context).not.toHaveProperty('values');
      expect(context).not.toHaveProperty('env');
      expect(context).not.toHaveProperty('sink');
    }
  });

  it('treats a non-ENOENT forced old-plan snapshot failure as a case-local FsIoError before provider dispatch', async () => {
    const execute = vi.fn(async () => ({ data: RESPONSE, raw: JSON.stringify(RESPONSE) }));
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    await writePrompt(scenario.recordingStorage.storage);
    const readTextSnapshotIfExists = vi.fn<StorageAdapter['readTextSnapshotIfExists']>(async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    });

    const outcome = await generate({ ...scenario.deps, storage: { ...scenario.deps.storage, readTextSnapshotIfExists } }, { ...DEFAULT_OPTIONS, force: true });

    expect(outcome.results[0]).toMatchObject({ status: 'failed', error: expect.any(FsIoError) });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid config', new ConfigInvalidError('config became invalid')],
    ['config I/O', new FsIoError('config write failed')],
  ] as const)('propagates a run-scoped %s commit error and leaves every artifact uncommitted', async (_description, failure) => {
    const execute = vi.fn(async () => ({ data: namedResponse({ nameHint: 'login_password' }), raw: 'named' }));
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute }) });
    const request = vi.fn(async () => ({ kind: 'allowed' as const, renames: [] }));
    const commitAllowlist = vi.fn(async () => { throw failure; });
    await writePrompt(scenario.recordingStorage.storage);
    scenario.recordingStorage.reset();

    await expect(generate(withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []), DEFAULT_OPTIONS))
      .rejects.toBe(failure);

    expect(request).toHaveBeenCalledOnce();
    expect(scenario.recordingStorage.writes).toEqual([]);
  });

  it('settles config then each plan and grounding in occurrence order, continuing without rollback after one grounding failure', async () => {
    let dispatch = 0;
    const execute = vi.fn(async () => ({
      data: dispatch++ === 0 ? namedResponse(undefined) : RESPONSE,
      raw: 'prepared',
    }));
    const operations: string[] = [];
    const request = vi.fn(async () => ({ kind: 'allowed' as const, renames: [] }));
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: vi.fn(async () => ['first.test.md', 'second.test.md']),
    });
    const first = await writePrompt(scenario.recordingStorage.storage, 'first.test.md');
    const second = await writePrompt(scenario.recordingStorage.storage, 'second.test.md');
    const firstPlan = scenario.deps.layout.planPathFor(first);
    const firstGrounding = scenario.deps.layout.groundingPathFor(first);
    const secondPlan = scenario.deps.layout.planPathFor(second);
    const secondGrounding = scenario.deps.layout.groundingPathFor(second);
    const configPath = '/workspace/ambercast.config.json';
    await scenario.recordingStorage.storage.writeText(configPath, '{"secrets":{"allow":[]}}\n');
    scenario.recordingStorage.reset();
    const storage: StorageAdapter = {
      ...scenario.deps.storage,
      async writeText(path, content) {
        operations.push(path);
        if (path === firstGrounding) throw new Error('first grounding failed');
        await scenario.deps.storage.writeText(path, content);
      },
    };
    const commitAllowlist = vi.fn(async () => {
      operations.push('config');
      await scenario.deps.storage.writeText(configPath, '{"secrets":{"allow":["password"]}}\n');
    });

    const outcome = await generate(
      withSecretConfig({ ...scenario.deps, storage, consent: { request, commitAllowlist } }, []),
      DEFAULT_OPTIONS,
    );

    expect(operations).toEqual(['config', firstPlan, firstGrounding, secondPlan, secondGrounding]);
    expect(outcome.results).toMatchObject([
      { file: first, status: 'failed', error: expect.any(FsIoError) },
      { file: second, status: 'generated' },
    ]);
    await expect(scenario.deps.storage.readText(configPath)).resolves.toContain('password');
    await expect(scenario.deps.storage.exists(firstPlan)).resolves.toBe(true);
    await expect(scenario.deps.storage.exists(firstGrounding)).resolves.toBe(false);
    await expect(scenario.deps.storage.exists(secondPlan)).resolves.toBe(true);
    await expect(scenario.deps.storage.exists(secondGrounding)).resolves.toBe(true);
  });

  it('leaves config and all candidate artifacts unchanged when abort wins before config commit success', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => ({ data: namedResponse(undefined), raw: 'named' }));
    const request = vi.fn(async () => ({ kind: 'allowed' as const, renames: [] }));
    let markCommitStarted!: () => void;
    const commitStarted = new Promise<void>((resolve) => { markCommitStarted = resolve; });
    let releaseCommit!: () => void;
    const commitRelease = new Promise<void>((resolve) => { releaseCommit = resolve; });
    const scenario = createScenario({
      signal: controller.signal,
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
    });
    const file = await writePrompt(scenario.recordingStorage.storage);
    const configPath = '/workspace/ambercast.config.json';
    const originalConfig = '{"secrets":{"allow":[]}}\n';
    await scenario.recordingStorage.storage.writeText(configPath, originalConfig);
    scenario.recordingStorage.reset();
    const commitAllowlist = vi.fn(async (_path: string | null, _names: readonly string[], signal?: AbortSignal) => {
      markCommitStarted();
      await commitRelease;
      signal?.throwIfAborted();
      await scenario.deps.storage.writeText(configPath, '{"secrets":{"allow":["password"]}}\n');
    });
    const running = generate(
      withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []),
      DEFAULT_OPTIONS,
    );
    const phase = await Promise.race([
      commitStarted.then(() => 'commit-started' as const),
      running.then(() => 'finished-early' as const),
    ]);
    expect(phase).toBe('commit-started');
    if (phase !== 'commit-started') return;

    controller.abort(new Error('abort before config commit'));
    releaseCommit();
    await running.catch(() => undefined);

    expect(commitAllowlist).toHaveBeenCalledExactlyOnceWith(configPath, ['password'], controller.signal);
    await expect(scenario.deps.storage.readText(configPath)).resolves.toBe(originalConfig);
    await expect(scenario.deps.storage.exists(scenario.deps.layout.planPathFor(file))).resolves.toBe(false);
    await expect(scenario.deps.storage.exists(scenario.deps.layout.groundingPathFor(file))).resolves.toBe(false);
  });

  it('keeps a successful config commit when abort lands before it returns, without settling candidate artifacts', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => ({ data: namedResponse(undefined), raw: 'named' }));
    const request = vi.fn(async () => ({ kind: 'allowed' as const, renames: [] }));
    let markConfigPersisted!: () => void;
    const configPersisted = new Promise<void>((resolve) => { markConfigPersisted = resolve; });
    let releaseCommit!: () => void;
    const commitRelease = new Promise<void>((resolve) => { releaseCommit = resolve; });
    const scenario = createScenario({
      signal: controller.signal,
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
    });
    const file = await writePrompt(scenario.recordingStorage.storage);
    const configPath = '/workspace/ambercast.config.json';
    await scenario.recordingStorage.storage.writeText(configPath, '{"secrets":{"allow":[]}}\n');
    scenario.recordingStorage.reset();
    const committedConfig = '{"secrets":{"allow":["password"]}}\n';
    const commitAllowlist = vi.fn(async () => {
      await scenario.deps.storage.writeText(configPath, committedConfig);
      markConfigPersisted();
      await commitRelease;
    });
    const running = generate(
      withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []),
      DEFAULT_OPTIONS,
    );
    const phase = await Promise.race([
      configPersisted.then(() => 'config-persisted' as const),
      running.then(() => 'finished-early' as const),
    ]);
    expect(phase).toBe('config-persisted');
    if (phase !== 'config-persisted') return;

    controller.abort(new Error('abort after config commit'));
    releaseCommit();
    await expect(running).resolves.toMatchObject({
      interrupted: true,
      results: [{ file, status: 'skipped' }],
    });

    await expect(scenario.deps.storage.readText(configPath)).resolves.toBe(committedConfig);
    await expect(scenario.deps.storage.exists(scenario.deps.layout.planPathFor(file))).resolves.toBe(false);
    await expect(scenario.deps.storage.exists(scenario.deps.layout.groundingPathFor(file))).resolves.toBe(false);
  });

  it('asks once and declines only candidates containing needed names while settling unaffected prepared candidates', async () => {
    let dispatch = 0;
    const execute = vi.fn(async () => ({
      data: dispatch++ === 0 ? namedResponse({ nameHint: 'login_password' }) : RESPONSE,
      raw: 'prepared',
    }));
    const request = vi.fn(async () => ({ kind: 'declined' as const }));
    const commitAllowlist = vi.fn(async () => undefined);
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: vi.fn(async () => ['needs-consent.test.md', 'unaffected.test.md']),
    });
    await writePrompt(scenario.recordingStorage.storage, 'needs-consent.test.md');
    await writePrompt(scenario.recordingStorage.storage, 'unaffected.test.md');
    scenario.recordingStorage.reset();

    const outcome = await generate(withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []), DEFAULT_OPTIONS);

    expect(request).toHaveBeenCalledOnce();
    expect(commitAllowlist).not.toHaveBeenCalled();
    expect(outcome.results).toMatchObject([{ status: 'failed' }, { status: 'generated' }]);
    expect(scenario.recordingStorage.writes.map((write) => write.path)).toEqual(expect.arrayContaining([
      `${TEST_DIR}/unaffected.ambercast.plan.json`,
      `${TEST_DIR}/unaffected.ambercast.grounding.json`,
    ]));
  });

  it.each(['declined', 'not-interactive'] as const)('keeps an earlier allowed success before a later %s consent failure', async (kind) => {
    let dispatch = 0;
    const execute = vi.fn(async () => ({
      data: dispatch++ === 0 ? namedResponse({ allowedName: 'already' }) : namedResponse({ nameHint: 'needs' }),
      raw: 'named',
    }));
    const scenario = createScenario({
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: vi.fn(async () => ['first.test.md', 'second.test.md']),
    });
    const first = await writePrompt(scenario.recordingStorage.storage, 'first.test.md');
    const second = await writePrompt(scenario.recordingStorage.storage, 'second.test.md');

    const outcome = await generate(withSecretConfig({
      ...scenario.deps,
      consent: { request: async () => ({ kind }), commitAllowlist: async () => undefined },
    }, ['already']), DEFAULT_OPTIONS);

    expect(outcome.results.map(({ file, status }) => ({ file, status }))).toEqual([
      { file: first, status: 'generated' },
      { file: second, status: 'failed' },
    ]);
  });

  it('reports the exact not-interactive consent remedy and ordered multi-use details', async () => {
    const response = {
      steps: [
        { id: 'fill-first', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'First' }, secret: { nameHint: 'first_name' } },
        { id: 'fill-second', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Second' }, secret: { nameHint: 'second_name' } },
      ],
      ambiguities: [],
    } as unknown as GeneratedPlanResponse;
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw: 'multi-use' }) }) });
    await writePrompt(scenario.recordingStorage.storage);

    const outcome = await generate(withSecretConfig({
      ...scenario.deps,
      consent: { request: async () => ({ kind: 'not-interactive' }), commitAllowlist: async () => undefined },
    }, []), DEFAULT_OPTIONS);
    const error = outcome.results[0]?.error;

    expect(error).toBeInstanceOf(SecretConsentRequiredError);
    expect(error).toMatchObject({
      details: {
        reason: 'not-interactive',
        hint: 'Add the secret names to secrets.allow in ambercast.config.json, then rerun `ambercast generate`.',
        secrets: [
          { name: 'first', stepId: 'fill-first', envVar: 'AMBERCAST_SECRET_FIRST', reason: 'requires consent' },
          { name: 'second', stepId: 'fill-second', envVar: 'AMBERCAST_SECRET_SECOND', reason: 'requires consent' },
        ],
      },
    });
  });

  it('commits every final candidate name when a concurrently held config removes an initially allowed name', async () => {
    const response = {
      steps: [
        { id: 'fill-retained', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Retained' }, secret: { nameHint: 'retained' } },
        { id: 'fill-added', kind: 'action', action: 'fill-secret', target: { ...PASSWORD_TARGET, name: 'Added' }, secret: { nameHint: 'added' } },
      ],
      ambiguities: [],
    } as unknown as GeneratedPlanResponse;
    const scenario = createScenario({ resolveAiExecutor: async () => createFakeAiExecutor({ execute: async () => ({ data: response, raw: 'two names' }) }) });
    const configPath = '/workspace/ambercast.config.json';
    await writePrompt(scenario.recordingStorage.storage);
    await scenario.deps.storage.writeText(configPath, '{"secrets":{"allow":["retained"]}}\n');
    const commitAllowlist = vi.fn(async (_path: string | null, names: readonly string[]) => {
      await scenario.deps.storage.writeText(configPath, '{"secrets":{"allow":[]}}\n');
      expect(await scenario.deps.storage.readText(configPath)).toBe('{"secrets":{"allow":[]}}\n');
      expect(names).toEqual(['retained', 'added']);
    });

    await expect(generate(withSecretConfig({
      ...scenario.deps,
      consent: { request: async () => ({ kind: 'allowed' as const, renames: [] }), commitAllowlist },
    }, ['retained']), DEFAULT_OPTIONS)).resolves.toMatchObject({ results: [{ status: 'generated' }] });

    expect(commitAllowlist).toHaveBeenCalledExactlyOnceWith(configPath, ['retained', 'added'], undefined);
  });
});

describe('generate interruption contract', () => {
  it('deduplicates pre-aborted non-list occurrences into one identity-only skipped row without starting I/O', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, recordingStorage } = createScenario({ signal: controller.signal });

    const outcome = await generate(deps, { ...DEFAULT_OPTIONS, files: [`${TEST_DIR}/same.test.md`, `${TEST_DIR}/same.test.md`] });

    expect(outcome.interrupted).toBe(true);
    expect(outcome.results).toEqual([
      { file: `${TEST_DIR}/same.test.md`, status: 'skipped' },
    ]);
    expect(recordingStorage.reads).toEqual([]);
  });

  it('keeps every started duplicate as an individual skipped row when interruption lands at the in-flight consent gate', async () => {
    const controller = new AbortController();
    const response = {
      steps: [{ id: 'fill-password', kind: 'action', action: 'fill-secret', target: PASSWORD_TARGET }],
      ambiguities: [],
    } as unknown as GeneratedPlanResponse;
    const execute = vi.fn(async () => ({ data: response, raw: 'named' }));
    let markRequestStarted!: () => void;
    const requestStarted = new Promise<void>((resolve) => { markRequestStarted = resolve; });
    let releaseRequest!: () => void;
    const requestRelease = new Promise<void>((resolve) => { releaseRequest = resolve; });
    const request = vi.fn(async () => {
      markRequestStarted();
      await requestRelease;
      return { kind: 'not-interactive' as const };
    });
    const commitAllowlist = vi.fn(async () => undefined);
    const scenario = createScenario({
      signal: controller.signal,
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: vi.fn(async () => ['same.test.md', 'same.test.md']),
    });
    const file = await writePrompt(scenario.recordingStorage.storage, 'same.test.md');
    scenario.recordingStorage.reset();
    const running = generate(
      withSecretConfig({ ...scenario.deps, consent: { request, commitAllowlist } }, []),
      DEFAULT_OPTIONS,
    );
    const phase = await Promise.race([
      requestStarted.then(() => 'request-started' as const),
      running.then(() => 'finished-early' as const),
    ]);
    expect(phase).toBe('request-started');
    if (phase !== 'request-started') return;

    controller.abort(new Error('abort during consent'));
    releaseRequest();

    await expect(running).resolves.toMatchObject({
      interrupted: true,
      results: [
        { file, status: 'skipped' },
        { file, status: 'skipped' },
      ],
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    expect(commitAllowlist).not.toHaveBeenCalled();
    expect(scenario.recordingStorage.writes).toEqual([]);
  });

  it('keeps list mode atomic for an already aborted signal and exposes a false interruption fact', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, recordingStorage } = createScenario({ signal: controller.signal });

    const outcome = await generate(deps, { ...DEFAULT_OPTIONS, files: [`${TEST_DIR}/a.test.md`, `${TEST_DIR}/b.test.md`], list: true });

    expect(outcome.interrupted).toBe(false);
    expect(outcome.results).toEqual([
      { file: `${TEST_DIR}/a.test.md`, status: 'listed' },
      { file: `${TEST_DIR}/b.test.md`, status: 'listed' },
    ]);
    expect(recordingStorage.reads).toEqual([]);
  });

  it('skips the interrupted provider work and pending suffix without later I/O or AI', async () => {
    const controller = new AbortController();
    let releaseFirst: ((value: { data: GeneratedPlanResponse; raw: string }) => void) | undefined;
    let started: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => { started = resolve; });
    const execute = vi.fn(() => new Promise<{ data: GeneratedPlanResponse; raw: string }>((resolve) => {
      releaseFirst = resolve;
      started?.();
    }));
    const { deps, recordingStorage } = createScenario({
      signal: controller.signal,
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: vi.fn(async () => ['first.test.md', 'second.test.md', 'third.test.md']),
    });
    const first = await writePrompt(recordingStorage.storage, 'first.test.md');
    const second = await writePrompt(recordingStorage.storage, 'second.test.md');
    const third = await writePrompt(recordingStorage.storage, 'third.test.md');
    recordingStorage.reset();

    const running = generate(deps, DEFAULT_OPTIONS);
    await firstStarted;
    controller.abort();
    releaseFirst?.({ data: RESPONSE, raw: JSON.stringify(RESPONSE) });

    await expect(running).resolves.toMatchObject({
      interrupted: true,
      results: [
        { file: first, status: 'skipped' },
        { file: second, status: 'skipped' },
        { file: third, status: 'skipped' },
      ],
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(recordingStorage.reads).toEqual(expect.arrayContaining([first]));
    expect(recordingStorage.reads.filter((path) => path === second || path === third)).toEqual([]);
  });

  it('keeps a pending duplicate occurrence as its own skipped row after the first occurrence becomes terminal', async () => {
    const controller = new AbortController();
    const path = `${TEST_DIR}/same.test.md`;
    const recordingStorage = createRecordingStorage();
    const storage: StorageAdapter = {
      ...recordingStorage.storage,
      async writeText(writtenPath, content) {
        await recordingStorage.storage.writeText(writtenPath, content);
        if (writtenPath === `${TEST_DIR}/same.ambercast.plan.json`) controller.abort();
      },
    };
    const { deps } = createScenario({
      signal: controller.signal,
      storage,
      discoverTestFiles: vi.fn(async () => ['same.test.md', 'same.test.md']),
    });
    await writePrompt(storage, 'same.test.md');
    recordingStorage.reset();

    await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toMatchObject({
      interrupted: true,
      results: [
        { file: path, status: 'generated' },
        { file: path, status: 'skipped' },
      ],
    });
  });

  it('cancels an in-flight provider request without writing artifacts and skips its pending work', async () => {
    const controller = new AbortController();
    let started: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => { started = resolve; });
    const execute = vi.fn((request: AiExecuteRequest<unknown>) => new Promise<never>((_resolve, reject) => {
      const signal = request.signal;
      if (signal === undefined) throw new Error('Expected provider cancellation signal.');
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      started?.();
    }));
    const { deps, recordingStorage } = createScenario({
      signal: controller.signal,
      resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
      discoverTestFiles: vi.fn(async () => ['first.test.md', 'second.test.md']),
    });
    const first = await writePrompt(recordingStorage.storage, 'first.test.md');
    const second = await writePrompt(recordingStorage.storage, 'second.test.md');
    recordingStorage.reset();

    const running = generate(deps, DEFAULT_OPTIONS);
    await firstStarted;
    controller.abort(new Error('stop'));

    await expect(running).resolves.toMatchObject({
      interrupted: true,
      results: [
        { file: first, status: 'skipped' },
        { file: second, status: 'skipped' },
      ],
    });
    expect(recordingStorage.writes).toEqual([]);
  });

  it.each(['normal return', 'discovery rejection'] as const)('disposes the interruption tracker from generate finally after %s', async (mode) => {
    const dispose = vi.spyOn(BatchInterruptionTracker.prototype, 'dispose');
    const controller = new AbortController();
    const { deps, recordingStorage } = createScenario({
      signal: controller.signal,
      discoverTestFiles: mode === 'normal return'
        ? vi.fn(async () => ['login.test.md'])
        : vi.fn(async () => { throw new Error('discovery failed'); }),
    });
    if (mode === 'normal return') await writePrompt(recordingStorage.storage);

    if (mode === 'normal return') {
      await expect(generate(deps, DEFAULT_OPTIONS)).resolves.toBeDefined();
    } else {
      await expect(generate(deps, DEFAULT_OPTIONS)).rejects.toThrow('discovery failed');
    }
    expect(dispose).toHaveBeenCalledOnce();
    dispose.mockRestore();
  });
});
