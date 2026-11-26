import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import * as canonicalJson from '#core/ir/canonical-json.js';
import { computeIntentDigest, computePlanDigest } from '#core/ir/digest.js';
import { FsIoError } from '#core/errors/fs-io-error.js';
import { IntegrityViolationError } from '#core/errors/integrity-violation-error.js';
import type { FingerprintNameSlot, JsonValueT } from '#core/ir/schema.js';
import type { GroundingMissReason } from '#core/errors/grounding-miss-reason.js';
import { run } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { createFakeSecretsProvider } from '../../doubles/fake-secrets-provider.js';
import { createScenario, createFakeBrowserSession, liveEntries, writePrompt, createFreshPlan, DEFAULT_OPTIONS, RUNS_DIR, type TestStep } from '../../support/run-scenario.js';
import { neighborTree, observation, RELAX_REF } from '../../support/relaxed-fingerprint.js';
import { assertDiagnosable, assertNoSecretDisclosure, assertZeroAiCalls, collectStorageArtifacts } from '../../support/report-assertions.js';
import { loadCorpus } from '../../support/corpus.js';

afterEach(() => vi.restoreAllMocks());
const SECRET = 'NeighborNoticeCredential_720!';
const SCREEN = 'Run-specific neighbor 2026-11-26T19:41:02Z';
const span = { startLine: 3, startColumn: 1, endLine: 3, endColumn: 16 };
const click = (id = 'click'): TestStep => ({ id, kind: 'action', action: 'click', intent: {
  description: 'Click Submit', roleHint: 'button', sourceSpan: span,
  quote: { text: 'Submit', sourceSpan: { ...span, startColumn: 8, endColumn: 14 } },
} });
const check = (id: string, confirms?: string[]): TestStep => ({ id, kind: 'assert', check: 'text-visible', text: 'Done', timeoutMs: 0, ...(confirms ? { confirms } : {}) });
const notice = (stepId = 'click', names = ['siblingBefore'], saved = true) => ({ kind: 'neighbor-name-ignored', stepId, names, saved });
const oldHint = 'Run `ambercast run --resolve` to allow AI resolution for grounding misses.';

