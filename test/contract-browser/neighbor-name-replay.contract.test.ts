import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlaywrightUiExecutor } from '#adapters/browser/chromium.js';
import * as fingerprint from '#core/ir/fingerprint.js';
import { GroundingDocument } from '#core/ir/schema.js';
import { run } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { createFakeAiExecutor } from '../doubles/fake-ai-executor.js';
import { assertDiagnosable, assertNoSecretDisclosure, assertZeroAiCalls, collectStorageArtifacts } from '../support/report-assertions.js';
import { createFreshPlan, createScenario, DEFAULT_OPTIONS, RESOLVED_TARGETS, RUNS_DIR, writePrompt } from '../support/run-scenario.js';
import { resolveChromiumAvailability } from './support/chromium-availability.js';

let chromiumAvailable = false;
// Follow the sibling contract's sentinel pattern to check artifacts for disclosure.
const sentinel = 'never-disclose-this-neighbor-replay-contract-secret';

// A fresh document gets a fresh name, without a timer that could change it
// between binding and the pre-action check. The other neighbor is independent.
const pageHtml = (stableName = 'Keep memo') => `<!doctype html><html lang="en"><body>
<div role="group" aria-label="Memo editor"><button id="load-name"></button><div contenteditable="true" role="textbox"></div><button>${stableName}</button></div>
<p id="result"></p><script>
document.getElementById('load-name').textContent = 'Loaded ' + crypto.randomUUID();
window.__events = [];
document.querySelector('[contenteditable]').addEventListener('input', async () => {
  window.__events.push('input');
  await fetch('/input', { method: 'POST', body: JSON.stringify(window.__events) });
  document.getElementById('result').textContent = 'Memo saved';
});
</script></body></html>`;

async function scenario() {
  const actions: string[] = [];
  let html = pageHtml();
  // The shared fixture has no custom handlers; HTTP observation avoids changing browser receivers.
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/input') {
      actions.push('fill');
      request.resume();
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  const app = {
    baseUrl: '',
    setPage(_path: string, content: string) { html = content; },
    async stop() {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    },
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The neighbor-name fixture has no TCP address.');
    app.baseUrl = `http://127.0.0.1:${address.port}`;
    app.setPage('/neighbor', pageHtml());
    const executor = createFakeAiExecutor({ execute: async () => ({ data: { proposal: { outcome: 'found', role: 'textbox', name: '' } }, raw: '{"proposal":{"outcome":"found","role":"textbox","name":""}}' }) });
    const original = fingerprint.resolveAccessibilityFingerprint;
    vi.spyOn(fingerprint, 'resolveAccessibilityFingerprint').mockImplementation((...args: Parameters<typeof original>): ReturnType<typeof original> => {
      const result = original(...args);
      if (result === 'hit') actions.push('live-hit');
      return result;
    });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: () => createPlaywrightUiExecutor({ kind: 'playwright', browser: 'chromium' }),
      resolveAiExecutor: async () => executor,
    });
    const targets = { web: { ...RESOLVED_TARGETS.web, baseUrl: app.baseUrl, resolveTimeoutMs: 0 } };
    const browserDeps = { ...deps, config: { ...deps.config, targets } };
    const testPath = await writePrompt(deps.storage);
    await createFreshPlan(deps.storage, testPath, [
      { id: 'open', kind: 'action', action: 'navigate', url: '/neighbor' },
      { id: 'fill-memo', kind: 'action', action: 'fill', value: 'Hello memo', intent: { description: 'Memo editor', roleHint: 'textbox', sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 56 } } },
      { id: 'confirm-memo', kind: 'assert', check: 'text-visible', text: 'Memo saved', confirms: ['fill-memo'] },
    ], targets);
    const groundingPath = deps.layout.groundingPathFor(testPath);
    const grounding = async () => GroundingDocument.parse(JSON.parse(await deps.storage.readText(groundingPath)));
    let sequence = 0;
    async function execute(resolve: boolean) {
      actions.length = 0;
      const callsBefore = executor.structuredRequests.length;
      const runId = `neighbor-replay-${++sequence}`;
      const outcome = await run({ ...browserDeps, runId }, { ...DEFAULT_OPTIONS, resolve, updateCache: resolve });
      const report = buildRunReport({ startedAt: '2026-11-26T00:00:00Z', durationMs: 0, options: { allowEmpty: false, list: false }, outcome });
      if (resolve) {
        expect(outcome.results[0]?.result.status, JSON.stringify({
          errors: report.envelope.errors,
          steps: outcome.results[0]?.result.steps,
        })).toBe('passed');
      }
      assertDiagnosable(report.envelope);
      if (!resolve) {
        assertZeroAiCalls(report.envelope);
        expect(executor.structuredRequests).toHaveLength(callsBefore);
      }
      // The command boundary normally persists reports; retain each run for disclosure checks.
      await deps.storage.writeText(`${RUNS_DIR}/${runId}.json`, JSON.stringify(report.envelope));
      assertNoSecretDisclosure({ secrets: { neighborReplaySentinel: sentinel }, report: report.envelope, artifacts: await collectStorageArtifacts(deps.storage,
        [RUNS_DIR, deps.layout.planPathFor(testPath), groundingPath]) });
      return { outcome, report: report.envelope };
    }
    async function resolveAndPersist() {
      const writesBefore = recordingStorage.writes.filter(write => write.path === groundingPath).length;
      const resolved = await execute(true);
      expect(resolved.outcome.results[0]?.result.status).toBe('passed');
      expect(resolved.outcome.results[0]?.result.steps.find(step => step.id === 'fill-memo'))
        .toMatchObject({ status: 'passed', binding: { confirmed: true } });
      expect(recordingStorage.writes.filter(write => write.path === groundingPath).length).toBeGreaterThan(writesBefore);
      return grounding();
    }
    async function learnChangedNeighbor() {
      const first = await resolveAndPersist();
      expect(first.entries['fill-memo']).toMatchObject({ kind: 'element', components: { algorithm: 'a11y-components-v1' } });
      expect(first.entries['fill-memo']).not.toHaveProperty('ignoredNames');
      const before = await deps.storage.readText(groundingPath);
      const stopped = await execute(false);
      expect(stopped.report.errors[0]).toMatchObject({ code: 'GROUNDING_UNRESOLVED', scope: 'case', details: {
        verification: 'fingerprint-mismatch', difference: 'neighbor-names', changedNames: ['siblingBefore'],
      } });
      expect(await deps.storage.readText(groundingPath)).toBe(before);
      const second = await resolveAndPersist();
      expect(second.entries['fill-memo']).toMatchObject({ ignoredNames: ['siblingBefore'] });
      return second;
    }
    return { app, deps, actions, groundingPath, grounding, execute, resolveAndPersist, learnChangedNeighbor };
  } catch (error) {
    await app.stop();
    throw error;
  }
}

