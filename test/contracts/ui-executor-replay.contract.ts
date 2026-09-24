import { afterAll, describe, expect, it, vi } from 'vitest';
import { createUiExecutorResolver, type UiExecutorFactory } from '#adapters/browser/registry.js';
import { loadConfig } from '#config/load.js';
import { createCallIdAllocator } from '#core/ai/call-id-allocator.js';
import { promptTemplateFingerprint } from '#core/ai/prompt-envelope.js';
import { planProducerBundleFingerprint } from '#core/ai/plan-producer-bundle.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { computeInputsDigest, computePlanDigest } from '#core/ir/digest.js';
import { normalizeTestMd } from '#core/ir/normalize.js';
import type { TargetDefinition, ElementRef, PlanDocument, JsonValueT, GroundingDocument } from '#core/ir/schema.js';
import { createLayoutResolver } from '#core/layout/resolve.js';
import { run, type RunDeps } from '#usecases/run.js';
import { reportError } from '#report/error-mapping.js';
import { createFixedClock } from '../doubles/create-fixed-clock.js';
import { createInMemoryStorage } from '../doubles/create-in-memory-storage.js';
import { createRecordingEventSink } from '../doubles/create-recording-event-sink.js';
import { createFakeAiExecutor } from '../doubles/fake-ai-executor.js';
import { createFakeSecretsProvider } from '../doubles/fake-secrets-provider.js';

export type { UiExecutorFactory } from '#adapters/browser/registry.js';

export type UiExecutorReplayHarness = {
  target: TargetDefinition;
  entryUrl: string;
  element: ElementRef;
  readyText: string;
  producerFactory: UiExecutorFactory;
  sameObservationFactory: UiExecutorFactory;
  divergentObservationFactory: UiExecutorFactory;
  inspectDivergentSession?: () => readonly { type: string; action?: { type: string }; query?: { mode: string } & Record<string, unknown> }[];
  dispose?: () => Promise<void> | void;
};