async function fixture(options: {
  ignored?: FingerprintNameSlot[]; change?: Record<string, string | boolean>; steps?: TestStep[];
  disabledWrite?: boolean; fault?: 'secret' | 'serialization' | 'write'; failEnding?: boolean;
  miss?: { reason: GroundingMissReason; difference?: 'neighbor-names' | 'structure'; changedNames?: readonly [FingerprintNameSlot, ...FingerprintNameSlot[]] };
  candidateChanged?: boolean; legacy?: boolean;
} = {}) {
  let active = '';
  let attempts = 0;
  const sessions: ReturnType<typeof createFakeBrowserSession>[] = [];
  const tree = neighborTree(options.change ?? { siblingBefore: SCREEN });
  const steps = options.steps ?? [click()];
  const scenario = createScenario({
    secrets: createFakeSecretsProvider(new Map([['{{secrets.password}}', SECRET]])),
    uiExecutor: () => createFakeUiExecutor(() => {
      const session = createFakeBrowserSession(liveEntries([RELAX_REF], observation(tree).fingerprint), {
        // The secret must materialize before the final cache containment check can reject it.
        ...(options.fault === 'secret' ? { currentUrl: 'https://example.test/' } : {}),
        snapshot: { accessibilityTree: tree, screenshot: new Uint8Array([1]) },
      });
      if (options.miss || options.candidateChanged) {
        const resolve = session.resolveGrounded.bind(session);
        vi.spyOn(session, 'resolveGrounded').mockImplementation(async (ref, query) => {
          if (query.mode === 'verify' && options.miss) return { kind: 'miss', ...options.miss };
          if (query.mode === 'verify' && options.candidateChanged) return { kind: 'miss', reason: 'fingerprint-mismatch', difference: 'neighbor-names', changedNames: ['parent'] };
          return resolve(ref, query);
        });
      }
      vi.spyOn(session, 'evaluateAssert').mockImplementation(async () => ({ passed: !(active === 'ending' && options.failEnding), message: 'Done was absent.' }));
      sessions.push(session);
      return session;
    }),
  });
  const emit = scenario.deps.events.emit.bind(scenario.deps.events);
  const deps = { ...scenario.deps, events: { emit(event: Parameters<typeof emit>[0]) {
    emit(event);
    if (event.type === 'step-start') active = event.stepId;
  } }, ...(options.disabledWrite ? { config: { ...scenario.deps.config, grounding: { repositoryPolicy: 'committed' as const, localWriteBack: 'explicit' as const } } } : {}) };
  const path = await writePrompt(deps.storage, 'login.test.md', '# Submit\n\nClick "Submit".\n');
  const plan = await createFreshPlan(deps.storage, path, steps);
  const entries: Record<string, unknown> = {};
  for (const step of steps) {
    if (step.kind !== 'action' || !('intent' in step)) continue;
    // Keep the credential action strict so only the click learns an exclusion.
    const observed = observation(step.action === 'fill-secret' ? tree : undefined);
    entries[step.id] = { kind: 'element', locator: RELAX_REF, fingerprint: observed.fingerprint,
      ...(options.legacy ? {} : { components: observed.components }), provenance: 'quoted-match',
      intentDigest: computeIntentDigest({ stepKind: 'action', operation: step.action, intent: step.intent }),
      ...(options.ignored ? { ignoredNames: options.ignored } : {}) };
  }
  if (options.fault === 'secret') entries.untouched = { ...(entries.click as object), locator: { ...RELAX_REF, name: SECRET } };
  const groundingPath = deps.layout.groundingPathFor(path);
  const before = canonicalJson.toCanonicalArtifactText({ schemaVersion: 5, planDigest: computePlanDigest(plan), entries } as JsonValueT);
  await deps.storage.writeText(groundingPath, before);
  if (options.fault === 'serialization') {
    const serialize = canonicalJson.toCanonicalArtifactText;
    vi.spyOn(canonicalJson, 'toCanonicalArtifactText').mockImplementation(value => {
      const document = value as unknown as { schemaVersion?: number; entries?: { click?: { ignoredNames?: string[] } } };
      // Earlier reads remain real; only the payload containing newly learned evidence is rejected.
      if (document.schemaVersion === 5 && document.entries?.click?.ignoredNames?.includes('siblingBefore')) {
        attempts++;
        throw new RangeError('Cannot canonicalize a string with an unpaired surrogate.');
      }
      return serialize(value);
    });
  }
  if (options.fault === 'write') {
    const write = deps.storage.writeText.bind(deps.storage);
    vi.spyOn(deps.storage, 'writeText').mockImplementation(async (destination, text) => {
      if (destination === groundingPath) { attempts++; throw new FsIoError('The grounding destination is unwritable.'); }
      return write(destination, text);
    });
  }
  const writes = vi.spyOn(deps.storage, 'writeText');
  return { ...scenario, deps, path, groundingPath, before, attempts: () => attempts,
    sessions,
    groundingWrites: () => writes.mock.calls.filter(([destination]) => destination === groundingPath),
    async execute(resolve = true) {
      const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve, updateCache: resolve && !options.disabledWrite });
      const built = buildRunReport({ startedAt: '2026-11-26T00:00:00Z', durationMs: 0, options: DEFAULT_OPTIONS, outcome });
      assertDiagnosable(built.envelope);
      if (!resolve) assertZeroAiCalls(built.envelope);
      return { outcome, built, row: outcome.results[0]!.result };
    },
  };
}

