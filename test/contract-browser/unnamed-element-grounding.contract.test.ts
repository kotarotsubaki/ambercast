import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPlaywrightUiExecutor } from '#adapters/browser/chromium.js';
import { GroundingDocument } from '#core/ir/schema.js';
import { run } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { createFakeAiExecutor } from '../doubles/fake-ai-executor.js';
import { assertDiagnosable, assertZeroAiCalls } from '../support/report-assertions.js';
import { createFreshPlan, createScenario, DEFAULT_OPTIONS, RESOLVED_TARGETS, writePrompt } from '../support/run-scenario.js';
import { resolveChromiumAvailability } from './support/chromium-availability.js';

let chromiumAvailable = false;

describe('Issue #596 TEST-11 unnamed textbox grounding against real Chromium', () => {
  beforeAll(async () => {
    chromiumAvailable = await resolveChromiumAvailability(() => chromium.launch());
  });
  beforeEach(context => {
    if (!chromiumAvailable) context.skip('Chromium is unavailable locally; CI requires the browser contract.');
  });

  it.each([false, true])('persists an unnamed binding and replays with duplicate screen=$duplicate', async duplicate => {
    let duplicateScreen = false;
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html lang="en"><body><label>User <input></label><div contenteditable="true" role="textbox"></div>${duplicateScreen ? '<div contenteditable="true" role="textbox"></div>' : ''}<p id="result"></p><script>document.querySelector('[contenteditable]').addEventListener('input', () => { document.querySelector('#result').textContent = 'Memo saved'; });</script></body></html>`);
    });
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('The unnamed-element fixture has no TCP address.');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const executor = createFakeAiExecutor({ execute: async () => ({ data: { proposal: { outcome: 'found', role: 'textbox', name: '' } }, raw: '{"proposal":{"outcome":"found","role":"textbox","name":""}}' }) });
      const { deps } = createScenario({ uiExecutor: () => createPlaywrightUiExecutor({ kind: 'playwright', browser: 'chromium' }), resolveAiExecutor: async () => executor });
      const targets = { web: { ...RESOLVED_TARGETS.web, baseUrl, resolveTimeoutMs: 0 } };
      const browserDeps = { ...deps, config: { ...deps.config, targets } };
      const testPath = await writePrompt(deps.storage);
      await createFreshPlan(deps.storage, testPath, [
        { id: 'open', kind: 'action', action: 'navigate', url: '/' },
        { id: 'fill-memo', kind: 'action', action: 'fill', value: 'Hello memo', intent: { description: 'Memo editor', roleHint: 'textbox', sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 56 } } },
        { id: 'confirm-memo', kind: 'assert', check: 'text-visible', text: 'Memo saved', confirms: ['fill-memo'] },
      ], targets);
      const first = await run(browserDeps, { ...DEFAULT_OPTIONS, updateCache: true });
      expect(first.results[0]?.result.status).toBe('passed');
      expect(executor.structuredRequests).toHaveLength(1);
      const groundingPath = deps.layout.groundingPathFor(testPath);
      const persistedText = await deps.storage.readText(groundingPath);
      const grounding = GroundingDocument.parse(JSON.parse(persistedText));
      expect(grounding.schemaVersion).toBe(4);
      expect(grounding.entries['fill-memo']).toMatchObject({ kind: 'element', locator: { strategy: 'accessibility', role: 'textbox', name: '' } });
      duplicateScreen = duplicate;
      const second = await run(browserDeps, { ...DEFAULT_OPTIONS, resolve: false });
      const report = buildRunReport({ startedAt: '2026-10-11T00:00:00Z', durationMs: 0, options: { allowEmpty: false, list: false }, outcome: second });
      assertZeroAiCalls(report.envelope);
      assertDiagnosable(report.envelope);
      expect(executor.structuredRequests).toHaveLength(1);
      expect(await deps.storage.readText(groundingPath)).toBe(persistedText);
      if (duplicate) {
        expect(second.results[0]?.error).toMatchObject({ kind: 'grounding-unresolved', details: { reason: 'recoverable-miss' } });
        expect(report.envelope.errors[0]).toMatchObject({ code: 'GROUNDING_UNRESOLVED' });
      } else {
        expect(second.results[0]?.result.status).toBe('passed');
        expect(second.results[0]?.result.steps.find(step => step.id === 'fill-memo')).toMatchObject({ binding: { provenance: 'grounding' } });
      }
    } finally {
      if (server.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => { server.close(error => error === undefined ? resolve() : reject(error)); });
      }
    }
  });
});
