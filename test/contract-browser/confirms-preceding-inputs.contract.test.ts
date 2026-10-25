import { chromium } from 'playwright-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPlaywrightUiExecutor } from '#adapters/browser/chromium.js';
import { GroundingDocument } from '#core/ir/schema.js';
import { run } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { createFakeAiExecutor } from '../doubles/fake-ai-executor.js';
import { assertDiagnosable, assertZeroAiCalls } from '../support/report-assertions.js';
import { createFreshPlan, createScenario, DEFAULT_OPTIONS, RESOLVED_TARGETS, type TestStep, writePrompt } from '../support/run-scenario.js';
import { resolveChromiumAvailability } from './support/chromium-availability.js';
import { startFixtureApp } from './support/fixture-app.js';

const POSITIVE_BODY = 'Open the sign-in page. Enter the username "verifier" and the saved password, then click "Sign in". Assert that the text "Signed in as verifier" is displayed.';
const CASES = [
  { name: 'P', body: POSITIVE_BODY, requests: 2, saved: ['fill-username', 'fill-password', 'click-sign-in'], missing: [] },
  { name: 'OLD', body: POSITIVE_BODY, requests: 2, saved: ['click-sign-in'], missing: ['fill-username', 'fill-password'] },
  { name: 'N1', body: 'Open the sign-in page. Enter the username "verifier" and the saved password, then click "Sign in". Assert that the "Sign out" button is displayed.', requests: 2, saved: [], missing: ['fill-username', 'fill-password', 'click-sign-in'] },
  { name: 'N2', body: 'Open the sign-in page. The browser autofills the username and password. Type "verifier" into the search box, then click "Sign in". Assert that the text "Signed in as verifier" is displayed.', requests: 1, saved: ['click-sign-in'], missing: ['fill-search'] },
  { name: 'N3', body: 'Open the sign-in page. Enter the username "alice", then replace it with the username "verifier". Enter the saved password and click "Sign in". Assert that the text "Signed in as verifier" is displayed.', requests: 3, saved: ['fill-username', 'fill-password', 'click-sign-in'], missing: ['fill-username-first'] },
] as const;

// Quotes must refer to the instruction rather than the identically named heading.
function bodySpan(body: string, text = body) {
  const index = body.indexOf(text);
  if (index === -1) throw new Error('The span text is absent from the instruction body.');
  return { startLine: 3, startColumn: index + 1, endLine: 3, endColumn: index + text.length + 1 };
}

let chromiumAvailable = false;

