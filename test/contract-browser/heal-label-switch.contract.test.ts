import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { promptTemplateFingerprint } from '#core/ai/prompt-envelope.js';
import { planProducerBundleFingerprint } from '#core/ai/plan-producer-bundle.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { computeInputsDigest, computePlanDigest } from '#core/ir/digest.js';
import { normalizeTestMd } from '#core/ir/normalize.js';
import { GroundingDocument, PlanDocument, type JsonValueT, type TargetDefinition } from '#core/ir/schema.js';
import { ReportEnvelope } from '#report/schema.js';
import { assertDiagnosable, assertZeroAiCalls } from '../support/report-assertions.js';
import { createCodexSentinel } from './support/codex-sentinel.js';
import { resolveChromiumAvailability } from './support/chromium-availability.js';
import { createCleanupRegistry } from './support/cleanup-registry.js';
import { startFixtureApp } from './support/fixture-app.js';
import { CONTRACT_REPEATS } from './support/repeats.js';
import { spawnSupervisedCli } from './support/supervised-cli.js';

const PROMPT = '# Heal label switch\n\nClick the primary action button and see Submitted.\n';

// Import-time validation also covers this long recovery sequence, which does not
// repeat because timing flakiness is exercised by the shorter replay contracts.
void CONTRACT_REPEATS;

// An unquoted intent lets the sentinel propose the label instead of encoding the
// original presentation in the prompt. The confirming assertion makes re-grounding
// eligible while preserving the same intent across the label replacement.
async function writeFixture(project: string, baseUrl: string): Promise<{ planPath: string; groundingPath: string }> {
  const tests = join(project, 'tests');
  await mkdir(tests);
  const targetDefinitions = {
    fixture: { surface: 'web', baseUrl },
  } as const satisfies Record<string, TargetDefinition>;
  const intent = {
    description: 'Primary action button', roleHint: 'button',
    sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 'Click the primary action button and see Submitted.'.length + 1 },
  };
  const plan = PlanDocument.parse({
    schemaVersion: 5,
    source: {
      inputsDigest: computeInputsDigest({
        normalizedTestMd: normalizeTestMd(PROMPT), schemaVersion: 5,
        generatorPromptTemplateFingerprint: promptTemplateFingerprint(),
        planProducerBundleFingerprint: planProducerBundleFingerprint(), targetDefinitions,
      }),
    },
    targets: targetDefinitions,
    steps: [
      { id: 'open', kind: 'action', action: 'navigate', target: 'fixture', url: '/label' },
      { id: 'click-primary', kind: 'action', action: 'click', target: 'fixture', intent },
      { id: 'see-submitted', kind: 'assert', check: 'text-visible', target: 'fixture', text: 'Submitted', confirms: ['click-primary'] },
    ],
  });
  const grounding = GroundingDocument.parse({ schemaVersion: 4, planDigest: computePlanDigest(plan), entries: {} });
  const planPath = join(tests, 'heal-label-switch.ambercast.plan.json');
  const groundingPath = join(tests, 'heal-label-switch.ambercast.grounding.json');
  await Promise.all([
    writeFile(join(project, 'ambercast.config.json'), JSON.stringify({
      $schema: 'https://ambercast.dev/schema/config.json', testDir: 'tests', runsDir: 'tests/.runs',
      targets: { fixture: { ...targetDefinitions.fixture, executor: { kind: 'playwright', browser: 'chromium' }, healReplayIsolation: 'idempotent' } },
      defaultTarget: 'fixture', ai: { provider: 'codex' }, ci: { heal: true },
    })),
    writeFile(join(tests, 'heal-label-switch.test.md'), PROMPT),
    writeFile(planPath, toCanonicalArtifactText(plan as unknown as JsonValueT)),
    writeFile(groundingPath, toCanonicalArtifactText(grounding as unknown as JsonValueT)),
  ]);
  return { planPath, groundingPath };
}

let chromiumAvailable = false;

