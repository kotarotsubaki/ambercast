import { describe, expect, it, vi } from 'vitest';
import { createCallIdAllocator } from '../../../src/core/ai/call-id-allocator.js';
import { deriveCurrentPlanInputProvenance } from '../../../src/core/ai/plan-input-provenance.js';
import { toCanonicalArtifactText } from '../../../src/core/ir/canonical-json.js';
import { computePlanDigest } from '../../../src/core/ir/digest.js';
import { normalizeTestMd } from '../../../src/core/ir/normalize.js';
import type { PlanDocument } from '../../../src/core/ir/schema.js';
import { createLayoutResolver } from '../../../src/core/layout/resolve.js';
import { check } from '../../../src/usecases/check.js';
import { heal } from '../../../src/usecases/heal.js';
import { run } from '../../../src/usecases/run.js';
import { createFixedClock } from '../../doubles/create-fixed-clock.js';
import { createInMemoryStorage } from '../../doubles/create-in-memory-storage.js';
import { createRecordingEventSink } from '../../doubles/create-recording-event-sink.js';
import { createFakeBrowserDriver } from '../../doubles/fake-browser-driver.js';
import { createFakeBrowserSession } from '../../doubles/fake-browser-session.js';
import { createFakeSecretsProvider } from '../../doubles/fake-secrets-provider.js';
import { toTargetDefinition } from '../../../src/core/target/resolve.js';

const file = '/workspace/tests/unresolved.test.md';
const plan = {
  schemaVersion: 4,
  source: { inputsDigest: 'a'.repeat(64) },
  targets: { missing: { surface: 'web', baseUrl: 'https://missing.example.test' } },
  steps: [{ id: 'visit-missing', kind: 'action', action: 'navigate', target: 'missing', url: 'https://missing.example.test' }],
};

async function scenario() {
  const storage = createInMemoryStorage();
  const layout = createLayoutResolver({ testDir: '/workspace/tests', runsDir: '/workspace/tests/.runs' });
  await storage.writeText(file, '# Visit missing\n');
  await storage.writeText(layout.planPathFor(file), toCanonicalArtifactText(plan));
  const launch = vi.fn(() => createFakeBrowserSession(new Map()));
  const driver = createFakeBrowserDriver(launch);
  const deps = {
    storage,
    layout,
    clock: createFixedClock(new Date('2026-09-23T00:00:00Z'), 0),
    allocateCallId: createCallIdAllocator(),
    runId: '2026-09-23T000000Z-550e8400-e29b-41d4-a716-446655440000',
    browserDriver: () => driver,
    secrets: createFakeSecretsProvider(new Map()),
    resolveAiExecutor: async () => { throw new Error('AI must not start'); },
    events: createRecordingEventSink().sink,
    discoverTestFiles: async () => [],
    isCI: false,
    config: {
      testDir: '/workspace/tests',
      testMatch: ['**/*.test.md'],
      testIgnore: ['**/.runs/**'],
      targets: { app: { baseUrl: 'https://app.example.test', browser: 'chromium' as const, healReplayIsolation: 'idempotent' as const, resolveTimeoutMs: 5000 } },
      defaultTarget: 'app',
      ai: { provider: 'codex' as const, timeoutMs: 1000, maxGenerateAttempts: 1 },
      ci: { heal: false, updateGroundingCache: false },
      grounding: { repositoryPolicy: 'committed' as const, localWriteBack: 'auto' as const },
      heal: { caseTimeoutMs: 300000, maxStepRepairs: 1, maxAttempts: 1 },
    },
  };
  return { deps, launch };
}

describe('unconfigured Plan Target preflight', () => {
  it('run reports TARGET_UNRESOLVED exit 2 before launching a session', async () => {
    const { deps, launch } = await scenario();
    const result = await run(deps, { files: [file], resolve: false, updateCache: false, allowEmpty: false, list: false, stale: 'fail' });
    expect(result.results[0]?.error).toMatchObject({ kind: 'target-unresolved', exitCode: 2, message: 'The plan references a target that is not configured.', details: { target: 'missing' } });
    expect(launch).not.toHaveBeenCalled();
  });

  it('heal reports TARGET_UNRESOLVED exit 2 before launching a session', async () => {
    const { deps, launch } = await scenario();
    const result = await heal({ ...deps, containWrites: () => deps.storage }, { files: [file], dryRun: true, yes: false, list: false });
    expect(result.outcome.errors[0]?.error).toMatchObject({ kind: 'target-unresolved', exitCode: 2, message: 'The plan references a target that is not configured.', details: { target: 'missing' } });
    expect(launch).not.toHaveBeenCalled();
  });

  it('check reports the configured Target reason as stale', async () => {
    const { deps } = await scenario();
    const result = await check({ storage: deps.storage, layout: deps.layout, discoverTestFiles: deps.discoverTestFiles, config: deps.config }, { files: [file], allowEmpty: false, list: false });
    expect(result.results).toContainEqual(expect.objectContaining({ id: file, status: 'stale', reason: 'The plan references a target that is not configured: missing' }));
  });
});