describe('neighbor-name binding evidence', () => {
  it('emits a fresh run report at version 3.13', async () => {
    const f = await fixture({ change: {} });
    const { built } = await f.execute(false);
    expect(built.envelope.schemaVersion).toBe('3.13');
  });

  it('projects stored exclusions on every zero-AI replay without repeating the notice', async () => {
    const f = await fixture({ ignored: ['siblingBefore'] });
    for (let replay = 0; replay < 2; replay++) {
      const { row, built } = await f.execute(false);
      expect(row.status).toBe('passed');
      expect(built.exitCode).toBe(0);
      expect(row.steps[0]?.binding).toHaveProperty('ignoredNames', ['siblingBefore']);
      expect(built.envelope.results[0]).toHaveProperty('steps.0.binding.ignoredNames', ['siblingBefore']);
      expect(row.warnings).toEqual([]);
      expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
    }
  });

  it('projects decided slots before confirmation without emitting a notice', async () => {
    const f = await fixture({ steps: [click(), check('ending')], failEnding: true });
    const { row, built } = await f.execute();
    expect(row.status).toBe('failed');
    expect(built.exitCode).toBe(1);
    expect(row.steps[0]?.binding).toMatchObject({ confirmed: false, ignoredNames: ['siblingBefore'] });
    expect(built.envelope.results[0]).toMatchObject({ steps: [expect.objectContaining({ binding: expect.objectContaining({ confirmed: false, ignoredNames: ['siblingBefore'] }) }), { id: 'ending', status: 'failed' }] });
    expect(row.warnings).toEqual([]);
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
  });

  it.each([false, true])('omits exclusions for a strict binding with resolve=%s', async resolve => {
    const f = await fixture({ change: {} });
    const { row, built } = await f.execute(resolve);
    expect(row.status).toBe('passed');
    expect(row.steps[0]?.binding).toBeDefined();
    expect(row.steps[0]?.binding).not.toHaveProperty('ignoredNames');
    expect(built.envelope.results[0]).toHaveProperty('steps.0.binding');
    expect(built.envelope.results[0]).not.toHaveProperty('steps.0.binding.ignoredNames');
    expect(row.warnings).toEqual([]);
  });
});

