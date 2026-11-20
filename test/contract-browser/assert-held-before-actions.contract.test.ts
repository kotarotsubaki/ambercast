// Real browser observations distinguish assertions that already hold from effects produced by an action.
import { chromium } from 'playwright-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPlaywrightUiExecutor } from '#adapters/browser/chromium.js';
import { run } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { assertDiagnosable, assertNoSecretDisclosure, assertZeroAiCalls, collectStorageArtifacts } from '../support/report-assertions.js';
import { createFreshPlan, createScenario, DEFAULT_OPTIONS, RESOLVED_TARGETS, RUNS_DIR, writePrompt } from '../support/run-scenario.js';
import { resolveChromiumAvailability } from './support/chromium-availability.js';
import { startFixtureApp } from './support/fixture-app.js';

let chromiumAvailable = false;

describe('assertion warnings against real Chromium', () => {
  beforeAll(async () => {
    chromiumAvailable = await resolveChromiumAvailability(() => chromium.launch());
  });
  beforeEach(context => {
    if (!chromiumAvailable) context.skip('Chromium is unavailable locally; CI requires the browser contract.');
  });

  it.each([
    { name: 'already visible heading', text: 'Always visible', warnings: [{ kind: 'assert-held-before-actions', stepId: 'verify-effect' }] },
    { name: 'newly revealed element', text: 'Action completed', warnings: [] },
  ])('TEST-WARN-9 distinguishes $name', async scenario => {
    const app = await startFixtureApp();
    try {
      app.setPage('/assert-warning', `<!doctype html><html lang="en"><body>
<h1>Always visible</h1><button id="reveal">Reveal</button><p id="result"></p>
<script>document.querySelector('#reveal').addEventListener('click', () => {
  document.querySelector('#result').textContent = 'Action completed';
});</script></body></html>`);
      const { deps } = createScenario({ uiExecutor: () => createPlaywrightUiExecutor({ kind: 'playwright', browser: 'chromium' }) });
      const targets = { web: { ...RESOLVED_TARGETS.web, baseUrl: app.baseUrl, resolveTimeoutMs: 0 } };
      const browserDeps = { ...deps, config: { ...deps.config, targets } };
      const body = 'Click "Reveal" and verify the result.';
      const testPath = await writePrompt(deps.storage, 'login.test.md', `# Reveal\n\n${body}\n`);
      const sourceSpan = { startLine: 3, startColumn: 8, endLine: 3, endColumn: 14 };
      await createFreshPlan(deps.storage, testPath, [
        { id: 'open', kind: 'action', action: 'navigate', url: '/assert-warning' },
        { id: 'loaded', kind: 'assert', check: 'text-visible', text: 'Always visible' },
        { id: 'reveal', kind: 'action', action: 'click', intent: {
          description: 'Reveal button', roleHint: 'button', sourceSpan,
          quote: { text: 'Reveal', sourceSpan },
        } },
        { id: 'verify-effect', kind: 'assert', check: 'text-visible', text: scenario.text },
      ], targets);

      const outcome = await run(browserDeps, { ...DEFAULT_OPTIONS, updateCache: true });
      const report = buildRunReport({ startedAt: '2026-11-20T00:00:00Z', durationMs: 0, options: { allowEmpty: false, list: false }, outcome });
      assertDiagnosable(report.envelope);
      assertZeroAiCalls(report.envelope);
      // The command boundary normally persists the report, even on success.
      await deps.storage.writeText(`${RUNS_DIR}/report.json`, JSON.stringify(report.envelope));
      assertNoSecretDisclosure({ secrets: { sentinel: 'never-disclose-this-warning-contract-secret' }, report: report.envelope,
        artifacts: await collectStorageArtifacts(deps.storage, [RUNS_DIR, deps.layout.planPathFor(testPath), deps.layout.groundingPathFor(testPath)]) });
      expect(report.exitCode).toBe(0);
      expect(outcome.results).toHaveLength(1);
      expect(outcome.results[0]?.result).toMatchObject({ status: 'passed', warnings: scenario.warnings });
      expect(outcome.results[0]?.result.steps.map(step => step.status)).toEqual(['passed', 'passed', 'passed', 'passed']);
    } finally {
      await app.stop();
    }
  });
});
