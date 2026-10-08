import { vi } from 'vitest';
import { promptTemplateFingerprint } from '#core/ai/prompt-envelope.js';
import { createCallIdAllocator } from '#core/ai/call-id-allocator.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { UI_CAPABILITIES } from '#core/ir/capabilities.js';
import { computeInputsDigest, computeIntentDigest, computePlanDigest } from '#core/ir/digest.js';
import { planProducerBundleFingerprint } from '#core/ai/plan-producer-bundle.js';
import { normalizeTestMd } from '#core/ir/normalize.js';
import { type ElementRef, type Fingerprint, GroundingDocument, GROUNDING_SCHEMA_VERSION, PLAN_SCHEMA_VERSION, PlanDocument, Step, type JsonValueT } from '#core/ir/schema.js';
import { createLayoutResolver } from '#core/layout/resolve.js';
import type { AssertOutcome, BrowserSession } from '#ports/browser.js';
import type { StorageAdapter } from '#ports/storage.js';
import type { HealDeps, HealOptions } from '#usecases/heal.js';
import { createInMemoryStorage } from '../doubles/create-in-memory-storage.js';
import { createFixedClock } from '../doubles/create-fixed-clock.js';
import { createRecordingEventSink } from '../doubles/create-recording-event-sink.js';
import { createFakeAiExecutor } from '../doubles/fake-ai-executor.js';
import { createFakeUiExecutor } from '../doubles/fake-ui-executor.js';
import { createFakeBrowserSession, elementRefKey, type FakeBrowserSessionEntry } from '../doubles/fake-browser-session.js';
import { createFakeSecretsProvider } from '../doubles/fake-secrets-provider.js';

export const TEST_DIR = '/workspace/tests';
export const RUNS_DIR = '/workspace/tests/.runs';
export const PROMPT = '# Sign in\n\nWhen I submit valid credentials, I reach the dashboard.\n';
export const TARGETS = { web: { surface: 'web', baseUrl: 'https://example.test' } } as const;
export const RESOLVED_TARGETS = { web: { ...TARGETS.web, executor: { kind: 'playwright' as const, browser: 'chromium' as const }, healReplayIsolation: 'idempotent' as const, resolveTimeoutMs: 5000 } } as const;
export const FINGERPRINT: Fingerprint = { algorithm: 'a11y-neighborhood-v2', hash: 'a'.repeat(64) };
export const SUBMIT = { strategy: 'accessibility' as const, role: 'button', name: 'Submit' };
export const REPAIRED_SUBMIT = { strategy: 'accessibility' as const, role: 'button', name: 'Continue' };
export const AFTER_SUBMIT = { strategy: 'accessibility' as const, role: 'button', name: 'Open dashboard' };
export const REPAIRED_AFTER_SUBMIT = { strategy: 'accessibility' as const, role: 'button', name: 'Continue to dashboard' };
export const PASSWORD = { strategy: 'accessibility' as const, role: 'textbox', name: 'Password' };
export const REPAIRED_PASSWORD = { strategy: 'accessibility' as const, role: 'textbox', name: 'Continue password' };
export const FIXTURE_SPAN = { startLine: 3, startColumn: 8, endLine: 3, endColumn: 14 } as const;
export function committedIntent(ref: ElementRef) {
  return { description: ref.name, roleHint: ref.role, sourceSpan: FIXTURE_SPAN };
}
export function groundingEntry(ref: ElementRef, fingerprint: Fingerprint, intentRef: ElementRef = ref) {
  return {
    kind: 'element' as const,
    locator: ref,
    fingerprint,
    intentDigest: computeIntentDigest({ stepKind: 'action', operation: 'click', intent: committedIntent(intentRef) }),
    provenance: 'ai-proposed' as const,
  };
}
export const OPTIONS: HealOptions = {
  files: ['/workspace/tests/login.test.md'],
  dryRun: false,
  yes: false,
  list: false,
};

/**
 * Mirrors the live accessibility evidence independently from grounded-entry
 * verification. Route-B resolution reads this tree, whereas session entries
 * model the existing-grounding verification path.
 */
export function healAccessibilityTree(entries: ReadonlyMap<string, FakeBrowserSessionEntry>): JsonValueT {
  const targets = [PASSWORD, REPAIRED_PASSWORD, SUBMIT, REPAIRED_SUBMIT, AFTER_SUBMIT, REPAIRED_AFTER_SUBMIT];
  return {
    role: 'root',
    name: '',
    children: [{
      role: 'main',
      name: 'Application',
      children: targets
          .filter((target) => entries.get(elementRefKey(target))?.exists)
          .map((target) => ({
            role: 'form',
            name: `${target.name} control`,
            children: [{ role: target.role, name: target.name, children: [] }],
          })),
    }],
  };
}

export function healSnapshot(entries: ReadonlyMap<string, FakeBrowserSessionEntry>): {
  readonly accessibilityTree: JsonValueT;
  readonly screenshot: Uint8Array;
} {
  return {
    accessibilityTree: healAccessibilityTree(entries),
    screenshot: new Uint8Array([1, 2, 3]),
  };
}