describe('neighbor-name confirmation notices', () => {
  it.each(['completion', 'confirms'] as const)('reports a saved notice after %s', async confirmation => {
    const f = await fixture({ steps: [click(), ...(confirmation === 'confirms' ? [check('confirm', ['click'])] : [])] });
    const { row, built } = await f.execute();
    expect(row.status).toBe('passed');
    expect(built.exitCode).toBe(0);
    expect(row.steps[0]?.binding).toMatchObject({ confirmed: true, ignoredNames: ['siblingBefore'] });
    expect(built.envelope.results[0]).toMatchObject({ steps: [expect.objectContaining({ binding: expect.objectContaining({ confirmed: true, ignoredNames: ['siblingBefore'] }) }), ...(confirmation === 'confirms' ? [{ id: 'confirm', status: 'passed' }] : [])] });
    expect(row.warnings).toEqual([notice()]);
    expect(built.envelope.results[0]).toHaveProperty('warnings', [notice()]);
    expect(JSON.parse(await f.deps.storage.readText(f.groundingPath)).entries.click.ignoredNames).toEqual(['siblingBefore']);
  });

  it('reports only added slots while binding retains the full union', async () => {
    const f = await fixture({ ignored: ['siblingBefore'], change: { parent: SCREEN, siblingBefore: 'Also changed', siblingAfter: 'New after' } });
    const { row, built } = await f.execute();
    expect(row.status).toBe('passed');
    expect(built.exitCode).toBe(0);
    expect(row.steps[0]?.binding).toHaveProperty('ignoredNames', ['parent', 'siblingBefore', 'siblingAfter']);
    expect(built.envelope.results[0]).toHaveProperty('steps.0.binding.ignoredNames', ['parent', 'siblingBefore', 'siblingAfter']);
    expect(row.warnings).toEqual([notice('click', ['parent', 'siblingAfter'])]);
    expect(built.envelope.results[0]).toHaveProperty('warnings', [notice('click', ['parent', 'siblingAfter'])]);
  });

  it.each(['not-permitted', 'secret', 'serialization', 'write'] as const)('retains the notice when write-back is %s', async fault => {
    const secretStep: TestStep = { id: 'secret', kind: 'action', action: 'fill-secret', secretRef: '{{secrets.password}}', intent: {
      description: 'Click Submit', roleHint: 'button', sourceSpan: span,
    } };
    const f = await fixture({ ...(fault === 'not-permitted' ? { disabledWrite: true } : { fault }),
      steps: [click(), check('confirm', ['click']), ...(fault === 'secret' ? [secretStep] : [])] });
    const { outcome, row, built } = await f.execute();
    expect(row.status).toBe(fault === 'not-permitted' ? 'passed' : 'error');
    expect(built.exitCode).toBe(fault === 'not-permitted' ? 0 : fault === 'secret' ? 4 : 3);
    expect(row.steps[0]?.binding).toMatchObject({ confirmed: true });
    if (fault === 'secret') {
      expect(f.sessions[0]?.operations()).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'fill-secret', value: SECRET }),
      ]));
      expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
      expect(outcome.results[0]?.error?.message).toBe('The grounding cache contains a materialized secret value.');
      expect(f.groundingWrites()).toEqual([]);
    }
    expect(row.warnings).toEqual([notice('click', ['siblingBefore'], false)]);
    expect(built.envelope.results[0]).toHaveProperty('warnings', [notice('click', ['siblingBefore'], false)]);
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
    if (fault === 'serialization' || fault === 'write') expect(f.attempts()).toBe(1);
  });

  it('keeps a saved notice after a later assertion fails', async () => {
    const f = await fixture({ steps: [click(), check('confirm', ['click']), check('ending')], failEnding: true });
    const { row, built } = await f.execute();
    expect(row.status).toBe('failed');
    expect(built.exitCode).toBe(1);
    expect(row.warnings).toEqual([notice()]);
    expect(built.envelope.results[0]).toHaveProperty('warnings', [notice()]);
  });

  it.each(['legacy', 'structure'] as const)('does not notify a strict replacement after %s evidence', async fault => {
    const f = await fixture({ ...(fault === 'legacy' ? { legacy: true } : { change: { parentRole: 'form' } }) });
    const { row, built } = await f.execute();
    expect(row.status).toBe('passed');
    expect(built.exitCode).toBe(0);
    expect(row.steps[0]?.binding).not.toHaveProperty('ignoredNames');
    expect(built.envelope.results[0]).not.toHaveProperty('steps.0.binding.ignoredNames');
    expect(row.warnings).toEqual([]);
  });

  it('keeps existing warnings first and newly ignored steps in plan order', async () => {
    const f = await fixture({ steps: [{ id: 'navigate', kind: 'action', action: 'navigate', url: '/' }, check('loaded'), click('z-first'), check('held'), click('a-second')] });
    const { row, built } = await f.execute();
    expect(row.status).toBe('passed');
    expect(built.exitCode).toBe(0);
    expect(row.warnings).toEqual([{ kind: 'assert-held-before-actions', stepId: 'held' }, notice('z-first'), notice('a-second')]);
    expect(built.envelope.results[0]).toHaveProperty('warnings', [{ kind: 'assert-held-before-actions', stepId: 'held' }, notice('z-first'), notice('a-second')]);
  });
});

