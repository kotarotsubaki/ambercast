import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generate } from '#usecases/generate.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { reportError } from '#report/error-mapping.js';
import type { GeneratedPlanResponse } from '#core/ir/schema.js';
import { CONFIRMS_LIVE_CASES, CONFIRMS_LIVE_ATTEMPTS, CONFIRMS_LIVE_MIN_PASSES, runConfirmsLiveAttempts, scoreConfirmsLiveCase, matchesConfirmsLiveCase } from '../../support/confirms-live-check.js';
import { loadCorpus } from '../../support/corpus.js';
import { createScenario } from '../../support/generate-scenario.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';

vi.mock('#usecases/generate.js', { spy: true });
vi.mock('../../support/generate-scenario.js', { spy: true });

const { generate: realGenerate } = await vi.importActual<typeof import('#usecases/generate.js')>('#usecases/generate.js');

function positiveResponse(): GeneratedPlanResponse {
  const line = CONFIRMS_LIVE_CASES.P;
  const intent = (description: string) => ({
    description, roleHint: 'textbox', startAnchor: 'L3', startColumn: 1,
    endAnchor: 'L3', endColumn: line.length + 1, citation: line,
  });
  return { steps: [
    { id: 'open', kind: 'action', action: 'navigate', target: 'web', url: '/sign-in' },
    { id: 'fill-username', kind: 'action', action: 'fill', target: 'web', intent: intent('Username field'), value: 'verifier' },
    { id: 'fill-password', kind: 'action', action: 'fill-secret', target: 'web', intent: intent('Password field'), secret: { nameHint: 'password' } },
    { id: 'verify-user', kind: 'assert', check: 'text-visible', target: 'web', text: 'Signed in as verifier', confirms: ['fill-username', 'fill-password'] },
  ], ambiguities: [] };
}

function positiveExecutor() {
  return createFakeAiExecutor({ execute: async () => {
    const data = positiveResponse();
    return { data, raw: JSON.stringify(data) };
  } });
}


const recordSchema = z.strictObject({
  prompt: z.enum(['P', 'N1', 'N2', 'N3']),
  attempt: z.number().int().min(1),
  status: z.string().nullable(),
  aiCalls: z.number().nullable(),
  errorCode: z.string().nullable(),
  cause: z.enum(['ok', 'selection', 'identity', 'generation']),
  assertId: z.string().nullable(),
  confirms: z.array(z.string()),
  fillIds: z.array(z.string()),
});
type AttemptRecord = z.infer<typeof recordSchema>;
type Attempts = { records: readonly AttemptRecord[]; passes: number };

async function runAttempts(executor: ReturnType<typeof positiveExecutor>): Promise<Attempts> {
  return runConfirmsLiveAttempts(executor, 'P');
}

// Validate the denominator and record contract even in tests centered on failures.
async function runAndCheck(
  executor: ReturnType<typeof positiveExecutor>,
  failure?: { failedAttempt?: number; cause: AttemptRecord['cause']; status: string | null; aiCalls: number | null; errorCode?: string },
): Promise<number> {
  const { records, passes } = await runAttempts(executor);
  expect(records).toHaveLength(9);
  expect(passes).toBe(records.filter(record => record.cause === 'ok').length);
  for (const [index, record] of records.entries()) {
    expect(recordSchema.safeParse(record).success).toBe(true);
    expect(record).toMatchObject({ prompt: 'P', attempt: index + 1 });
    const failed = failure !== undefined && (failure.failedAttempt === undefined || failure.failedAttempt === index + 1);
    expect(record).toMatchObject(failed ? {
      cause: failure.cause, status: failure.status, aiCalls: failure.aiCalls, errorCode: failure.errorCode ?? null,
    } : { cause: 'ok', status: 'generated', aiCalls: 1, errorCode: null,
      assertId: 'verify-user', confirms: ['fill-username', 'fill-password'], fillIds: expect.arrayContaining(['fill-username', 'fill-password']) });
    if (!failed) expect(record.fillIds).toHaveLength(2);
    if (failed && failure.cause === 'generation') {
      expect(record).toMatchObject({ assertId: null, confirms: [], fillIds: [] });
      if (failure.status !== 'failed') expect(record.errorCode).toBeNull();
    }
  }
  return passes;
}

