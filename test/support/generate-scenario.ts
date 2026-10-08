import { vi } from 'vitest';
import { promptTemplateFingerprint } from '#core/ai/prompt-envelope.js';
import { createCallIdAllocator } from '#core/ai/call-id-allocator.js';
import { PlanDocument, type GeneratedPlanResponse, type GroundingDocument, type JsonValueT, type Step } from '#core/ir/schema.js';
import { computeInputsDigest, computePlanDigest } from '#core/ir/digest.js';
import * as planProducerBundle from '#core/ai/plan-producer-bundle.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { normalizeTestMd } from '#core/ir/normalize.js';
import { createLayoutResolver } from '#core/layout/resolve.js';
import type { AiExecuteRequest } from '#ports/ai.js';
import type { StorageAdapter } from '#ports/storage.js';
import type { GenerateDeps, GenerateOptions } from '#usecases/generate.js';
import { createInMemoryStorage } from '../doubles/create-in-memory-storage.js';
import { createFakeAiExecutor } from '../doubles/fake-ai-executor.js';
import { createRecordingEventSink } from '../doubles/create-recording-event-sink.js';

export const TEST_DIR = '/workspace/tests';
export const RUNS_DIR = '/workspace/tests/.runs';
export const TARGETS = { web: { surface: 'web' as const, baseUrl: 'https://example.test' } } as const;
export const RESOLVED_TARGETS = { web: { ...TARGETS.web, executor: { kind: 'playwright', browser: 'chromium' }, healReplayIsolation: 'stateful' as const, resolveTimeoutMs: 5000 } } as const;
export const NAMED_INTENT_LINE = 'Use "Account", "Token one", "Token two", "Alpha", "Beta", "First", "Second", "Retained", and "Added" fields.';
export const PROMPT = `# Sign in\n\nWhen I submit valid credentials, I reach the dashboard.\nPassword "Password"\n${NAMED_INTENT_LINE}\n`;
export const RESPONSE: GeneratedPlanResponse = { steps: [], ambiguities: [] };
export const DEFAULT_OPTIONS: GenerateOptions = {
  files: [],
  strict: false,
  force: false,
  maxAttempts: 2,
  dryRun: false,
  allowEmpty: false,
  list: false,
};

export interface RecordingStorage {
  readonly storage: StorageAdapter;
  readonly reads: string[];
  readonly exists: string[];
  readonly writes: { readonly path: string; readonly content: string }[];
  reset(): void;
}

export function createRecordingStorage(
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

export function createScenario(overrides: Partial<GenerateDeps> = {}) {
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
    clock: { now: () => new Date(0), monotonicMs: () => 0, sleep: async () => undefined },
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

export function withSecretConfig(deps: GenerateDeps, allow: readonly string[] | '*'): GenerateDeps {
  return {
    ...deps,
    config: { ...deps.config, secrets: { allow }, projectRoot: '/workspace' } as unknown as GenerateDeps['config'],
    configSource: { path: '/workspace/ambercast.config.json' },
  } as unknown as GenerateDeps;
}

export async function writePrompt(storage: StorageAdapter, relativePath = 'login.test.md', contents = PROMPT): Promise<string> {
  const path = `${TEST_DIR}/${relativePath}`;
  await storage.writeText(path, contents);
  return path;
}

export async function createFreshPlan(
  storage: StorageAdapter,
  testPath: string,
  steps: readonly Step[] = [],
  targetDefinitions: PlanDocument['targets'] = TARGETS,
): Promise<PlanDocument> {
  const layout = createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR });
  const normalizedTestMd = normalizeTestMd(await storage.readText(testPath));
  const referencedTargetNames = new Set(steps.map((step) => step.target));
  const planTargets = Object.fromEntries(
    Object.entries(targetDefinitions).filter(([name]) => referencedTargetNames.has(name)),
  ) as PlanDocument['targets'];
  const inputsDigest = computeInputsDigest({
    normalizedTestMd,
    schemaVersion: 5,
    generatorPromptTemplateFingerprint: promptTemplateFingerprint(),
    planProducerBundleFingerprint: planProducerBundle.planProducerBundleFingerprint(),
    targetDefinitions: planTargets,
  });
  const plan = {
    schemaVersion: 5,
    source: { inputsDigest },
    targets: planTargets,
    steps: [...steps],
  } as unknown as PlanDocument;

  await storage.writeText(layout.planPathFor(testPath), toCanonicalArtifactText(plan as unknown as JsonValueT));
  return plan;
}

export async function seedFreshArtifacts(
  storage: StorageAdapter,
  testPath: string,
  steps: readonly Step[] = [],
  targetDefinitions: PlanDocument['targets'] = TARGETS,
): Promise<void> {
  const layout = createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR });
  const plan = await createFreshPlan(storage, testPath, steps, targetDefinitions);
  const grounding: GroundingDocument = { schemaVersion: 3, planDigest: computePlanDigest(plan), entries: {} };

  await storage.writeText(
    layout.groundingPathFor(testPath),
    toCanonicalArtifactText(grounding as unknown as JsonValueT),
  );
}