describe('retired Plan v3 preflight', () => {
  it('check reports the Plan schema reason before Target resolution', async () => {
    const { deps } = await scenario();
    await deps.storage.writeText(deps.layout.planPathFor(file), toCanonicalArtifactText({
      schemaVersion: 3,
      source: { inputsDigest: 'a'.repeat(64) },
      targets: { app: { baseUrl: 'https://app.example.test', browser: 'chromium' } },
      steps: [{ id: 'visit-app', kind: 'action', action: 'navigate', url: 'https://app.example.test' }],
    }));
    const result = await check({ storage: deps.storage, layout: deps.layout, discoverTestFiles: deps.discoverTestFiles, config: deps.config }, { files: [file], allowEmpty: false, list: false });
    expect(result.results).toContainEqual(expect.objectContaining({ id: file, status: 'stale', reason: 'The plan does not match the plan schema.' }));
  });

  it('run and heal classify Plan v3 as stale-ir exit 4 before browser launch', async () => {
    const { deps, launch } = await scenario();
    await deps.storage.writeText(deps.layout.planPathFor(file), toCanonicalArtifactText({
      schemaVersion: 3,
      source: { inputsDigest: 'a'.repeat(64) },
      targets: { app: { baseUrl: 'https://app.example.test', browser: 'chromium' } },
      steps: [{ id: 'visit-app', kind: 'action', action: 'navigate', url: 'https://app.example.test' }],
    }));
    const runResult = await run(deps, { files: [file], resolve: false, updateCache: false, allowEmpty: false, list: false, stale: 'fail' });
    expect(runResult.results[0]?.error).toMatchObject({ kind: 'stale-ir', exitCode: 4 });
    const healResult = await heal({ ...deps, containWrites: () => deps.storage }, { files: [file], dryRun: true, yes: false, list: false });
    expect(healResult.outcome.errors[0]?.error).toMatchObject({ kind: 'stale-ir', exitCode: 4 });
    expect(launch).not.toHaveBeenCalled();
  });
});

describe('current Plan and grounding freshness', () => {
  it('check accepts a v4 Plan with a current v2 grounding cache', async () => {
    const { deps } = await scenario();
    const current = {
      ...plan,
      targets: { app: { surface: 'web', baseUrl: 'https://app.example.test' } },
      steps: [{ id: 'visit-app', kind: 'action', action: 'navigate', target: 'app', url: 'https://app.example.test' }],
      source: { inputsDigest: deriveCurrentPlanInputProvenance({
        normalizedTestMd: normalizeTestMd('# Visit missing\n'),
        targetDefinitions: { app: toTargetDefinition(deps.config.targets.app) },
      }).inputsDigest },
    };
    await deps.storage.writeText(deps.layout.planPathFor(file), toCanonicalArtifactText(current));
    await deps.storage.writeText(deps.layout.groundingPathFor(file), toCanonicalArtifactText({ schemaVersion: 2, planDigest: computePlanDigest(current as unknown as PlanDocument), entries: {} }));
    const result = await check({ storage: deps.storage, layout: deps.layout, discoverTestFiles: deps.discoverTestFiles, config: deps.config }, { files: [file], allowEmpty: false, list: false });
    expect(result.results).toContainEqual(expect.objectContaining({ id: file, status: 'fresh' }));
  });

  it('treats a v1 grounding cache as unresolved when replay cannot use AI resolution', async () => {
    const { deps } = await scenario();
    const current = {
      schemaVersion: 4,
      source: { inputsDigest: deriveCurrentPlanInputProvenance({
        normalizedTestMd: normalizeTestMd('# Visit missing\n'),
        targetDefinitions: { app: toTargetDefinition(deps.config.targets.app) },
      }).inputsDigest },
      targets: { app: { surface: 'web', baseUrl: 'https://app.example.test' } },
      steps: [{ id: 'click-app', kind: 'action', action: 'click', target: 'app', element: { strategy: 'accessibility', role: 'button', name: 'Continue' } }],
    };
    await deps.storage.writeText(deps.layout.planPathFor(file), toCanonicalArtifactText(current));
    await deps.storage.writeText(deps.layout.groundingPathFor(file), toCanonicalArtifactText({ schemaVersion: 1, planDigest: computePlanDigest(current as unknown as PlanDocument), entries: {} }));
    const result = await run(deps, { files: [file], resolve: false, updateCache: false, allowEmpty: false, list: false, stale: 'fail' });
    expect(result.results[0]?.error).toMatchObject({ kind: 'grounding-unresolved' });
  });
});
