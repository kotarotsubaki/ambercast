import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { promptTemplateFingerprint } from '#core/ai/prompt-envelope.js';
import { planProducerBundleFingerprint } from '#core/ai/plan-producer-bundle.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { computeInputsDigest, computeIntentDigest, computePlanDigest } from '#core/ir/digest.js';
import { normalizeTestMd } from '#core/ir/normalize.js';
import { GroundingDocument, PlanDocument, type JsonValueT, type TargetDefinition } from '#core/ir/schema.js';
import { ReportEnvelope } from '#report/schema.js';
import { createCodexSentinel } from './support/codex-sentinel.js';
import { resolveChromiumAvailability } from './support/chromium-availability.js';
import { createCleanupRegistry } from './support/cleanup-registry.js';
import { startFixtureApp } from './support/fixture-app.js';
import { spawnSupervisedCli } from './support/supervised-cli.js';

const PROMPT = '# Heal confirmation fixture\n\nClick Submit and see Submitted.\n';
const CONFIRMATION_MESSAGE = 'Healing requires --yes when confirmation cannot be shown.';

let chromiumAvailable = false;



describe('heal confirmation gate through the built CLI', () => {
  beforeAll(async () => {
    if (process.platform === 'win32') {
      return;
    }
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

  it('refuses a non-interactive heal after one real re-grounding dispatch without persisting it', async () => {
    const registry = createCleanupRegistry();
    await registry.run(async () => {
      const app = await startFixtureApp({ registry });
      app.setPage('/', '<!doctype html><html lang="en"><body><main><button>Submit</button><p id="result"></p><script>document.querySelector("button").addEventListener("click", () => { document.querySelector("#result").textContent = "Submitted"; });</script></main></body></html>');

      const project = await mkdtemp(join(tmpdir(), 'ambercast-heal-confirmation-'));
      registry.deferResource(() => rm(project, { recursive: true, force: true }));
      const tests = join(project, 'tests');
      await mkdir(tests);
      const targetDefinitions = {
        fixture: { surface: 'web', baseUrl: app.baseUrl },
      } as const satisfies Record<string, TargetDefinition>;
      const intent = { description: 'Submit button', sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 'Click Submit.'.length + 1 }, roleHint: 'button' };
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
          { id: 'go-to-fixture', kind: 'action', action: 'navigate', target: 'fixture', url: '/' },
          { id: 'click-submit', kind: 'action', action: 'click', target: 'fixture', intent },
          { id: 'confirm-submit', kind: 'assert', check: 'text-visible', target: 'fixture', text: 'Submitted', confirms: ['click-submit'] },
        ],
      });
      const grounding = GroundingDocument.parse({
        schemaVersion: 3,
        planDigest: computePlanDigest(plan),
        entries: {
          'click-submit': { kind: 'element', locator: { strategy: 'accessibility', role: 'button', name: 'Submit' }, fingerprint: { algorithm: 'a11y-neighborhood-v2', hash: '0'.repeat(64) }, intentDigest: computeIntentDigest({ stepKind: 'action', operation: 'click', intent }), provenance: 'ai-proposed' },
        },
      });
      const planPath = join(tests, 'heal-confirmation.ambercast.plan.json');
      const groundingPath = join(tests, 'heal-confirmation.ambercast.grounding.json');
      await Promise.all([
        writeFile(join(project, 'ambercast.config.json'), JSON.stringify({
          $schema: 'https://ambercast.dev/schema/config.json', testDir: 'tests', runsDir: 'tests/.runs',
          targets: { fixture: { ...targetDefinitions.fixture, executor: { kind: 'playwright', browser: 'chromium' }, healReplayIsolation: 'idempotent', resolveTimeoutMs: 5000 } },
          defaultTarget: 'fixture', ai: { provider: 'codex' }, ci: { heal: true },
        })),
        writeFile(join(tests, 'heal-confirmation.test.md'), PROMPT),
        writeFile(planPath, toCanonicalArtifactText(plan as unknown as JsonValueT)),
        writeFile(groundingPath, toCanonicalArtifactText(grounding as unknown as JsonValueT)),
      ]);
      const sentinel = await createCodexSentinel();
      registry.deferResource(() => sentinel.cleanup());
      const beforePlan = await readFile(planPath);
      const beforeGrounding = await readFile(groundingPath);
      const invocation = spawnSupervisedCli(['heal', '--json'], project, {
        ...process.env, PATH: `${sentinel.pathEntry}:${process.env.PATH ?? ''}`, CI: 'true',
      });
      registry.registerSupervisor(invocation);
      const result = await invocation.result;
      await invocation.terminateAndConfirm();
      const [afterPlan, afterGrounding, invocations] = await Promise.all([
        readFile(planPath), readFile(groundingPath), sentinel.invocations(),
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.signalCode).toBeNull();
      expect(invocation.terminated()).toBe(true);
      expect(result.stderr.toString('utf8')).toBe('heal tests/heal-confirmation.test.md [click-submit]: ai call 1/1\n');
      const envelope = JSON.parse(result.stdout.toString('utf8')) as unknown;
      expect(ReportEnvelope.safeParse(envelope).success).toBe(true);
      expect((envelope as { errors: unknown[] }).errors).toHaveLength(1);
      expect(envelope).toMatchObject({
        command: 'heal', errors: [{ scope: 'run', code: 'CONFIG_INVALID', message: CONFIRMATION_MESSAGE }],
      });
      expect(Buffer.compare(beforePlan, afterPlan)).toBe(0);
      expect(Buffer.compare(beforeGrounding, afterGrounding)).toBe(0);
      expect(invocations.filter((argv) => argv[0] === 'exec')).toHaveLength(1);
      expect(invocations.filter((argv) => argv[0] === '--version')).toHaveLength(0);
      expect(app.requestCount('/')).toBeGreaterThanOrEqual(2);
    });
  }, 90_000);
});