describe('recoverable stored miss diagnostics', () => {
  it.each(loadCorpus(new URL('../../fixtures/corpus/report/neighbor-name-messages.jsonl', import.meta.url), {
    value: z.enum(['neighbor-names', 'structure', 'unknown']), expected: z.object({ message: z.string(), hint: z.string() }),
  }))('line $line: $note', async ({ value: difference, expected }) => {
    const f = await fixture({ ...(difference === 'unknown' ? { legacy: true } : {}), change: difference === 'structure' ? { parentRole: 'form' } : { siblingBefore: SCREEN } });
    const { outcome, built, row } = await f.execute(false);
    const details = { stepId: 'click', reason: 'recoverable-miss', verification: 'fingerprint-mismatch',
      ...(difference === 'unknown' ? {} : { difference }), ...(difference === 'neighbor-names' ? { changedNames: ['siblingBefore'] } : {}) };
    expect(row.status).toBe('error');
    expect(built.exitCode).toBe(4);
    expect(outcome.results[0]?.error?.details).toEqual(details);
    expect(built.envelope.errors[0]).toMatchObject({ ...expected, details });
    const error = built.envelope.errors[0]!;
    expect(error.code).toBe('GROUNDING_UNRESOLVED');
    if (error.code !== 'GROUNDING_UNRESOLVED') throw new Error('Expected a grounding diagnostic.');
    expect(Object.keys(error.details!).sort()).toEqual(Object.keys(details).sort());
  });

  it.each(['element-not-found', 'ambiguous-match', 'snapshot-invalid', 'secret-contaminated'] as const)('omits difference keys for %s', async reason => {
    const f = await fixture({ miss: { reason, difference: 'neighbor-names', changedNames: ['parent'] } });
    const { outcome, built } = await f.execute(false);
    const details = { stepId: 'click', reason: 'recoverable-miss', verification: reason };
    expect(outcome.results[0]?.error?.details).toStrictEqual(details);
    const error = built.envelope.errors[0]!;
    expect(error.code).toBe('GROUNDING_UNRESOLVED');
    if (error.code !== 'GROUNDING_UNRESOLVED') throw new Error('Expected a grounding diagnostic.');
    expect(error.details).toStrictEqual(details);
    expect(built.envelope.errors[0]?.hint).toBe(oldHint);
  });

  it('keeps candidate-changed evidence unchanged even when verification knows a difference', async () => {
    const f = await fixture({ candidateChanged: true });
    const { outcome, built } = await f.execute();
    const details = { stepId: 'click', reason: 'candidate-changed', verification: 'fingerprint-mismatch' };
    expect(outcome.results[0]?.error?.details).toStrictEqual(details);
    expect(built.envelope.errors[0]).toMatchObject({ message: 'The selected element changed before the operation.',
      hint: 'Quote the UI text in the prompt or run `ambercast heal` to update the binding.', details });
    const error = built.envelope.errors[0]!;
    expect(error.code).toBe('GROUNDING_UNRESOLVED');
    if (error.code !== 'GROUNDING_UNRESOLVED') throw new Error('Expected a grounding diagnostic.');
    expect(error.details).toStrictEqual(details);
  });
});

describe('neighbor-name disclosure boundary', () => {
  it.each([false, true])('keeps screen text and credentials out of added fields with resolve=%s', async resolve => {
    const f = await fixture();
    const { built, row } = await f.execute(resolve);
    const roots = [f.deps.layout.planPathFor(f.path), f.groundingPath];
    // `exists` reports regular files only, so the run directory is detected through its listings; the collector rejects an empty root.
    const runEntries = (await f.deps.storage.listFiles(RUNS_DIR)).length + (await f.deps.storage.listDirectories(RUNS_DIR)).length;
    if (runEntries > 0) roots.push(RUNS_DIR);
    const artifacts = await collectStorageArtifacts(f.deps.storage, roots);
    assertNoSecretDisclosure({ secrets: { credential: SECRET }, report: built.envelope, artifacts });
    // Existing failure evidence can contain the page; the added structured fields cannot.
    const additions = { bindings: row.steps.map(step => step.binding), warnings: row.warnings,
      details: built.envelope.errors.map(error => error.code === 'GROUNDING_UNRESOLVED' ? error.details : undefined) };
    assertNoSecretDisclosure({ secrets: { credential: SECRET, screen: SCREEN }, report: additions });
    if (resolve) {
      expect(row.steps[0]?.binding).toHaveProperty('ignoredNames', ['siblingBefore']);
      expect(row.warnings).toEqual([notice()]);
    } else expect(built.envelope.errors[0]).toHaveProperty('details', { stepId: 'click', reason: 'recoverable-miss', verification: 'fingerprint-mismatch', difference: 'neighbor-names', changedNames: ['siblingBefore'] });
  });
});