const schemas = {
  value: z.object({
    name: z.enum(['P', 'N1', 'N2', 'N3']),
    steps: z.array(z.object({
      id: z.string(),
      kind: z.string(),
      action: z.string().optional(),
      value: z.string().optional(),
      check: z.string().optional(),
      text: z.string().optional(),
      intent: z.object({ quote: z.object({ text: z.string() }).passthrough().optional() }).passthrough().optional(),
      confirms: z.array(z.string()).optional(),
    })),
  }),
  expected: z.enum(['ok', 'selection', 'identity']),
};

describe('Issue #598 TEST-11 deterministic live-check scoring', () => {
  it.each(Object.keys(CONFIRMS_LIVE_CASES) as (keyof typeof CONFIRMS_LIVE_CASES)[])('uses the registered sign-in path for %s', (name) => {
    expect(CONFIRMS_LIVE_CASES[name].startsWith('Open the sign-in page at /sign-in.')).toBe(true);
  });

  it('returns evidence only from the uniquely identified required assertion', () => {
    const steps = [
      { id: 'username', kind: 'action', action: 'fill', value: 'verifier' },
      { id: 'password', kind: 'action', action: 'fill-secret' },
      { id: 'requested', kind: 'assert', check: 'text-visible', text: 'Signed in as verifier', confirms: ['username'] },
      { id: 'other', kind: 'assert', check: 'text-visible', text: 'Other state', confirms: ['password'] },
    ];
    const score = scoreConfirmsLiveCase('P', steps);
    expect(score).toEqual({
      cause: 'selection', assertId: 'requested', confirms: ['username'], fillIds: expect.arrayContaining(['username', 'password']),
    });
    expect(score.fillIds).toHaveLength(2);
  });

  it('omits assertId and returns empty confirms when no required assertion exists', () => {
    expect(scoreConfirmsLiveCase('N2', [
      { id: 'search', kind: 'action', action: 'fill', value: 'verifier' },
    ])).toEqual({ cause: 'identity', confirms: [], fillIds: ['search'] });
  });

  it('retains assertion evidence when required-input cardinality fails', () => {
    expect(scoreConfirmsLiveCase('P', [
      { id: 'username', kind: 'action', action: 'fill', value: 'verifier' },
      { id: 'requested', kind: 'assert', check: 'text-visible', text: 'Signed in as verifier', confirms: ['username'] },
    ])).toEqual({ cause: 'identity', assertId: 'requested', confirms: ['username'], fillIds: ['username'] });
  });

  // Cardinality failures must not pass negative cases through an empty evidence set.
  it.each(loadCorpus(new URL('../../fixtures/corpus/confirms/live-check.jsonl', import.meta.url), schemas))('line $line: $note', (entry) => {
    const score = scoreConfirmsLiveCase(entry.value.name, entry.value.steps);
    expect(score.cause).toBe(entry.expected);
    expect(matchesConfirmsLiveCase(entry.value.name, entry.value.steps)).toBe(score.cause === 'ok');
  });
});

