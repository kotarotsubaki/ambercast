/** Ensures binding failures retain precise, secret-safe evidence without changing replay control flow. */
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as runModule from '#usecases/run.js';
import { run } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { GroundingUnresolvedDetails } from '#report/schema.js';
import type { GroundingMissReason } from '#core/errors/grounding-miss-reason.js';
import type { GroundingUnresolvedError } from '#core/errors/grounding-unresolved-error.js';
import { SNAPSHOT_INVALID } from '#core/ir/aria-snapshot.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { createFakeSecretsProvider } from '../../doubles/fake-secrets-provider.js';
import { createFixedClock } from '../../doubles/create-fixed-clock.js';
import { elementRefKey } from '../../doubles/fake-browser-session.js';
import { assertDiagnosable, assertNoSecretDisclosure, assertZeroAiCalls } from '../../support/report-assertions.js';
import { DEFAULT_OPTIONS, EMAIL, PASSWORD, FINGERPRINT, createScenario, createFakeBrowserSession, liveEntries, seedFreshArtifacts, writePrompt, elementGrounding, intentDigestsFor, aiStep, type TestStep } from '../../support/run-scenario.js';

const span = { startLine: 3, startColumn: 1, endLine: 3, endColumn: 56 };
const intent = { description: 'Submit control', sourceSpan: span, roleHint: 'button' as const };
const proposal = { outcome: 'found' as const, role: 'button', name: 'Submit' };
const triple = { proposalOutcome: 'found', proposalRole: 'button', proposalName: 'Submit' };
const hint = 'Quote the UI text in the prompt or run `ambercast heal` to update the binding.';
const replayHint = 'Run `ambercast run --resolve` to allow AI resolution for grounding misses.';
type Proposal = { outcome: 'none' | 'ambiguous' } | typeof proposal;
type Node = { role: string; name: string; children: Node[] };
const node = (role = 'button', name = 'Submit'): Node => ({ role, name, children: [] });

async function fixture(options: {
  proposal?: Proposal;
  nodes?: Node[];
  quoted?: boolean;
  roleHint?: 'button' | 'textbox';
  verification?: GroundingMissReason;
  captures?: readonly string[];
  secret?: string;
  invalid?: boolean;
} = {}) {
  const answer = options.proposal ?? proposal;
  const session = createFakeBrowserSession(liveEntries([EMAIL, PASSWORD]), {
    captureValues: new Map([[elementRefKey(EMAIL), { text: options.captures?.[0] ?? '', value: '' }]]),
  });
  let captureIndex = 0;
  if (options.captures) vi.spyOn(session, 'captureValue').mockImplementation(async () => options.captures![captureIndex++]!);
  const snapshot = vi.spyOn(session, 'accessibilitySnapshot').mockResolvedValue({
    tree: options.invalid ? SNAPSHOT_INVALID : { role: 'root', name: '', children: options.nodes ?? [node()] },
    rawYaml: '- button "Submit"', scalarValues: [],
  });
  const sessionResolve = session.resolveGrounded.bind(session);
  const resolve = vi.spyOn(session, 'resolveGrounded');
  if (options.verification) resolve.mockImplementation(async (ref, query) => {
    if (ref.role === 'textbox') return sessionResolve(ref, query);
    return { kind: 'miss', reason: options.verification! };
  });
  const executor = createFakeAiExecutor({ execute: () => ({ data: { proposal: answer }, raw: JSON.stringify({ proposal: answer }) }) });
  const clock = createFixedClock(new Date('2026-11-20T00:00:00Z'), 0);
  const f = createScenario({
    clock,
    uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
    resolveAiExecutor: vi.fn(async () => executor),
    secrets: createFakeSecretsProvider(new Map(options.secret ? [['{{secrets.credential}}', options.secret]] : [])),
  });
  const testPath = await writePrompt(f.recordingStorage.storage);
  const prelude: TestStep[] = (options.captures ?? []).map((_, i) => ({
    id: `capture-${i}`, kind: 'capture', intent: { ...intent, roleHint: 'textbox' }, variable: `value${i}`,
  }));
  if (options.secret) prelude.push({ id: 'fill-secret', kind: 'action', action: 'fill-secret', intent: { ...intent, roleHint: 'textbox' }, secretRef: '{{secrets.credential}}' });
  const step: TestStep = { id: 'bind', kind: 'action', action: 'click', intent: {
    ...intent, sourceSpan: { ...span, ...(options.quoted ? { endColumn: 28 } : {}) }, roleHint: options.roleHint ?? 'button',
    ...(options.quoted ? { quote: { text: 'Submit', sourceSpan: { startLine: 3, startColumn: 8, endLine: 3, endColumn: 14 } } } : {}),
  } };
  // A quote must be backed by the literal source text, even in a fake browser.
  if (options.quoted) await f.recordingStorage.storage.writeText(testPath, '# Sign in\n\nClick "Submit" to continue.\n');
  const locators = Object.fromEntries(prelude.map(s => [s.id, s.id === 'fill-secret' ? PASSWORD : EMAIL]));
  await seedFreshArtifacts(f.recordingStorage.storage, testPath, [...prelude, step], elementGrounding(prelude.map(s => s.id), locators, FINGERPRINT, intentDigestsFor(prelude)));
  return { ...f, session, snapshot, resolve, executor, testPath, clock };
}

