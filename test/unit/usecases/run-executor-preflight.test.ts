import { describe, expect, it, vi } from 'vitest';
import { createCallIdAllocator } from '#core/ai/call-id-allocator.js';
import { promptTemplateFingerprint } from '#core/ai/prompt-envelope.js';
import { planProducerBundleFingerprint } from '#core/ai/plan-producer-bundle.js';
import { UI_CAPABILITIES, type UiCapability } from '#core/ir/capabilities.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { computeInputsDigest, computePlanDigest } from '#core/ir/digest.js';
import { normalizeTestMd } from '#core/ir/normalize.js';
import type { JsonValueT, TargetDefinition } from '#core/ir/schema.js';
import { createLayoutResolver } from '#core/layout/resolve.js';
import { run, type RunDeps, type RunOptions } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { createFixedClock } from '../../doubles/create-fixed-clock.js';
import { createInMemoryStorage } from '../../doubles/create-in-memory-storage.js';
import { createRecordingEventSink } from '../../doubles/create-recording-event-sink.js';
import { createFakeBrowserSession, elementRefKey } from '../../doubles/fake-browser-session.js';
import { createFakeSecretsProvider } from '../../doubles/fake-secrets-provider.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';

const ROOT = '/preflight';
const PROMPT = '# Executor preflight\n\nCheck the page.\n';
const REF = { strategy: 'accessibility' as const, role: 'button', name: 'Submit' };
const FINGERPRINT = { algorithm: 'a11y-neighborhood-v2' as const, hash: 'a'.repeat(64) };
const EXECUTOR = { kind: 'playwright' as const, browser: 'chromium' as const };
const SECRET_REF = '{{secrets.TOKEN}}';
const definitions = {
  A: { surface: 'web', baseUrl: 'https://a.example.test' },
  B: { surface: 'web', baseUrl: 'https://b.example.test' },
} as const;
type Step = Record<string, unknown> & { id: string; target: 'A' | 'B' };

function click(id: string, target: Step['target']): Step {
  return { id, target, kind: 'action', action: 'click', element: REF };
}

function secretFill(id: string, target: Step['target']): Step {
  return { id, target, kind: 'action', action: 'fill-secret', element: REF, secretRef: SECRET_REF };
}

function navigate(id: string, target: Step['target']): Step {
  return { id, target, kind: 'action', action: 'navigate', url: '/next' };
}

function session(target: 'A' | 'B') {
  return createFakeBrowserSession(new Map([[elementRefKey(REF), { exists: true, currentFingerprint: FINGERPRINT }]]), {
    baseUrl: definitions[target].baseUrl, currentUrl: definitions[target].baseUrl,
  });
}

const options: RunOptions = { files: [], resolve: false, updateCache: false, allowEmpty: false, list: false, stale: 'fail' };

