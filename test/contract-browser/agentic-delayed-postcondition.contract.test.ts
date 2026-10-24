import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { DEFAULT_RAW_CONFIG } from '#config/defaults.js';
import { promptTemplateFingerprint } from '#core/ai/prompt-envelope.js';
import { planProducerBundleFingerprint } from '#core/ai/plan-producer-bundle.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { computeInputsDigest, computePlanDigest } from '#core/ir/digest.js';
import { normalizeTestMd } from '#core/ir/normalize.js';
import { GroundingDocument, PlanDocument, type JsonValueT, type TargetDefinition } from '#core/ir/schema.js';
import { assertDiagnosable, assertZeroAiCalls } from '../support/report-assertions.js';
import { createAgenticClaudeSentinel } from './support/agentic-claude-sentinel.js';
import { resolveChromiumAvailability } from './support/chromium-availability.js';
import { createCleanupRegistry } from './support/cleanup-registry.js';
import { startFixtureApp, DELAY_UPPER_SLACK_MS } from './support/fixture-app.js';
import { CONTRACT_REPEATS } from './support/repeats.js';
import { spawnSupervisedCli } from './support/supervised-cli.js';

const DELAY_MS = 1500;
const REQUIREMENT = 'Complete first verification.';
const PROMPT = `# Agentic delayed fixture\n\n${REQUIREMENT}\n`;
let chromiumAvailable = false;

// The postcondition must appear inside the default product deadline. Four jitter
// allowances cover snapshots, polling, navigation completion and painting under
// parallel CI load; collection fails before an unavailable browser can hide this.
if (!(DELAY_MS >= 1000
  && DELAY_MS + 4 * DELAY_UPPER_SLACK_MS < DEFAULT_RAW_CONFIG.targets['web-user'].resolveTimeoutMs)) {
  throw new RangeError('Timing constants must keep fixture delays inside resolveTimeoutMs.');
}

// Both pages use the same single AI step and empty grounding. Canonical artifacts
// and current digests keep freshness from becoming a competing failure. Omitting
// resolveTimeoutMs exercises the product default rather than a test-only deadline.
async function writeFixture(project: string, baseUrl: string): Promise<string> {
  const tests = join(project, 'tests');
  await mkdir(tests);
  const targets = { fixture: { surface: 'web', baseUrl } } as const satisfies Record<string, TargetDefinition>;
  const plan = PlanDocument.parse({
    schemaVersion: 5,
    source: {
      inputsDigest: computeInputsDigest({
        normalizedTestMd: normalizeTestMd(PROMPT), schemaVersion: 5,
        generatorPromptTemplateFingerprint: promptTemplateFingerprint(),
        planProducerBundleFingerprint: planProducerBundleFingerprint(), targetDefinitions: targets,
      }),
    },
    targets,
    steps: [{
      id: 'first-complete', kind: 'ai', target: 'fixture', instruction: 'Verify the fixture.',
      instructionCoverage: [{
        id: 'first-complete', kind: 'success',
        sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: REQUIREMENT.length + 1 },
      }],
    }],
  });
  const grounding = GroundingDocument.parse({ schemaVersion: 4, planDigest: computePlanDigest(plan), entries: {} });
  const groundingPath = join(tests, 'agentic-delayed.ambercast.grounding.json');
  await Promise.all([
    writeFile(join(project, 'ambercast.config.json'), JSON.stringify({
      $schema: 'https://ambercast.dev/schema/config.json', testDir: 'tests', runsDir: 'tests/.runs',
      targets: { fixture: { ...targets.fixture, executor: { kind: 'playwright', browser: 'chromium' } } },
      defaultTarget: 'fixture', ai: { provider: 'claude' }, ci: { heal: false },
    })),
    writeFile(join(tests, 'agentic-delayed.test.md'), PROMPT),
    writeFile(join(tests, 'agentic-delayed.ambercast.plan.json'), toCanonicalArtifactText(plan as unknown as JsonValueT)),
    writeFile(groundingPath, toCanonicalArtifactText(grounding as unknown as JsonValueT)),
  ]);
  return groundingPath;
}

// Only fulfillment differs between the pages, so accepted grounding cannot be
// attributed to a different plan or provider mode.
function agenticPage(fulfillsPostcondition: boolean): string {
  return `<!doctype html><html lang="en"><body>
<main><h1>Agentic delay page</h1><p id="status"></p></main>
${fulfillsPostcondition ? `<script>setTimeout(() => {
  document.getElementById('status').textContent = 'Agentic fixture ready';
}, ${String(DELAY_MS)});</script>` : ''}
</body></html>`;
}