describe('neighbor-name replay against real Chromium', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  beforeAll(async () => { chromiumAvailable = await resolveChromiumAvailability(() => chromium.launch()); });
  beforeEach(context => {
    if (!chromiumAvailable) context.skip('Chromium is unavailable locally; CI requires the browser contract.');
  });

  it('TEST-HARNESS-2 persists two observations and passes two AI-free replays', async () => {
    const f = await scenario();
    try {
      await f.learnChangedNeighbor();
      const saved = await f.deps.storage.readText(f.groundingPath);
      for (let attempt = 0; attempt < 2; attempt++) {
        const replay = await f.execute(false);
        expect(replay.outcome.results[0]?.result.status).toBe('passed');
        expect(replay.report.errors).toEqual([]);
        expect(await f.deps.storage.readText(f.groundingPath)).toBe(saved);
      }
    } finally { await f.app.stop(); }
  });

  it('TEST-HARNESS-2 keeps the stable neighbor protected after learning the changing neighbor', async () => {
    const f = await scenario();
    try {
      await f.learnChangedNeighbor();
      const saved = await f.deps.storage.readText(f.groundingPath);
      f.app.setPage('/neighbor', pageHtml('Discard memo'));
      const stopped = await f.execute(false);
      expect(stopped.outcome.results[0]?.result.status).not.toBe('passed');
      expect(stopped.report.errors[0]).toMatchObject({ code: 'GROUNDING_UNRESOLVED', details: {
        verification: 'fingerprint-mismatch', difference: 'neighbor-names', changedNames: ['siblingAfter'],
      } });
      expect(await f.deps.storage.readText(f.groundingPath)).toBe(saved);
    } finally { await f.app.stop(); }
  });

  it('TEST-HARNESS-2 re-verifies the live fingerprint before filling a relaxed match', async () => {
    const f = await scenario();
    try {
      await f.learnChangedNeighbor();
      const replay = await f.execute(false);
      expect(f.actions).toEqual(['live-hit', 'fill']);
      expect(replay.outcome.results[0]?.result.steps.find(step => step.id === 'fill-memo'))
        .toMatchObject({ status: 'passed', binding: { provenance: 'grounding', ignoredNames: ['siblingBefore'] } });
      expect(replay.outcome.results[0]?.result.steps.find(step => step.id === 'confirm-memo')).toMatchObject({ status: 'passed' });
      expect(replay.report.errors).toEqual([]);
    } finally { await f.app.stop(); }
  });
});