function report(outcome: Awaited<ReturnType<typeof run>>) {
  const built = buildRunReport({ startedAt: '2026-11-20T00:00:00Z', durationMs: 0, options: { allowEmpty: false, list: false }, outcome });
  assertDiagnosable(built.envelope);
  return built;
}

async function expectFailure(f: Awaited<ReturnType<typeof fixture>>, details: Record<string, unknown>, message: string, aiCalls: number) {
  const outcome = await run(f.deps, DEFAULT_OPTIONS);
  const built = report(outcome);
  expect(f.executor.structuredRequests).toHaveLength(aiCalls);
  expect(f.executor.agenticRequests).toHaveLength(0);
  expect(f.session.operations().filter(op => op.type === 'perform')).toEqual([]);
  expect(built.exitCode).toBe(4);
  expect(outcome.results[0]?.error?.message).toBe(message);
  const error = built.envelope.errors.find(e => e.code === 'GROUNDING_UNRESOLVED');
  expect(error).toMatchObject({ message, hint });
  expect.soft(error?.details).toEqual({ stepId: 'bind', ...details });
  expect(GroundingUnresolvedDetails.safeParse(error?.details).success).toBe(true);
  return built;
}

describe('TEST-DIAG-1 binding stop evidence', () => {
  it.each(['none', 'ambiguous'] as const)('preserves the %s proposal outcome alone', async outcome => {
    const f = await fixture({ proposal: { outcome } });
    await expectFailure(f, { reason: outcome === 'none' ? 'no-candidate' : 'ambiguous', proposalOutcome: outcome }, 'No unique element binding proposal was returned.', 1);
    expect(f.snapshot).toHaveBeenCalledTimes(3);
    expect(f.clock.sleepCalls).toEqual([100]);
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it.each([0, 2, 3])('reports exactly %i proposal matches', async count => {
    const f = await fixture({ nodes: Array.from({ length: count }, () => node()) });
    await expectFailure(f, { reason: 'proposal-rejected', ...triple, rejection: 'not-unique', proposalMatchCount: count }, 'The proposed element was not uniquely present in the selected snapshot.', 1);
    expect(f.snapshot).toHaveBeenCalledTimes(3);
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it('retains an empty proposal name', async () => {
    await expectFailure(await fixture({ proposal: { ...proposal, name: '' }, nodes: [] }), { reason: 'proposal-rejected', ...triple, proposalName: '', rejection: 'not-unique', proposalMatchCount: 0 }, 'The proposed element was not uniquely present in the selected snapshot.', 1);
  });

  it.each([false, true])('reports unavailable fingerprints with quoted=%s', async quoted => {
    const f = await fixture({ quoted, nodes: [node(), node('text', '\ud800')] });
    await expectFailure(f, { reason: 'proposal-rejected', rejection: 'fingerprint-unavailable', ...(quoted ? {} : triple) }, 'The selected element could not be verified locally.', quoted ? 0 : 1);
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it('reports a role mismatch using the original proposal', async () => {
    await expectFailure(await fixture({ roleHint: 'textbox' }), { reason: 'proposal-rejected', ...triple, rejection: 'role-mismatch' }, 'The selected element could not be verified locally.', 1);
  });

  it.each(['fingerprint-unavailable', 'role-mismatch'] as const)('retains the raw proposal strings after normalized matching for %s', async rejection => {
    // Only name whitespace differs: role matching deliberately remains exact.
    const rawProposal = { ...proposal, name: ' \tSubmit \n' };
    const f = await fixture({
      proposal: rawProposal,
      ...(rejection === 'role-mismatch'
        ? { roleHint: 'textbox' as const }
        : { nodes: [node(), node('text', '\ud800')] }),
    });
    await expectFailure(f, {
      reason: 'proposal-rejected', proposalOutcome: rawProposal.outcome,
      proposalRole: rawProposal.role, proposalName: rawProposal.name, rejection,
    }, 'The selected element could not be verified locally.', 1);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.snapshot).toHaveBeenCalledTimes(3);
    expect(f.clock.sleepCalls).toEqual([100]);
  });

  it('retains the raw proposal strings after normalized matching when the candidate changes', async () => {
    const rawProposal = { ...proposal, name: ' \tSubmit \n' };
    const f = await fixture({ proposal: rawProposal, verification: 'fingerprint-mismatch' });
    await expectFailure(f, {
      reason: 'candidate-changed', verification: 'fingerprint-mismatch',
      proposalOutcome: rawProposal.outcome, proposalRole: rawProposal.role, proposalName: rawProposal.name,
    }, 'The selected element changed before the operation.', 1);
    expect(f.resolve).toHaveBeenCalledTimes(1);
    expect(f.snapshot).toHaveBeenCalledTimes(3);
    expect(f.clock.sleepCalls).toEqual([100]);
  });

  it('prioritizes an unavailable fingerprint over an AI-proposed role mismatch before reobservation', async () => {
    const rawProposal = { ...proposal, name: ' \tSubmit \n' };
    const f = await fixture({
      proposal: rawProposal, roleHint: 'textbox', nodes: [node(), node('text', '\ud800')],
    });
    await expectFailure(f, {
      reason: 'proposal-rejected', rejection: 'fingerprint-unavailable',
      proposalOutcome: rawProposal.outcome, proposalRole: rawProposal.role, proposalName: rawProposal.name,
    }, 'The selected element could not be verified locally.', 1);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.snapshot).toHaveBeenCalledTimes(3);
    expect(f.clock.sleepCalls).toEqual([100]);
  });

  it.each([false, true].flatMap(quoted => (['fingerprint-mismatch', 'element-not-found', 'ambiguous-match', 'snapshot-invalid', 'secret-contaminated'] as const).map(verification => ({ quoted, verification }))))('retains $verification evidence with quoted=$quoted', async ({ quoted, verification }) => {
      const f = await fixture({ quoted, verification });
      await expectFailure(f, { reason: 'candidate-changed', verification, ...(quoted ? {} : triple) }, 'The selected element changed before the operation.', quoted ? 0 : 1);
      expect(f.resolve).toHaveBeenCalledTimes(1);
      // Failure evidence adds one observation after binding has stopped.
      expect(f.snapshot).toHaveBeenCalledTimes(quoted ? 2 : 3);
      expect(f.clock.sleepCalls).toEqual(quoted ? [] : [100]);
  });

  it('builds defensive invalid-snapshot diagnostics without a match count', () => {
    const builder = (runModule as unknown as { buildProposalDiagnostics?: (proposal: Proposal, matches: { kind: 'snapshot-invalid' }) => Record<string, unknown> }).buildProposalDiagnostics;
    expect(builder, 'The diagnostic builder must expose the defensive snapshot-invalid branch.').toBeTypeOf('function');
    expect(builder!(proposal, { kind: 'snapshot-invalid' })).toEqual({ ...triple, rejection: 'snapshot-invalid' });
  });

  it('keeps the verification schema vocabulary identical to browser misses', () => {
    expectTypeOf<NonNullable<ReturnType<typeof GroundingUnresolvedDetails.parse>['verification']>>().toEqualTypeOf<GroundingMissReason>();
    expect(GroundingUnresolvedDetails.shape.verification.unwrap().options).toEqual(['fingerprint-mismatch', 'element-not-found', 'ambiguous-match', 'snapshot-invalid', 'secret-contaminated']);
    expect(GroundingUnresolvedDetails.safeParse({ stepId: 'bind', reason: 'candidate-changed', verification: 'missing' }).success).toBe(false);
  });
});

describe('TEST-DIAG-2 unchanged grounding failures', () => {
  it('retains the reason vocabulary', () => {
    expect(GroundingUnresolvedDetails.shape.reason.options).toEqual(['missing', 'recoverable-miss', 'no-candidate', 'ambiguous', 'proposal-rejected', 'candidate-changed']);
  });

  it('keeps covered AI trace replay misses free of proposal diagnostics', async () => {
    const session = createFakeBrowserSession(new Map(), { assertOutcome: { passed: false, message: 'Dashboard is absent.' } });
    const f = createScenario({ uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)) });
    const path = await writePrompt(f.recordingStorage.storage);
    await seedFreshArtifacts(f.recordingStorage.storage, path, [aiStep('bind')], { bind: { kind: 'ai', trace: {
      events: [], verification: [{ type: 'assert', check: 'text-visible', text: 'Dashboard' }], verificationCoverage: { 'dashboard-reached': 0 },
    } } });
    const deps = { ...f.deps, config: { ...f.deps.config, targets: { web: { ...f.deps.config.targets.web!, resolveTimeoutMs: 0 } } } };
    const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve: false });
    expect(outcome.results[0]?.error).toMatchObject({ message: 'AI trace replay missed because AI resolution is not permitted. Pass --resolve to permit resolution.', details: { stepId: 'bind', reason: 'recoverable-miss' } });
    expect(outcome.results[0]?.error?.details).toEqual({ stepId: 'bind', reason: 'recoverable-miss' });
    const built = report(outcome);
    expect(built.exitCode).toBe(4);
    expect(built.envelope.errors[0]).toMatchObject({ hint: replayHint, details: { stepId: 'bind', reason: 'recoverable-miss' } });
    assertZeroAiCalls(built.envelope);
    expect(f.resolveAiExecutor).not.toHaveBeenCalled();
    expect(session.operations().filter(op => op.type === 'evaluate-assert')).toHaveLength(1);
  });
  it.each(['missing', 'recoverable-miss'] as const)('reports %s details for element and AI steps', async reason => {
    for (const ai of [false, true]) {
      const f = createScenario();
      const path = await writePrompt(f.recordingStorage.storage);
      const steps: TestStep[] = ai ? [aiStep('bind')] : [{ id: 'bind', kind: 'action', action: 'click', intent }];
      const entries = reason === 'recoverable-miss' && !ai ? elementGrounding(['bind'], {}, FINGERPRINT, intentDigestsFor(steps)) : {};
      await seedFreshArtifacts(f.recordingStorage.storage, path, steps, entries);
      if (ai && reason === 'recoverable-miss') {
        await seedFreshArtifacts(f.recordingStorage.storage, path, steps, { bind: { kind: 'ai', trace: { events: [], verification: [{ type: 'assert', check: 'text-visible', text: 'Dashboard' }] } } });
      }
      const outcome = await run(f.deps, { ...DEFAULT_OPTIONS, resolve: false });
      const built = report(outcome);
      const details = { stepId: 'bind', reason, ...(!ai && reason === 'recoverable-miss' ? { verification: 'element-not-found' } : {}) };
      expect(outcome.results[0]?.error?.details).toEqual(details);
      expect(outcome.results[0]?.error?.message).toBe(ai
        ? reason === 'missing'
          ? 'AI-directed replay has no covered trace because AI resolution is not permitted. Pass --resolve to permit resolution.'
          : 'AI-directed replay has no covered trace because AI resolution is not permitted. Pass --resolve to permit resolution.'
        : reason === 'missing'
          ? 'No grounding is stored for this locator.'
          : 'The stored grounding for this locator has no matching element on the current page.');
      expect(built.exitCode).toBe(4);
      expect(built.envelope.errors[0]).toMatchObject({ code: 'GROUNDING_UNRESOLVED', hint: replayHint, details });
      expect(f.resolveAiExecutor).not.toHaveBeenCalled();
      assertZeroAiCalls(built.envelope);
    }
  });

  it.each(['missing', 'recoverable-miss', 'no-candidate', 'ambiguous', 'proposal-rejected', 'candidate-changed'])('accepts 3.11 details for %s', reason => {
    expect(GroundingUnresolvedDetails.parse({ stepId: 'bind', reason })).toEqual({ stepId: 'bind', reason });
  });

  it('aborts wholly invalid snapshots before asking AI', async () => {
    const f = await fixture({ invalid: true });
    const outcome = await run(f.deps, DEFAULT_OPTIONS);
    expect(outcome.results[0]?.error).toMatchObject({ kind: 'case-aborted', details: { reason: 'grounding-snapshot-invalid', stepId: 'bind' } });
    expect(report(outcome).exitCode).toBe(3);
    expect(f.executor.structuredRequests).toHaveLength(0);
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it('retains the secret-contaminated classification abort before candidate verification', async () => {
    const secret = 'diagnostic-secret-634f';
    const f = await fixture({ secret, nodes: [node(), node('text', secret)] });
    const outcome = await run(f.deps, DEFAULT_OPTIONS);
    expect(outcome.results[0]?.error).toMatchObject({ kind: 'case-aborted', details: { reason: 'grounding-secret-contaminated', stepId: 'bind' } });
    const built = report(outcome);
    expect(built.exitCode).toBe(3);
    expect(f.executor.structuredRequests).toHaveLength(1);
    expect(f.resolve).toHaveBeenCalledTimes(1);
    assertNoSecretDisclosure({ secrets: { credential: secret }, report: built.envelope });
  });
});

describe('TEST-DIAG-3 redacted proposal diagnostics', () => {
  it.each(['fingerprint-unavailable', 'role-mismatch'] as const)('preserves the %s rejection when captured verbatim', async rejection => {
    const f = await fixture({ captures: [rejection], ...(rejection === 'role-mismatch' ? { roleHint: 'textbox' as const } : { nodes: [node(), node('text', '\ud800')] }) });
    await expectFailure(f, { reason: 'proposal-rejected', ...triple, rejection }, 'The selected element could not be verified locally.', 1);
  });

  it('preserves a numeric match count when its decimal form was captured', async () => {
    const f = await fixture({ captures: ['2'], nodes: [node(), node()] });
    await expectFailure(f, { reason: 'proposal-rejected', ...triple, rejection: 'not-unique', proposalMatchCount: 2 }, 'The proposed element was not uniquely present in the selected snapshot.', 1);
  });

  it('preserves the none vocabulary when captured verbatim', async () => {
    await expectFailure(await fixture({ captures: ['none'], proposal: { outcome: 'none' } }), { reason: 'no-candidate', proposalOutcome: 'none' }, 'No unique element binding proposal was returned.', 1);
  });

  it('keeps the existing step identifier redaction', async () => {
    const f = await fixture({ captures: ['bind'], proposal: { outcome: 'none' } });
    const built = report(await run(f.deps, DEFAULT_OPTIONS));
    expect(built.envelope.errors[0]).toMatchObject({ hint, details: { stepId: '{{run.value0}}', reason: 'no-candidate' } });
  });

  it('keeps the existing reason redaction and its schema projection', async () => {
    const f = await fixture({ captures: ['proposal-rejected'], nodes: [] });
    const built = report(await run(f.deps, DEFAULT_OPTIONS));
    expect(built.envelope.errors[0]).toMatchObject({ code: 'GROUNDING_UNRESOLVED', hint: replayHint });
    expect(built.envelope.errors[0]).not.toHaveProperty('details');
  });
  it.each(['proposalName', 'proposalRole'])('preserves fixed keys when a resolved secret equals %s', async secret => {
    const f = await fixture({ secret, nodes: [], proposal: { ...proposal, role: `role ${secret}`, name: `name ${secret}` } });
    const built = report(await run(f.deps, DEFAULT_OPTIONS));
    const error = built.envelope.errors.find(e => e.code === 'GROUNDING_UNRESOLVED');
    expect(error).toMatchObject({ hint });
    expect(error?.details).toEqual({ stepId: 'bind', reason: 'proposal-rejected', proposalOutcome: 'found', proposalRole: 'role {{secrets.credential}}', proposalName: 'name {{secrets.credential}}', proposalMatchCount: 0, rejection: 'not-unique' });
    expect(GroundingUnresolvedDetails.safeParse(error?.details).success).toBe(true);
    const details = error?.details as GroundingUnresolvedError['details'];
    assertNoSecretDisclosure({ secrets: { credential: secret }, report: [details?.proposalRole, details?.proposalName] });
  });

  it.each(['found', 'verification', 'fingerprint-mismatch', 'element-not-found', 'ambiguous-match', 'snapshot-invalid', 'secret-contaminated'] as const)('keeps verification evidence when a capture equals %s', async value => {
    const verification = value === 'found' || value === 'verification' ? 'fingerprint-mismatch' : value;
    const f = await fixture({ captures: [value], verification });
    const built = report(await run(f.deps, DEFAULT_OPTIONS));
    const error = built.envelope.errors.find(e => e.code === 'GROUNDING_UNRESOLVED');
    expect(error).toMatchObject({ hint });
    expect(error?.details).toEqual({ stepId: 'bind', reason: 'candidate-changed', ...triple, verification });
    expect(GroundingUnresolvedDetails.safeParse(error?.details).success).toBe(true);
  });
  it.each(['proposalName', 'proposalRole', 'proposalOutcome', 'proposalMatchCount', 'rejection', 'verification', 'found', 'not-unique'])('preserves diagnostic keys and vocabulary when a capture equals %s', async value => {
    const f = await fixture({ captures: [value], proposal: { ...proposal, role: `role ${value}`, name: `name ${value}` }, nodes: [] });
    const outcome = await run(f.deps, DEFAULT_OPTIONS);
    const built = report(outcome);
    const error = built.envelope.errors.find(e => e.code === 'GROUNDING_UNRESOLVED');
    expect(error).toMatchObject({ hint });
    expect(error?.details).toEqual({ stepId: 'bind', reason: 'proposal-rejected', proposalOutcome: 'found', proposalRole: 'role {{run.value0}}', proposalName: 'name {{run.value0}}', proposalMatchCount: 0, rejection: 'not-unique' });
    expect(GroundingUnresolvedDetails.safeParse(error?.details).success).toBe(true);
    // Fixed keys and closed vocabulary deliberately retain these words; scan
    // only the free-text values for this collision-specific disclosure check.
    const details = error?.details as GroundingUnresolvedError['details'];
    assertNoSecretDisclosure({ secrets: { captured: value }, report: [details?.proposalRole, details?.proposalName] });
  });

  it('redacts a resolved secret and captured value in both proposal strings', async () => {
    const secret = 'diagnostic-secret-634f';
    const captured = 'diagnostic-capture-b731';
    const f = await fixture({ secret, captures: [captured], nodes: [], proposal: { ...proposal, role: `role ${secret} ${captured}`, name: `name ${secret} ${captured}` } });
    const built = report(await run(f.deps, DEFAULT_OPTIONS));
    const error = built.envelope.errors.find(e => e.code === 'GROUNDING_UNRESOLVED');
    expect(error).toMatchObject({ hint, details: { proposalRole: 'role {{secrets.credential}} {{run.value0}}', proposalName: 'name {{secrets.credential}} {{run.value0}}', proposalOutcome: 'found', rejection: 'not-unique', proposalMatchCount: 0 } });
    expect(GroundingUnresolvedDetails.safeParse(error?.details).success).toBe(true);
    assertNoSecretDisclosure({ secrets: { credential: secret, captured }, report: built.envelope });
  });
});