async function scenario(cases: readonly {
  file: string;
  steps: readonly Step[];
  groundingEntries?: Record<string, unknown>;
}[], settings: {
  capabilities?: ReadonlySet<UiCapability>;
  executorForTarget?: Partial<Record<'A' | 'B', ReturnType<typeof createFakeUiExecutor>>>;
  configExecutor?: typeof EXECUTOR | undefined;
  allowSecrets?: '*' | readonly string[];
  resolve?: boolean;
} = {}) {
  const storage = createInMemoryStorage();
  const writeText = vi.spyOn(storage, 'writeText');
  const writeBinary = vi.spyOn(storage, 'writeBinary');
  const updateTextExclusive = vi.spyOn(storage, 'updateTextExclusive');
  const layout = createLayoutResolver({ testDir: ROOT, runsDir: `${ROOT}/.runs` });
  const events = createRecordingEventSink();
  const activeSessions = { A: session('A'), B: session('B') };
  const made = {
    A: createFakeUiExecutor(() => activeSessions.A, {}, settings.capabilities),
    B: createFakeUiExecutor(() => activeSessions.B, {}, settings.capabilities),
  };
  const executors = { ...made, ...settings.executorForTarget };
  let resolutionIndex = 0;
  const uiExecutor = vi.fn<RunDeps['uiExecutor']>((config) => {
    // Both targets intentionally use the same config value. The call order is
    // checked below, while distinct instances expose a second pool resolution.
    expect(config).toEqual(EXECUTOR);
    return executors[resolutionIndex++ % 2 === 0 ? 'A' : 'B'];
  });
  const aiResolver = vi.fn<RunDeps['resolveAiExecutor']>(async () => { throw new Error('AI must not run'); });
  for (const item of cases) {
    const targetNames = [...new Set(item.steps.map((step) => step.target))].sort();
    const targets = Object.fromEntries(targetNames.map((name) => [name, {
      ...definitions[name],
      secretSinkOrigins: { [SECRET_REF]: [definitions[name].baseUrl] },
    }])) as Record<string, TargetDefinition>;
    const inputsDigest = computeInputsDigest({
      normalizedTestMd: normalizeTestMd(PROMPT), schemaVersion: 4,
      generatorPromptTemplateFingerprint: promptTemplateFingerprint(),
      planProducerBundleFingerprint: planProducerBundleFingerprint(), targetDefinitions: targets,
    });
    const plan = { schemaVersion: 4, source: { inputsDigest }, targets, steps: item.steps };
    const elementEntries = Object.fromEntries(item.steps.filter((step) => step.element !== undefined).map((step) => [step.id, { kind: 'element', fingerprint: FINGERPRINT }]));
    const grounding = { schemaVersion: 2, planDigest: computePlanDigest(plan as never), entries: { ...elementEntries, ...item.groundingEntries } };
    await storage.writeText(item.file, PROMPT);
    await storage.writeText(layout.planPathFor(item.file), toCanonicalArtifactText(plan as unknown as JsonValueT));
    await storage.writeText(layout.groundingPathFor(item.file), toCanonicalArtifactText(grounding as JsonValueT));
  }
  writeText.mockClear();
  writeBinary.mockClear();
  updateTextExclusive.mockClear();
  const configTargets = Object.fromEntries(Object.entries(definitions).map(([name, target]) => [name, {
    ...target, executor: settings.configExecutor ?? EXECUTOR,
    secretSinkOrigins: { [SECRET_REF]: [target.baseUrl] },
    resolveTimeoutMs: 5000, healReplayIsolation: 'stateful',
  }])) as RunDeps['config']['targets'];
  const deps: RunDeps = {
    storage, layout, clock: createFixedClock(new Date('2026-09-24T00:00:00Z'), 0),
    allocateCallId: createCallIdAllocator(),
    runId: '2026-09-24T000000Z-550e8400-e29b-41d4-a716-446655440000',
    uiExecutor, secrets: createFakeSecretsProvider(new Map([[SECRET_REF, 'secret-value']])),
    resolveAiExecutor: aiResolver, events: events.sink,
    discoverTestFiles: async () => cases.map((item) => item.file), isCI: false,
    config: {
      testDir: ROOT, testMatch: ['**/*.test.md'], testIgnore: [], targets: configTargets, defaultTarget: 'A',
      ai: { provider: 'codex', timeoutMs: 120_000, maxGenerateAttempts: 2 },
      ci: { heal: false, updateGroundingCache: false },
      grounding: { repositoryPolicy: 'committed', localWriteBack: 'auto' },
      secrets: { allow: settings.allowSecrets ?? '*' },
    },
  };
  const outcome = await run(deps, { ...options, files: cases.map((item) => item.file), resolve: settings.resolve ?? false });
  const report = buildRunReport({ outcome, startedAt: '2026-09-24T00:00:00.000Z', durationMs: 0, options });
  return { outcome, report, executors, activeSessions, uiExecutor, aiResolver, events, writeText, writeBinary, updateTextExclusive };
}