describe('Issue #598 TEST-10 preceding input confirmation against real Chromium', () => {
  beforeAll(async () => {
    chromiumAvailable = await resolveChromiumAvailability(() => chromium.launch());
  });
  beforeEach(context => {
    if (!chromiumAvailable) context.skip('Chromium is unavailable locally; CI requires the browser contract.');
  });

  it.each(CASES)('$name persists only evidenced bindings and replays without AI', async scenario => {
    const app = await startFixtureApp();
    try {
      app.setPage('/sign-in-598', `<!doctype html><html lang="en"><body>
<label for="username">Username</label><input id="username" type="text" autocomplete="off"${scenario.name === 'N2' ? ' value="verifier"' : ''}>
<label for="password">Password</label><input id="password" type="password" autocomplete="off"${scenario.name === 'N2' ? ' value="pw-598"' : ''}>
<label for="search">Search</label><input id="search" type="search" autocomplete="off">
<button type="button" id="sign-in">Sign in</button><p id="status"></p>
${scenario.name === 'N1' ? '<button type="button">Sign out</button>' : ''}
<script>document.querySelector('#sign-in').addEventListener('click', () => {
  const username = document.querySelector('#username').value;
  const password = document.querySelector('#password').value;
  document.querySelector('#status').textContent = username && password ? 'Signed in as ' + username : 'Invalid credentials';
});</script></body></html>`);
      const executor = createFakeAiExecutor({ execute: async request => {
        const description = (request.context as { description: string }).description;
        const proposal = description === 'Username field'
          ? { outcome: 'found', role: 'textbox', name: 'Username' }
          : description === 'Password field'
            ? { outcome: 'found', role: 'textbox', name: 'Password' }
            : description === 'Search box'
              ? { outcome: 'found', role: 'searchbox', name: 'Search' }
              : undefined;
        if (proposal === undefined) throw new Error(`Unscripted binding description: ${description}`);
        const data = { proposal };
        return { data, raw: JSON.stringify(data) };
      } });
      const { deps } = createScenario({ uiExecutor: () => createPlaywrightUiExecutor({ kind: 'playwright', browser: 'chromium' }), resolveAiExecutor: async () => executor });
      const targets = { web: { ...RESOLVED_TARGETS.web, baseUrl: app.baseUrl, resolveTimeoutMs: 0 } };
      const browserDeps = { ...deps, config: { ...deps.config, targets } };
      const testPath = await writePrompt(deps.storage, 'login.test.md', `# Sign in\n\n${scenario.body}\n`);
      const sourceSpan = bodySpan(scenario.body);
      const usernameIntent = { description: 'Username field', roleHint: 'textbox', sourceSpan };
      const steps: TestStep[] = [
        { id: 'open', kind: 'action', action: 'navigate', url: '/sign-in-598' },
        ...(scenario.name === 'N3' ? [{ id: 'fill-username-first', kind: 'action' as const, action: 'fill' as const, value: 'alice', intent: usernameIntent }] : []),
        ...(scenario.name === 'N2'
          ? [{ id: 'fill-search', kind: 'action' as const, action: 'fill' as const, value: 'verifier', intent: { description: 'Search box', roleHint: 'searchbox', sourceSpan } }]
          : [
            { id: 'fill-username', kind: 'action' as const, action: 'fill' as const, value: 'verifier', intent: usernameIntent },
            { id: 'fill-password', kind: 'action' as const, action: 'fill' as const, value: 'pw-598', intent: { description: 'Password field', roleHint: 'textbox', sourceSpan } },
          ]),
        { id: 'click-sign-in', kind: 'action', action: 'click', intent: { description: 'Sign in button', roleHint: 'button', sourceSpan, quote: { text: 'Sign in', sourceSpan: bodySpan(scenario.body, 'Sign in') } } },
        { id: 'confirm-signed-in', kind: 'assert', check: 'text-visible', text: scenario.name === 'N1' ? 'Sign out' : 'Signed in as verifier', ...(scenario.name === 'N1' ? {} : { confirms: [...scenario.saved] }) },
      ];
      await createFreshPlan(deps.storage, testPath, steps, targets);
      const groundingPath = deps.layout.groundingPathFor(testPath);
      expect(await deps.storage.exists(groundingPath)).toBe(false);

      const first = await run(browserDeps, { ...DEFAULT_OPTIONS, updateCache: true });
      expect(first.results).toHaveLength(1);
      expect(first.results[0]?.result.status).toBe('passed');
      expect(executor.structuredRequests).toHaveLength(scenario.requests);
      expect(executor.agenticRequests).toHaveLength(0);
      const firstReport = buildRunReport({ startedAt: '2026-10-13T00:00:00Z', durationMs: 0, options: { allowEmpty: false, list: false }, outcome: first });
      assertDiagnosable(firstReport.envelope);
      for (const id of scenario.missing.filter(id => id.startsWith('fill-'))) {
        expect(first.results[0]?.result.steps.find(step => step.id === id)).toMatchObject({ status: 'passed', binding: { provenance: 'ai-proposed', confirmed: false } });
      }
      const persistedText = await deps.storage.exists(groundingPath) ? await deps.storage.readText(groundingPath) : undefined;
      const grounding = persistedText === undefined ? undefined : GroundingDocument.parse(JSON.parse(persistedText));
      expect(Object.keys(grounding?.entries ?? {}).sort()).toEqual([...scenario.saved].sort());
      for (const id of scenario.missing) expect(grounding?.entries[id]).toBeUndefined();
      for (const id of scenario.saved) {
        expect(grounding?.schemaVersion).toBe(4);
        expect(grounding?.entries[id]).toMatchObject({ kind: 'element', provenance: id === 'click-sign-in' ? 'quoted-match' : 'ai-proposed' });
        expect(first.results[0]?.result.steps.find(step => step.id === id)).toMatchObject({ binding: { provenance: id === 'click-sign-in' ? 'quoted-match' : 'ai-proposed', confirmed: true } });
      }

      const second = await run(browserDeps, { ...DEFAULT_OPTIONS, resolve: false });
      const report = buildRunReport({ startedAt: '2026-10-13T00:00:00Z', durationMs: 0, options: { allowEmpty: false, list: false }, outcome: second });
      assertZeroAiCalls(report.envelope);
      assertDiagnosable(report.envelope);
      expect(executor.structuredRequests).toHaveLength(scenario.requests);
      expect(executor.agenticRequests).toHaveLength(0);
      expect(await deps.storage.exists(groundingPath)).toBe(persistedText !== undefined);
      if (persistedText !== undefined) expect(await deps.storage.readText(groundingPath)).toBe(persistedText);
      expect(second.results).toHaveLength(1);
      if (scenario.name === 'P') {
        expect(second.results[0]?.result.status).toBe('passed');
        for (const id of scenario.saved) {
          expect(second.results[0]?.result.steps.find(step => step.id === id)).toMatchObject({ binding: { provenance: 'grounding', confirmed: true } });
        }
      } else {
        expect(second.results[0]?.error).toMatchObject({ kind: 'grounding-unresolved', details: { reason: 'missing', stepId: scenario.missing[0] } });
        expect(report.envelope.errors[0]).toMatchObject({ code: 'GROUNDING_UNRESOLVED' });
      }
    } finally {
      await app.stop();
    }
  });
});