describe('heal label replacement through the built CLI', () => {
  beforeAll(async () => {
    if (process.platform === 'win32') return;
    chromiumAvailable = await resolveChromiumAvailability(() => chromium.launch());
  });
  beforeEach((context) => {
    if (process.platform === 'win32') {
      context.skip('This POSIX-only contract uses a PATH shebang sentinel and process-group termination.');
    }
    if (!chromiumAvailable) {
      context.skip('Chromium is unavailable for this opt-in contract lane; run `npx playwright install chromium` once.');
    }
  });

  it('TEST-11 previews and applies label healing before replaying the repaired binding without AI', { timeout: 180_000 }, async () => {
    const registry = createCleanupRegistry();
    await registry.run(async () => {
      const app = await startFixtureApp({ registry });
      const project = await mkdtemp(join(tmpdir(), 'ambercast-heal-label-switch-'));
      registry.deferResource(() => rm(project, { recursive: true, force: true }));
      const { planPath, groundingPath } = await writeFixture(project, app.baseUrl);
      const planBeforeRecord = await readFile(planPath);
      const recordSentinel = await createCodexSentinel();
      registry.deferResource(() => recordSentinel.cleanup());

      // Record a real binding before introducing drift, so repair cannot pass by
      // proposing a label without ever validating the original fixture.
      const record = spawnSupervisedCli(['run', '--resolve', '--update-cache', '--json'], project, {
        ...process.env, PATH: `${recordSentinel.pathEntry}:${process.env.PATH ?? ''}`, CI: 'true',
      });
      registry.registerSupervisor(record);
      const recorded = await record.result;
      await record.terminateAndConfirm();
      expect(record.terminated()).toBe(true);
      expect(recorded.signalCode).toBeNull();
      expect(recorded.exitCode).toBe(0);
      const recordedReport = ReportEnvelope.parse(JSON.parse(recorded.stdout.toString('utf8')));
      assertDiagnosable(recordedReport);
      expect(recordedReport).toMatchObject({ command: 'run', results: [{ status: 'passed', aiCalls: 1 }] });
      expect((await recordSentinel.invocations()).filter((argv) => argv[0] === 'exec')).toHaveLength(1);
      const [originalPlan, originalGrounding] = await Promise.all([readFile(planPath), readFile(groundingPath)]);
      expect(Buffer.compare(planBeforeRecord, originalPlan)).toBe(0);
      const originalEntry = GroundingDocument.parse(JSON.parse(originalGrounding.toString('utf8'))).entries['click-primary'];
      expect(originalEntry).toMatchObject({
        kind: 'element', locator: { strategy: 'accessibility', role: 'button', name: 'Submit' }, provenance: 'ai-proposed',
      });
      if (originalEntry?.kind !== 'element') throw new Error('The recorded primary action must have an element binding.');

      // A failed replay establishes that the changed label invalidates the saved
      // binding; failure must leave both committed artifacts intact.
      app.configure({ labelOverrides: { submit: 'Send' } });
      const drift = spawnSupervisedCli(['run', '--json'], project, {
        ...process.env, PATH: `${recordSentinel.pathEntry}:${process.env.PATH ?? ''}`, CI: 'true',
      });
      registry.registerSupervisor(drift);
      const drifted = await drift.result;
      await drift.terminateAndConfirm();
      expect(drift.terminated()).toBe(true);
      expect(drifted.signalCode).toBeNull();
      expect(drifted.exitCode).toBe(4);
      const driftReport = ReportEnvelope.parse(JSON.parse(drifted.stdout.toString('utf8')));
      assertDiagnosable(driftReport);
      assertZeroAiCalls(driftReport);
      expect(driftReport).toMatchObject({
        command: 'run', errors: expect.arrayContaining([expect.objectContaining({ scope: 'case', code: 'GROUNDING_UNRESOLVED' })]),
      });
      expect(Buffer.compare(originalPlan, await readFile(planPath))).toBe(0);
      expect(Buffer.compare(originalGrounding, await readFile(groundingPath))).toBe(0);

      // Preview and apply use independent sentinels to attribute each provider
      // dispatch to its own stage rather than relying on cumulative counts.
      const previewSentinel = await createCodexSentinel({ proposal: { role: 'button', name: 'Send' } });
      registry.deferResource(() => previewSentinel.cleanup());
      const preview = spawnSupervisedCli(['heal', '--dry-run', '--json'], project, {
        ...process.env, PATH: `${previewSentinel.pathEntry}:${process.env.PATH ?? ''}`, CI: 'true',
      });
      registry.registerSupervisor(preview);
      const previewed = await preview.result;
      await preview.terminateAndConfirm();
      expect(preview.terminated()).toBe(true);
      expect(previewed.signalCode).toBeNull();
      expect(previewed.exitCode).toBe(0);
      const previewReport = ReportEnvelope.parse(JSON.parse(previewed.stdout.toString('utf8')));
      assertDiagnosable(previewReport);
      expect(previewReport).toMatchObject({ command: 'heal', results: [{ status: 'completed', repairOutcome: 'healed', application: 'preview-only' }] });
      expect((await previewSentinel.invocations()).filter((argv) => argv[0] === 'exec')).toHaveLength(1);
      expect(Buffer.compare(originalPlan, await readFile(planPath))).toBe(0);
      expect(Buffer.compare(originalGrounding, await readFile(groundingPath))).toBe(0);

      const applySentinel = await createCodexSentinel({ proposal: { role: 'button', name: 'Send' } });
      registry.deferResource(() => applySentinel.cleanup());
      const apply = spawnSupervisedCli(['heal', '--yes', '--json'], project, {
        ...process.env, PATH: `${applySentinel.pathEntry}:${process.env.PATH ?? ''}`, CI: 'true',
      });
      registry.registerSupervisor(apply);
      const applied = await apply.result;
      await apply.terminateAndConfirm();
      expect(apply.terminated()).toBe(true);
      expect(applied.signalCode).toBeNull();
      expect(applied.exitCode).toBe(0);
      const appliedReport = ReportEnvelope.parse(JSON.parse(applied.stdout.toString('utf8')));
      assertDiagnosable(appliedReport);
      // If the AI step recovers on the initial resolve-enabled replay, the repair
      // loop is skipped and no stage1 entry is recorded. Verify recovery through
      // application and the subsequent replay without AI.
      expect(appliedReport).toMatchObject({ command: 'heal', results: [{
        status: 'completed', repairOutcome: 'healed', application: 'applied',
      }] });
      expect(appliedReport).not.toMatchObject({ results: [expect.objectContaining({
        repairTrace: expect.arrayContaining([expect.objectContaining({ stage: 'stage2' })]),
      })] });
      expect(appliedReport).not.toMatchObject({ results: [expect.objectContaining({
        repairTrace: expect.arrayContaining([expect.objectContaining({ stage: 'stage3' })]),
      })] });
      expect((await applySentinel.invocations()).filter((argv) => argv[0] === 'exec')).toHaveLength(1);
      const [repairedPlan, repairedGrounding] = await Promise.all([readFile(planPath), readFile(groundingPath)]);
      expect(Buffer.compare(originalPlan, repairedPlan)).toBe(0);
      const repairedEntry = GroundingDocument.parse(JSON.parse(repairedGrounding.toString('utf8'))).entries['click-primary'];
      expect(repairedEntry).toMatchObject({
        kind: 'element', locator: { strategy: 'accessibility', role: 'button', name: 'Send' }, provenance: 'ai-proposed',
      });
      if (repairedEntry?.kind !== 'element') throw new Error('The repaired primary action must have an element binding.');
      expect(repairedEntry.fingerprint.hash).not.toBe(originalEntry.fingerprint.hash);
      expect(repairedEntry.intentDigest).toBe(originalEntry.intentDigest);

      // Retain the apply sentinel on PATH: an unchanged invocation count proves
      // the repaired cache, rather than another provider call, enables replay.
      const replay = spawnSupervisedCli(['run', '--json'], project, {
        ...process.env, PATH: `${applySentinel.pathEntry}:${process.env.PATH ?? ''}`, CI: 'true',
      });
      registry.registerSupervisor(replay);
      const replayed = await replay.result;
      await replay.terminateAndConfirm();
      expect(replay.terminated()).toBe(true);
      expect(replayed.signalCode).toBeNull();
      expect(replayed.exitCode).toBe(0);
      const replayReport = ReportEnvelope.parse(JSON.parse(replayed.stdout.toString('utf8')));
      assertDiagnosable(replayReport);
      assertZeroAiCalls(replayReport);
      expect(replayReport).toMatchObject({ command: 'run', results: [{
        status: 'passed', steps: expect.arrayContaining([expect.objectContaining({ id: 'click-primary', binding: expect.objectContaining({ provenance: 'grounding' }) })]),
      }] });
      expect((await applySentinel.invocations()).filter((argv) => argv[0] === 'exec')).toHaveLength(1);
      expect(Buffer.compare(repairedPlan, await readFile(planPath))).toBe(0);
      expect(Buffer.compare(repairedGrounding, await readFile(groundingPath))).toBe(0);
    });
  });
});