/** Applies identical persisted replay oracles to fake and live executors. */
export function registerUiExecutorReplayContract(harness: UiExecutorReplayHarness): void {
  describe('UI executor replay contract', () => {
    afterAll(async () => { await harness.dispose?.(); });

    async function scenario() {
      const root = '/ui-executor-replay';
      const file = `${root}/case.test.md`;
      const prompt = '# Replay\n\nClick Submit and see Ready.\n';
      const storage = createInMemoryStorage();
      const layout = createLayoutResolver({ testDir: root, runsDir: `${root}/.runs` });
      await storage.writeText(`${root}/ambercast.config.json`, JSON.stringify({
        $schema: 'https://ambercast.dev/schema/config.json', testDir: root, runsDir: `${root}/.runs`,
        targets: { app: { baseUrl: harness.target.baseUrl } }, defaultTarget: 'app',
        grounding: { localWriteBack: 'explicit' },
      }));
      const loaded = await loadConfig({ cwd: root, storage });
      const config = 'resolved' in loaded ? loaded.resolved : loaded;
      const targets = { app: harness.target };
      const plan: PlanDocument = {
        schemaVersion: 4,
        source: { inputsDigest: computeInputsDigest({
          normalizedTestMd: normalizeTestMd(prompt), schemaVersion: 4,
          generatorPromptTemplateFingerprint: promptTemplateFingerprint(),
          planProducerBundleFingerprint: planProducerBundleFingerprint(), targetDefinitions: targets,
        }) },
        targets,
        steps: [
          { id: 'open-entry', target: 'app', kind: 'action', action: 'navigate', url: harness.entryUrl },
          { id: 'click-submit', target: 'app', kind: 'action', action: 'click', element: harness.element },
          { id: 'see-ready', target: 'app', kind: 'assert', check: 'text-visible', text: harness.readyText, timeoutMs: 5000 },
        ],
      };
      const grounding: GroundingDocument = { schemaVersion: 2, planDigest: computePlanDigest(plan), entries: {} };
      await storage.writeText(file, prompt);
      await storage.writeText(layout.planPathFor(file), toCanonicalArtifactText(plan as JsonValueT));
      await storage.writeText(layout.groundingPathFor(file), toCanonicalArtifactText(grounding as JsonValueT));
      const planBytes = await storage.readText(layout.planPathFor(file));
      const execute = async (factory: UiExecutorFactory, resolve: boolean) => {
        const events = createRecordingEventSink();
        const factorySpy = vi.fn(factory);
        const deps: RunDeps = {
          storage, layout, clock: createFixedClock(new Date('2026-09-24T00:00:00Z'), 0),
          runId: '2026-09-24T000000Z-550e8400-e29b-41d4-a716-446655440000',
          uiExecutor: createUiExecutorResolver({ headed: false, factories: { playwright: factorySpy } }),
          secrets: createFakeSecretsProvider(new Map()),
          resolveAiExecutor: async () => createFakeAiExecutor({ execute: () => ({ data: { confirmed: true }, raw: '{"confirmed":true}' }) }),
          events: events.sink, discoverTestFiles: async () => [file], isCI: false,
          config, allocateCallId: createCallIdAllocator(),
        };
        const outcome = await run(deps, { files: [file], resolve, updateCache: true, allowEmpty: false, list: false, stale: 'fail' });
        expect(factorySpy).toHaveBeenCalledTimes(1);
        expect(outcome.results[0]?.result.sessions.app).toMatchObject({ state: 'closed', executor: { kind: 'playwright', browser: 'chromium' } });
        expect(await storage.readText(layout.planPathFor(file))).toBe(planBytes);
        return { outcome, events: events.emitted(), groundingBytes: await storage.readText(layout.groundingPathFor(file)) };
      };
      return { execute };
    }

    async function advance(stage: 1 | 2 | 3 | 4 | 5) {
      const { execute } = await scenario();
      const s1 = await execute(harness.producerFactory, true);
      expect(s1.outcome.results[0]?.result).toMatchObject({ status: 'passed' });
      expect(s1.events.filter((event) => event.type === 'step-result')).toEqual([
        { type: 'step-result', stepId: 'open-entry', via: 'grounding' },
        { type: 'step-result', stepId: 'click-submit', via: 'ai-resolve' },
        { type: 'step-result', stepId: 'see-ready', via: 'grounding' },
      ]);
      const firstEntry = JSON.parse(s1.groundingBytes).entries['click-submit'];
      expect(firstEntry?.fingerprint).toBeDefined();
      if (stage === 1) return;

      const s2 = await execute(harness.sameObservationFactory, false);
      expect(s2.outcome.results[0]?.result).toMatchObject({ status: 'passed', aiCalls: 0 });
      expect(s2.events.filter((event) => event.type === 'step-result').map((event) => event.via)).toEqual(['grounding', 'grounding', 'grounding']);
      expect(s2.events.filter((event) => event.type === 'ai-call')).toHaveLength(0);
      expect(s2.groundingBytes).toBe(s1.groundingBytes);
      if (stage === 2) return;

      const s3 = await execute(harness.divergentObservationFactory, false);
      expect(s3.outcome.results[0]?.result).toMatchObject({ status: 'error', aiCalls: 0 });
      expect(s3.outcome.results[0]?.error).toMatchObject({ kind: 'grounding-unresolved', exitCode: 4, details: { stepId: 'click-submit', reason: 'recoverable-miss' } });
      const s3Error = s3.outcome.results[0]?.error;
      if (s3Error === undefined) throw new Error('S3 must have a classified error.');
      expect(reportError(s3Error, { scope: 'case', caseId: 'case' })).toMatchObject({ code: 'GROUNDING_UNRESOLVED', hint: expect.any(String) });
      expect(s3.events.filter((event) => event.type === 'step-result')).toEqual([{ type: 'step-result', stepId: 'open-entry', via: 'grounding' }]);
      expect(s3.events).toContainEqual({ type: 'step-start', stepId: 'click-submit' });
      expect(s3.events).not.toContainEqual({ type: 'step-start', stepId: 'see-ready' });
      expect(s3.events.filter((event) => event.type === 'ai-call')).toHaveLength(0);
      expect(s3.groundingBytes).toBe(s1.groundingBytes);
      const operations = harness.inspectDivergentSession?.();
      if (operations !== undefined) {
        expect(operations.filter((operation) => operation.type === 'resolve-grounded' && operation.query?.mode === 'verify')).toHaveLength(1);
        expect(operations.filter((operation) => operation.type === 'perform' && operation.action?.type === 'click')).toHaveLength(0);
      }
      if (stage === 3) return;

      const s4 = await execute(harness.divergentObservationFactory, true);
      expect(s4.outcome.results[0]?.result).toMatchObject({ status: 'passed', aiCalls: 1 });
      expect(s4.events.filter((event) => event.type === 'step-result')).toContainEqual({ type: 'step-result', stepId: 'click-submit', via: 'ai-resolve' });
      expect(s4.events.filter((event) => event.type === 'ai-call')).toHaveLength(1);
      expect(JSON.parse(s4.groundingBytes).entries['click-submit'].fingerprint.hash).not.toBe(firstEntry.fingerprint.hash);
      if (stage === 4) return;

      const s5 = await execute(harness.divergentObservationFactory, false);
      expect(s5.outcome.results[0]?.result).toMatchObject({ status: 'passed', aiCalls: 0 });
      expect(s5.events.filter((event) => event.type === 'step-result').map((event) => event.via)).toEqual(['grounding', 'grounding', 'grounding']);
      expect(s5.events.filter((event) => event.type === 'ai-call')).toHaveLength(0);
      expect(s5.groundingBytes).toBe(s4.groundingBytes);
    }

    it('S1 writes producer grounding', async () => advance(1));
    it('S2 replays the same observation', async () => advance(2));
    it('S3 refuses divergent grounding without AI', async () => advance(3));
    it('S4 resolves divergent grounding', async () => advance(4));
    it('S5 replays the updated observation', async () => advance(5));
  });
}