describe('Issue #598 TEST-11 independent generation attempts', () => {
  beforeEach(() => {
    vi.stubEnv('AMBERCAST_CONFIRMS_LIVE_LOG', undefined);
    vi.clearAllMocks();
    vi.mocked(generate).mockImplementation(realGenerate);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('counts eight successes and one identity failure from nine isolated requests', async () => {
    let calls = 0;
    const executor = createFakeAiExecutor({ execute: async () => {
      const data = positiveResponse();
      calls += 1;
      if (calls === 2) {
        const assertion = data.steps.find(step => step.id === 'verify-user');
        if (assertion?.kind === 'assert' && assertion.check === 'text-visible') assertion.text = 'Unrelated state';
      }
      return { data, raw: JSON.stringify(data) };
    } });

    expect(await runAndCheck(executor, { failedAttempt: 2, cause: 'identity', status: 'generated', aiCalls: 1 })).toBe(8);
    expect(executor.structuredRequests).toHaveLength(9);
    expect(generate).toHaveBeenCalledTimes(9);
    expect(createScenario).toHaveBeenCalledTimes(9);
    const scenarios = vi.mocked(createScenario).mock.results.map(result => result.value as ReturnType<typeof createScenario>);
    expect(new Set(scenarios.map(scenario => scenario.deps.storage)).size).toBe(9);
    for (const scenario of scenarios) {
      const planPath = scenario.deps.layout.planPathFor('/workspace/tests/login.test.md');
      expect(scenario.recordingStorage.exists.filter(path => path === planPath)).toHaveLength(1);
      expect(scenario.recordingStorage.writes.filter(write => write.path === planPath)).toHaveLength(1);
      expect(scenario.recordingStorage.reads.filter(path => path === planPath)).toHaveLength(1);
    }
    // Distinct adapters alone would not expose a shared backing store.
    await scenarios[0]!.deps.storage.writeText('/workspace/tests/isolation-marker', 'first attempt');
    for (const scenario of scenarios.slice(1)) {
      expect(await scenario.deps.storage.exists('/workspace/tests/isolation-marker')).toBe(false);
    }
    for (const call of vi.mocked(generate).mock.calls) {
      expect(call[0].config.ai.timeoutMs).toBe(300_000);
      expect(call[0].config.secrets).toEqual({ allow: '*' });
      expect(Object.keys(call[0].config.targets)).toEqual(['web']);
      expect(call[1]).toMatchObject({ maxAttempts: 2 });
    }
  });

  it.each(['failed', 'skipped-fresh', 'would-generate', 'listed', 'skipped'] as const)('does not score a matching plan with status %s', async (status) => {
    const planReads: ReturnType<typeof vi.spyOn>[] = [];
    vi.mocked(generate).mockImplementation(async (deps, options) => {
      const outcome = await realGenerate(deps, options);
      planReads.push(vi.spyOn(deps.storage, 'readText'));
      return { ...outcome, results: outcome.results.map(result => ({ ...result, status })) };
    });
    const executor = positiveExecutor();
    expect(await runAndCheck(executor, { cause: 'generation', status, aiCalls: 1 })).toBe(0);
    expect(executor.structuredRequests).toHaveLength(9);
    expect(generate).toHaveBeenCalledTimes(9);
    expect(planReads).toHaveLength(9);
    for (const read of planReads) expect(read).not.toHaveBeenCalled();
  });

  it.each([0, undefined])('does not score a matching generated plan with aiCalls=%s', async (aiCalls) => {
    const planReads: ReturnType<typeof vi.spyOn>[] = [];
    vi.mocked(generate).mockImplementation(async (deps, options) => {
      const outcome = await realGenerate(deps, options);
      planReads.push(vi.spyOn(deps.storage, 'readText'));
      return { ...outcome, results: outcome.results.map(({ aiCalls: _calls, ...result }) => ({ ...result, ...(aiCalls === undefined ? {} : { aiCalls }) })) };
    });
    const executor = positiveExecutor();
    expect(await runAndCheck(executor, { cause: 'generation', status: 'generated', aiCalls: aiCalls ?? null })).toBe(0);
    expect(executor.structuredRequests).toHaveLength(9);
    expect(planReads).toHaveLength(9);
    for (const read of planReads) expect(read).not.toHaveBeenCalled();
  });

  it('does not score an outcome without a result', async () => {
    vi.mocked(generate).mockImplementation(async (deps, options) => ({ ...await realGenerate(deps, options), results: [] }));
    const executor = positiveExecutor();
    expect(await runAndCheck(executor, { cause: 'generation', status: null, aiCalls: null })).toBe(0);
    expect(executor.structuredRequests).toHaveLength(9);
  });

  it.each(['missing plan', 'invalid JSON', 'invalid plan'] as const)('consumes %s without scoring it or abandoning later attempts', async (fault) => {
    let calls = 0;
    vi.mocked(generate).mockImplementation(async (deps, options) => {
      const outcome = await realGenerate(deps, options);
      calls += 1;
      if (calls === 2) {
        const readText = deps.storage.readText.bind(deps.storage);
        vi.spyOn(deps.storage, 'readText').mockImplementation(async path => {
          if (path === deps.layout.planPathFor(options.files[0]!)) {
            if (fault === 'missing plan') throw new Error('Plan is absent');
            return fault === 'invalid JSON' ? '{' : '{}';
          }
          return readText(path);
        });
      }
      return outcome;
    });
    const executor = positiveExecutor();
    expect(await runAndCheck(executor, { failedAttempt: 2, cause: 'generation', status: 'generated', aiCalls: 1 })).toBe(8);
    expect(executor.structuredRequests).toHaveLength(9);
    expect(generate).toHaveBeenCalledTimes(9);
  });

  it('consumes a thrown generation error and continues the remaining attempts', async () => {
    let calls = 0;
    vi.mocked(generate).mockImplementation(async (deps, options) => {
      const outcome = await realGenerate(deps, options);
      calls += 1;
      if (calls === 2) throw new Error('Generation failed after starting');
      return outcome;
    });
    const executor = positiveExecutor();
    expect(await runAndCheck(executor, { failedAttempt: 2, cause: 'generation', status: null, aiCalls: null })).toBe(8);
    expect(executor.structuredRequests).toHaveLength(9);
    expect(generate).toHaveBeenCalledTimes(9);
  });

  it('consumes both retryable provider errors in one failed attempt and continues later attempts', async () => {
    let calls = 0;
    const executor = createFakeAiExecutor({ execute: async () => {
      calls += 1;
      if (calls === 2 || calls === 3) throw new AiResponseInvalidError('Provider output is invalid');
      const data = positiveResponse();
      return { data, raw: JSON.stringify(data) };
    } });
    expect(await runAndCheck(executor, { failedAttempt: 2, cause: 'generation', status: 'failed', aiCalls: 2, errorCode: 'AI_RESPONSE_INVALID' })).toBe(8);
    expect(executor.structuredRequests).toHaveLength(10);
    expect(generate).toHaveBeenCalledTimes(9);
  });

  it('scores only the final positive plan after a retry succeeds within one attempt', async () => {
    let calls = 0;
    const executor = createFakeAiExecutor({ execute: async () => {
      calls += 1;
      if (calls === 1) throw new AiResponseInvalidError('Provider output is invalid');
      const data = positiveResponse();
      if (calls === 2) {
        const assertion = data.steps.find(step => step.id === 'verify-user');
        if (assertion?.kind === 'assert') assertion.id = 'verify-retried-user';
      }
      return { data, raw: JSON.stringify(data) };
    } });

    const { records, passes } = await runAttempts(executor);
    expect(records).toHaveLength(9);
    expect(records.map(record => record.attempt)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(passes).toBe(9);
    expect(passes).toBe(records.filter(record => record.cause === 'ok').length);
    expect(records[0]).toEqual({
      prompt: 'P', attempt: 1, status: 'generated', aiCalls: 2, errorCode: null,
      cause: 'ok', assertId: 'verify-retried-user',
      confirms: ['fill-username', 'fill-password'],
      fillIds: expect.arrayContaining(['fill-username', 'fill-password']),
    });
    expect(records[0]!.aiCalls).toBeGreaterThanOrEqual(2);
    for (const [index, record] of records.entries()) {
      expect(recordSchema.safeParse(record).success).toBe(true);
      expect(record.fillIds).toHaveLength(2);
      if (index > 0) expect(record).toMatchObject({
        status: 'generated', aiCalls: 1, cause: 'ok', errorCode: null, assertId: 'verify-user',
        confirms: ['fill-username', 'fill-password'],
      });
    }
    expect(executor.structuredRequests).toHaveLength(10);
    expect(executor.structuredRequests[1]!.context).toMatchObject({
      previousAttempts: [{ attempt: 1, code: 'AI_RESPONSE_INVALID', issues: [] }],
    });
    expect(generate).toHaveBeenCalledTimes(9);
    expect(createScenario).toHaveBeenCalledTimes(9);
    for (const call of vi.mocked(generate).mock.calls) expect(call[1].maxAttempts).toBe(2);
    const firstOutcome = await vi.mocked(generate).mock.results[0]!.value as Awaited<ReturnType<typeof generate>>;
    expect(firstOutcome.results[0]).toMatchObject({ status: 'generated', aiCalls: 2 });
    const scenarios = vi.mocked(createScenario).mock.results.map(result => result.value as ReturnType<typeof createScenario>);
    for (const scenario of scenarios) {
      const planPath = scenario.deps.layout.planPathFor('/workspace/tests/login.test.md');
      expect(scenario.recordingStorage.writes.filter(write => write.path === planPath)).toHaveLength(1);
      expect(scenario.recordingStorage.reads.filter(path => path === planPath)).toHaveLength(1);
    }
  });

  it('rejects a log write failure instead of counting it as a generation failure', async () => {
    const parent = join(tmpdir(), `ambercast-598-missing-${crypto.randomUUID()}`);
    const path = join(parent, 'attempts.jsonl');
    await expect(stat(parent)).rejects.toMatchObject({ code: 'ENOENT' });
    vi.stubEnv('AMBERCAST_CONFIRMS_LIVE_LOG', path);
    const executor = positiveExecutor();

    // Log I/O is fail-closed: losing the audit record must reject rather than consume a generation vote.
    await expect(runAttempts(executor)).rejects.toMatchObject({ code: 'ENOENT', path });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(createScenario).toHaveBeenCalledTimes(1);
    expect(executor.structuredRequests).toHaveLength(1);
    const outcome = await vi.mocked(generate).mock.results[0]!.value as Awaited<ReturnType<typeof generate>>;
    expect(outcome.results[0]).toMatchObject({ status: 'generated', aiCalls: 1 });
    await expect(stat(parent)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([5, 6])('counts %i ok records against the six-of-nine boundary', async (successes) => {
    let calls = 0;
    const executor = createFakeAiExecutor({ execute: async () => {
      const data = positiveResponse();
      calls += 1;
      if (calls > successes) {
        const assertion = data.steps.find(step => step.id === 'verify-user');
        if (assertion?.kind === 'assert') assertion.confirms = ['fill-username'];
      }
      return { data, raw: JSON.stringify(data) };
    } });
    const { records, passes } = await runAttempts(executor);
    expect(CONFIRMS_LIVE_ATTEMPTS).toBe(9);
    expect(CONFIRMS_LIVE_MIN_PASSES).toBe(6);
    expect(records).toHaveLength(9);
    expect(records.map(record => record.attempt)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(records.map(record => record.cause)).toEqual([
      ...Array.from({ length: successes }, () => 'ok'),
      ...Array.from({ length: 9 - successes }, () => 'selection'),
    ]);
    expect(passes).toBe(records.filter(record => record.cause === 'ok').length);
    expect(passes).toBe(successes);
    expect(passes >= CONFIRMS_LIVE_MIN_PASSES).toBe(successes === 6);
    expect(executor.structuredRequests).toHaveLength(9);
    for (const record of records) {
      expect(record).toMatchObject({ status: 'generated', aiCalls: 1, errorCode: null, assertId: 'verify-user' });
    }
  });

  it('keeps a nonretryable executor exception in the denominator with its public error code', async () => {
    let calls = 0;
    const executor = createFakeAiExecutor({ execute: async () => {
      calls += 1;
      if (calls === 2) throw new Error('Provider connection failed');
      const data = positiveResponse();
      return { data, raw: JSON.stringify(data) };
    } });
    const { records, passes } = await runAttempts(executor);
    expect(records).toHaveLength(9);
    expect(passes).toBe(8);
    expect(passes).toBe(records.filter(record => record.cause === 'ok').length);
    const outcome = await vi.mocked(generate).mock.results[1]!.value as Awaited<ReturnType<typeof generate>>;
    const error = outcome.results[0]!.error;
    expect(error).toBeDefined();
    expect(records[1]).toEqual({
      prompt: 'P', attempt: 2, status: 'failed', aiCalls: 1,
      errorCode: reportError(error!, { scope: 'case', caseId: 'login' }).code,
      cause: 'generation', assertId: null, confirms: [], fillIds: [],
    });
    expect(executor.structuredRequests).toHaveLength(9);
    expect(generate).toHaveBeenCalledTimes(9);
  });

  it('runs generations sequentially, with no overlapping provider calls', async () => {
    let active = 0;
    let peak = 0;
    const executor = createFakeAiExecutor({ execute: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      const data = positiveResponse();
      return { data, raw: JSON.stringify(data) };
    } });
    expect(await runAndCheck(executor)).toBe(9);
    expect(peak).toBe(1);
  });

  it.each([true, false])('writes only opt-in sanitized JSONL records (enabled=%s)', async (enabled) => {
    const directory = await mkdtemp(join(tmpdir(), 'ambercast-598-live-'));
    const path = join(directory, 'attempts.jsonl');
    const secret = 'task-e-password-never-log';
    const raw = 'TASK_E_PROVIDER_RAW_NEVER_LOG';
    vi.stubEnv('AMBERCAST_CONFIRMS_LIVE_LOG', enabled ? path : undefined);
    vi.stubEnv('AMBERCAST_SECRET_PASSWORD', secret);
    let calls = 0;
    const executor = createFakeAiExecutor({ execute: async () => {
      calls += 1;
      if (calls === 2 || calls === 3) {
        throw new AiResponseInvalidError('Invalid provider response', { details: { raw: raw + secret, issues: [] } });
      }
      return { data: positiveResponse(), raw: raw + secret };
    } });
    try {
      const { records, passes } = await runAttempts(executor);
      expect(records).toHaveLength(9);
      expect(records[1]).toMatchObject({ attempt: 2, cause: 'generation', status: 'failed', aiCalls: 2, errorCode: 'AI_RESPONSE_INVALID' });
      expect(passes).toBe(8);
      expect(passes).toBe(records.filter(record => record.cause === 'ok').length);
      if (!enabled) {
        await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
        return;
      }
      const text = await readFile(path, 'utf8');
      expect(text.endsWith('\n')).toBe(true);
      const lines = text.slice(0, -1).split('\n');
      expect(lines).toHaveLength(9);
      const logged = lines.map((line) => recordSchema.parse(JSON.parse(line)));
      expect(logged).toEqual(records);
      for (const record of logged) {
        expect(Object.keys(record).sort()).toEqual([
          'prompt', 'attempt', 'status', 'aiCalls', 'errorCode', 'cause', 'assertId', 'confirms', 'fillIds',
        ].sort());
      }
      expect(text).not.toContain(secret);
      expect(text).not.toContain(raw);
      // Logging appends rather than replacing an earlier run.
      await runAttempts(executor);
      expect((await readFile(path, 'utf8')).trimEnd().split('\n')).toHaveLength(18);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