export function permissiveContainedWrites(base: StorageAdapter): Pick<StorageAdapter, 'writeText' | 'writeBinary' | 'ensureDir'> {
  return {
    writeText: base.writeText,
    writeBinary: base.writeBinary,
    ensureDir: base.ensureDir,
  };
}

export interface HealScenario {
  readonly deps: HealDeps;
  readonly storage: StorageAdapter;
  readonly textWrites: ReturnType<typeof vi.fn>;
  readonly plan: PlanDocument;
  readonly sessionFactory: ReturnType<typeof vi.fn<() => BrowserSession>>;
}

export async function createScenario(options: {
  readonly steps?: readonly ReturnType<typeof Step.parse>[];
  readonly grounding?: GroundingDocument['entries'];
  readonly sessionEntries?: Map<string, FakeBrowserSessionEntry>;
  readonly storage?: StorageAdapter;
  readonly launchFailure?: boolean;
  readonly prompt?: string;
  readonly aiExecutor?: ReturnType<typeof createFakeAiExecutor>;
  readonly secrets?: ReadonlyMap<string, string>;
  readonly signal?: AbortSignal;
  readonly uiExecutor?: HealDeps['uiExecutor'];
  readonly assertOutcome?: AssertOutcome;
  readonly targets?: PlanDocument['targets'];
} = {}): Promise<HealScenario> {
  const base = options.storage ?? createInMemoryStorage();
  const textWrites = vi.fn<StorageAdapter['writeText']>(base.writeText);
  const storage: StorageAdapter = { ...base, writeText: textWrites };
  const layout = createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR });
  const sessionEntries = options.sessionEntries ?? new Map();
  const sessionFactory = vi.fn<() => BrowserSession>(() => createFakeBrowserSession(sessionEntries, {
    baseUrl: TARGETS.web.baseUrl,
    currentUrl: TARGETS.web.baseUrl,
    snapshot: healSnapshot(sessionEntries),
    ...(options.assertOutcome === undefined ? {} : { assertOutcome: options.assertOutcome }),
  }));
  const plan = PlanDocument.parse({
    schemaVersion: PLAN_SCHEMA_VERSION,
    source: {
      inputsDigest: computeInputsDigest({
        normalizedTestMd: normalizeTestMd(options.prompt ?? PROMPT),
        schemaVersion: PLAN_SCHEMA_VERSION,
        generatorPromptTemplateFingerprint: promptTemplateFingerprint(),
        planProducerBundleFingerprint: planProducerBundleFingerprint(),
        targetDefinitions: options.targets ?? TARGETS,
      }),
    },
    targets: options.targets ?? TARGETS,
    steps: options.steps ?? [Step.parse({ id: 'click-submit', kind: 'action', target: 'web', action: 'click', intent: committedIntent(SUBMIT) })],
  });
  const grounding: GroundingDocument = {
    schemaVersion: GROUNDING_SCHEMA_VERSION,
    planDigest: computePlanDigest(plan),
    entries: options.grounding ?? {
      'click-submit': { ...groundingEntry(SUBMIT, FINGERPRINT) },
    },
  };

  await storage.writeText(OPTIONS.files[0]!, options.prompt ?? PROMPT);
  await storage.writeText(layout.planPathFor(OPTIONS.files[0]!), toCanonicalArtifactText(plan as JsonValueT));
  await storage.writeText(layout.groundingPathFor(OPTIONS.files[0]!), toCanonicalArtifactText(grounding as JsonValueT));
  textWrites.mockClear();

  return {
    storage,
    textWrites,
    plan,
    sessionFactory,
    deps: {
      storage,
      containWrites: () => permissiveContainedWrites(storage),
      layout,
      clock: createFixedClock(new Date('2026-08-25T00:00:00.000Z'), 0),
      runId: '2026-08-25T000000Z-550e8400-e29b-41d4-a716-446655440000',
      uiExecutor: options.uiExecutor ?? vi.fn<HealDeps['uiExecutor']>(() => options.launchFailure
        ? {
          kind: 'playwright', surface: 'web', capabilities: new Set(UI_CAPABILITIES),
          async launch() { throw new Error('Chromium is unavailable for this fixture.'); },
        }
        : createFakeUiExecutor(sessionFactory)),
      secrets: createFakeSecretsProvider(options.secrets ?? new Map()),
      resolveAiExecutor: vi.fn(async () => options.aiExecutor ?? createFakeAiExecutor({
        execute: async () => ({ data: { outcome: 'found', role: 'button', name: 'Submit' }, raw: '{"outcome":"found","role":"button","name":"Submit"}' }),
      })),
      allocateCallId: createCallIdAllocator(),
      events: createRecordingEventSink().sink,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      discoverTestFiles: vi.fn(async () => ['login.test.md']),
      isCI: false,
      configSource: { path: null },
      config: {
        testDir: TEST_DIR,
        testMatch: ['**/*.test.md'],
        testIgnore: ['**/.runs/**'],
        targets: RESOLVED_TARGETS,
        defaultTarget: 'web',
        ai: { provider: 'codex', timeoutMs: 120_000, maxGenerateAttempts: 2 },
        secrets: { allow: '*' },
        ci: { heal: false, updateGroundingCache: false },
        grounding: { repositoryPolicy: 'committed', localWriteBack: 'auto' },
        heal: { caseTimeoutMs: 300_000 },
      },
    },
  };
}