describe('run executor preflight', () => {
  it('TEST-8 rejects B before A starts and leaves all case side effects absent', async () => {
    const capabilities = new Set(UI_CAPABILITIES.filter((name) => name !== 'fill-secret'));
    const result = await scenario([{ file: `${ROOT}/first.test.md`, steps: [click('a-click', 'A'), secretFill('b-secret', 'B')] }], { capabilities });
    expect(result.report.exitCode).toBe(2);
    expect(result.outcome.results[0]?.result).toMatchObject({ status: 'error', steps: [] });
    expect(result.report.envelope.results[0]).toMatchObject({ status: 'error' });
    expect(result.report.envelope.errors).toEqual([expect.objectContaining({
      code: 'EXECUTOR_UNSUPPORTED', scope: 'case', kind: 'usage',
      details: { target: 'B', executor: 'playwright', reason: 'capability-missing', missing: ['fill-secret'] },
    })]);
    expect(result.uiExecutor).toHaveBeenCalledTimes(2);
    expect(result.uiExecutor).toHaveBeenNthCalledWith(1, EXECUTOR);
    expect(result.uiExecutor).toHaveBeenNthCalledWith(2, EXECUTOR);
    expect(result.executors.A.launches).toEqual([]);
    expect(result.executors.B.launches).toEqual([]);
    expect(result.activeSessions.A.operations()).toEqual([]);
    expect(result.events.emitted().filter((event) => event.type === 'ai-call')).toEqual([]);
    expect(result.aiResolver).not.toHaveBeenCalled();
    expect(result.writeText).not.toHaveBeenCalled();
    expect(result.writeBinary).not.toHaveBeenCalled();
    expect(result.updateTextExclusive).not.toHaveBeenCalled();
    expect(result.outcome.results[0]?.result.sessions).toEqual({
      A: { surface: 'web', executor: EXECUTOR, state: 'not-opened' },
      B: { surface: 'web', executor: EXECUTOR, state: 'not-opened' },
    });
  });

  it('TEST-8 continues the next case and keeps the batch exit at 2', async () => {
    const capabilities = new Set(UI_CAPABILITIES.filter((name) => name !== 'click'));
    const result = await scenario([
      { file: `${ROOT}/first.test.md`, steps: [click('a-click', 'A')] },
      { file: `${ROOT}/second.test.md`, steps: [navigate('a-nav', 'A')] },
    ], { capabilities });
    expect(result.outcome.results.map(({ result }) => result.status)).toEqual(['error', 'passed']);
    expect(result.report.exitCode).toBe(2);
  });

  it('TEST-9 reports a surface mismatch before a simultaneous click gap', async () => {
    const mobile = { ...createFakeUiExecutor(() => session('A'), {}, new Set(UI_CAPABILITIES.filter((name) => name !== 'click'))), surface: 'mobile' } as unknown as ReturnType<typeof createFakeUiExecutor>;
    const result = await scenario([{ file: `${ROOT}/mobile.test.md`, steps: [click('a-click', 'A')] }], { executorForTarget: { A: mobile } });
    expect(result.report.exitCode).toBe(2);
    expect(result.report.envelope.errors).toEqual([expect.objectContaining({
      code: 'EXECUTOR_UNSUPPORTED', details: {
        target: 'A', executor: 'playwright', reason: 'surface-mismatch', missing: [],
        surface: { target: 'web', executor: 'mobile' },
      },
    })]);
    expect(mobile.launches).toEqual([]);
  });

  it.each([
    [false, ['press']],
    [true, ['press', 'agentic']],
  ] as const)('TEST-10 derives trace press and resolve=%s agentic in capability order', async (resolve, missing) => {
    const capabilities = new Set(UI_CAPABILITIES.filter((name) => name !== 'press' && name !== 'agentic'));
    const result = await scenario([{ file: `${ROOT}/trace.test.md`, steps: [{
      id: 'a-ai', target: 'A', kind: 'ai', instruction: 'Press Enter.',
      instructionCoverage: [{ id: 'pressed', kind: 'success', sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 16 } }],
    }], groundingEntries: { 'a-ai': { kind: 'ai', trace: {
      events: [{ type: 'press', element: REF, key: 'Enter' }],
      verification: [{ type: 'assert', check: 'text-visible', text: 'Ready' }],
      verificationCoverage: { pressed: 0 },
    } } } }], { capabilities, resolve });
    expect(result.report.envelope.errors).toEqual([expect.objectContaining({
      code: 'EXECUTOR_UNSUPPORTED', details: { target: 'A', executor: 'playwright', reason: 'capability-missing', missing },
    })]);
    expect(result.report.exitCode).toBe(2);
    expect(result.executors.A.launches).toEqual([]);
    expect(result.aiResolver).not.toHaveBeenCalled();
    expect(result.writeText).not.toHaveBeenCalled();
  });

  it('TEST-11 selects the first unsupported target by name, regardless of step order', async () => {
    const capabilities = new Set(UI_CAPABILITIES.filter((name) => name !== 'click'));
    const result = await scenario([{ file: `${ROOT}/ordered.test.md`, steps: [click('b-click', 'B'), click('a-click', 'A')] }], { capabilities });
    expect(result.report.envelope.errors).toEqual([expect.objectContaining({
      code: 'EXECUTOR_UNSUPPORTED', details: { target: 'A', executor: 'playwright', reason: 'capability-missing', missing: ['click'] },
    })]);
    expect(result.executors.A.launches).toEqual([]);
    expect(result.executors.B.launches).toEqual([]);
  });

  it('TEST-11 uses the preflight-resolved executor for the first step and does not resolve twice', async () => {
    const result = await scenario([{ file: `${ROOT}/supported.test.md`, steps: [click('a-click', 'A'), click('b-click', 'B')] }]);
    expect(result.outcome.results[0]?.result).toMatchObject({ status: 'passed', steps: [
      expect.objectContaining({ id: 'a-click', status: 'passed' }),
      expect.objectContaining({ id: 'b-click', status: 'passed' }),
    ] });
    expect(result.uiExecutor).toHaveBeenCalledTimes(2);
    expect(result.executors.A.launches).toHaveLength(1);
    expect(result.executors.B.launches).toHaveLength(1);
    // The existing run-multi-target suite checks the broader routing contract.
  });

  it('TEST-11 keeps secret validation ahead of executor capability checking', async () => {
    const capabilities = new Set(UI_CAPABILITIES.filter((name) => name !== 'fill-secret'));
    const result = await scenario([{ file: `${ROOT}/secret-policy.test.md`, steps: [secretFill('a-secret', 'A')] }], { capabilities, allowSecrets: [] });
    expect(result.outcome.results[0]?.error?.kind).not.toBe('executor-unsupported');
    expect(result.report.envelope.errors[0]?.code).toBe('SECRET_CONSENT_REQUIRED');
    expect(result.uiExecutor).not.toHaveBeenCalled();
    expect(result.executors.A.launches).toEqual([]);
  });

  it.each([undefined, EXECUTOR])('TEST-14 reports the resolved executor with config value %s', async (configExecutor) => {
    const result = await scenario([{ file: `${ROOT}/report.test.md`, steps: [click('a-click', 'A')] }], { configExecutor });
    expect(result.outcome.results[0]?.result.status).toBe('passed');
    expect(result.report.envelope.results[0]).toMatchObject({ sessions: { A: { executor: EXECUTOR } } });
  });
});