describe('agentic delayed postconditions through the built CLI', () => {
  beforeAll(async () => {
    if (process.platform === 'win32') return;
    chromiumAvailable = await resolveChromiumAvailability(() => chromium.launch());
  });

  beforeEach((context) => {
    if (process.platform === 'win32') context.skip('This POSIX-only contract uses a PATH sentinel and process-group termination.');
    if (!chromiumAvailable) context.skip('Chromium is unavailable for this opt-in contract lane; run `npx playwright install chromium` once.');
  });

  it('TEST-9 accepts a delayed agentic postcondition and replays its trace without AI', { repeats: CONTRACT_REPEATS, timeout: 90_000 }, async () => {
    // Every repeat owns fresh app, storage and provider state. The exhausted
    // sentinel also makes any accidental provider call during replay observable.
    const registry = createCleanupRegistry();
    await registry.run(async () => {
      const app = await startFixtureApp({ registry });
      app.setPage('/', agenticPage(true));
      const project = await mkdtemp(join(tmpdir(), 'ambercast-agentic-delayed-'));
      registry.deferResource(() => rm(project, { recursive: true, force: true }));
      const groundingPath = await writeFixture(project, app.baseUrl);
      const sentinel = await createAgenticClaudeSentinel(['success']);
      registry.deferResource(() => sentinel.cleanup());
      const env = { ...process.env, PATH: `${sentinel.pathEntry}:${process.env.PATH ?? ''}`, CI: 'true' };
      const recording = spawnSupervisedCli(['run', '--resolve', '--update-cache', '--ai', 'claude', '--json'], project, env);
      registry.registerSupervisor(recording);
      const recorded = await recording.result;
      await recording.terminateAndConfirm();
      expect(recording.terminated()).toBe(true);
      expect(recorded.signalCode).toBeNull();
      expect(recorded.exitCode).toBe(0);
      const recordedReport = JSON.parse(recorded.stdout.toString('utf8'));
      assertDiagnosable(recordedReport);
      expect(recordedReport.results[0]).toMatchObject({ status: 'passed', aiCalls: 1 });
      expect(recordedReport.results[0].steps).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'environment' })]));
      expect((await sentinel.invocations()).filter(argv => argv[0] === '-p')).toHaveLength(1);
      const grounding = GroundingDocument.parse(JSON.parse(await readFile(groundingPath, 'utf8')));
      expect(Object.keys(grounding.entries)).toEqual(['first-complete']);
      expect(grounding.entries['first-complete']?.kind).toBe('ai');

      // The same delayed page must now be verified by polling the stored trace,
      // without letting the provider's success response stand in for evidence.
      const replay = spawnSupervisedCli(['run', '--json'], project, env);
      registry.registerSupervisor(replay);
      const replayed = await replay.result;
      await replay.terminateAndConfirm();
      expect(replay.terminated()).toBe(true);
      expect(replayed.signalCode).toBeNull();
      expect(replayed.exitCode).toBe(0);
      const replayedReport = JSON.parse(replayed.stdout.toString('utf8'));
      expect(replayedReport.results[0].status).toBe('passed');
      assertDiagnosable(replayedReport);
      assertZeroAiCalls(replayedReport);
      expect((await sentinel.invocations()).filter(argv => argv[0] === '-p')).toHaveLength(1);
    });
  });

  it('TEST-10 omits accepted grounding when the agentic postcondition never appears', { timeout: 90_000 }, async () => {
    const registry = createCleanupRegistry();
    await registry.run(async () => {
      const app = await startFixtureApp({ registry });
      app.setPage('/', agenticPage(false));
      const project = await mkdtemp(join(tmpdir(), 'ambercast-agentic-unfulfilled-'));
      registry.deferResource(() => rm(project, { recursive: true, force: true }));
      const groundingPath = await writeFixture(project, app.baseUrl);
      const sentinel = await createAgenticClaudeSentinel(['success']);
      registry.deferResource(() => sentinel.cleanup());
      const invocation = spawnSupervisedCli(['run', '--resolve', '--update-cache', '--ai', 'claude', '--json'], project, {
        ...process.env, PATH: `${sentinel.pathEntry}:${process.env.PATH ?? ''}`, CI: 'true',
      });
      registry.registerSupervisor(invocation);
      const result = await invocation.result;
      await invocation.terminateAndConfirm();
      expect(invocation.terminated()).toBe(true);
      expect(result.signalCode).toBeNull();

      // Classification is deliberately observed rather than fixed here. The
      // control proves only that an unfulfilled assertion cannot seed grounding.
      const report = JSON.parse(result.stdout.toString('utf8'));
      console.info('Agentic unfulfilled postcondition observation', {
        exitCode: result.exitCode, status: report.results[0]?.status, errors: report.errors,
      });
      const persistedText = await readFile(groundingPath, 'utf8').catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (persistedText !== undefined) {
        const grounding = GroundingDocument.parse(JSON.parse(persistedText));
        expect(grounding.entries['first-complete']).toBeUndefined();
      }
    });
  });
});
