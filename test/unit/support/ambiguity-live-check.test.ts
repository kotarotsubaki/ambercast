import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generate } from '#usecases/generate.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { PromptAmbiguousError } from '#core/errors/prompt-ambiguous-error.js';
import { countAmbiguityLiveOutcomes, AMBIGUITY_LIVE_PROMPTS } from '../../support/ambiguity-live-check.js';
import { createScenario } from '../../support/generate-scenario.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';

vi.mock('#usecases/generate.js', { spy: true });
vi.mock('../../support/generate-scenario.js', { spy: true });
const { generate: realGenerate } = await vi.importActual<typeof import('#usecases/generate.js')>('#usecases/generate.js');
const executor = () => createFakeAiExecutor({ execute: async () => ({ data: { steps: [], ambiguities: [] }, raw: 'PRIVATE_PROVIDER_RAW' }) });
type GenerateOutcome = Awaited<ReturnType<typeof generate>>;

describe('SPEC-10 / TEST-10 independent ambiguity live checks', () => {
  beforeEach(() => {
    vi.stubEnv('AMBERCAST_AMBIGUITY_LIVE_LOG', undefined);
    vi.clearAllMocks();
    vi.mocked(generate).mockImplementation(realGenerate);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(['S', 'M'] as const)('runs nine sequential fresh generations with the registered %s configuration', async scenario => {
    let active = 0;
    let peak = 0;
    const fake = createFakeAiExecutor({ execute: async () => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active -= 1;
      return { data: { steps: [], ambiguities: [] }, raw: '' };
    } });
    const result = await countAmbiguityLiveOutcomes(fake, scenario);
    expect(result.records).toHaveLength(9);
    expect(result.records.map(record => record.attempt)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.generated).toBe(9);
    expect(result.passed).toBe(scenario === 'S');
    expect(fake.structuredRequests).toHaveLength(9);
    expect(peak).toBe(1);
    expect(createScenario).toHaveBeenCalledTimes(9);
    const scenarios = vi.mocked(createScenario).mock.results.map(result => result.value as ReturnType<typeof createScenario>);
    expect(new Set(scenarios.map(item => item.deps.storage)).size).toBe(9);
    await scenarios[0]!.deps.storage.writeText('/isolation', 'first');
    for (const item of scenarios.slice(1)) expect(await item.deps.storage.exists('/isolation')).toBe(false);
    for (const [deps, options] of vi.mocked(generate).mock.calls) {
      expect(options.maxAttempts).toBe(2);
      expect(deps.config.ai.timeoutMs).toBe(120_000);
      expect(deps.config.secrets).toEqual({ allow: '*' });
      expect(await deps.storage.readText(options.files[0]!)).toBe(`# Live ambiguity check\n\n${AMBIGUITY_LIVE_PROMPTS[scenario]}\n`);
      expect(Object.keys(deps.config.targets)).toEqual(scenario === 'S' ? ['web'] : ['admin', 'shop']);
      if (scenario === 'S') expect(deps.config.targets.web?.baseUrl).toBe('https://example.test');
      else {
        expect(Object.hasOwn(deps.config, 'defaultTarget')).toBe(false);
        expect(deps.config.targets.admin).toMatchObject({ baseUrl: 'https://admin.example.test', description: 'Administration console' });
        expect(deps.config.targets.shop).toMatchObject({ baseUrl: 'https://shop.example.test', description: 'Customer storefront' });
      }
    }
  });

  it.each([
    { path: ['ambiguities'], expected: 'ambiguity-failed' },
    { path: ['ambiguities', 0], expected: 'other-failed' },
    { path: ['steps'], expected: 'other-failed' },
    { path: ['steps', 0, 'target'], expected: 'other-failed' },
    { path: [], expected: 'other-failed' },
  ])('uses exact original issue path $path and stringifies only its log representation', async ({ path, expected }) => {
    const fake = createFakeAiExecutor({ execute: async () => {
      throw new AiResponseInvalidError('Invalid response', { raw: 'PRIVATE_PROVIDER_RAW', issues: [{ code: 'schema-mismatch', path }] });
    } });
    const result = await countAmbiguityLiveOutcomes(fake, 'S');
    expect(fake.structuredRequests).toHaveLength(18);
    expect(result.records).toHaveLength(9);
    for (const record of result.records) expect(record).toMatchObject({ outcome: expected, errorCode: 'AI_RESPONSE_INVALID', issuePaths: [path.map(String)], aiCalls: 2 });
    expect(result.passed).toBe(expected === 'other-failed');
    expect(result.promptAmbiguous).toBe(0);
  });

  it('classifies a single-target provider ambiguity as retry-exhausted AI_RESPONSE_INVALID', async () => {
    const fake = createFakeAiExecutor({ execute: async () => ({ data: { steps: [], ambiguities: ['Target cannot be determined'] }, raw: '' }) });
    const result = await countAmbiguityLiveOutcomes(fake, 'S');
    expect(fake.structuredRequests.length).toBeGreaterThanOrEqual(9);
    expect(result.ambiguityFailed).toBe(9);
    expect(result.passed).toBe(false);
    for (const record of result.records) expect(record).toMatchObject({ status: 'failed', errorCode: 'AI_RESPONSE_INVALID', issuePaths: [['ambiguities']], aiCalls: 2 });
    expect(fake.structuredRequests).toHaveLength(18);
  });

  it.each([5, 6])('requires six final PROMPT_AMBIGUOUS votes, with %i votes', async votes => {
    let calls = 0;
    const fake = createFakeAiExecutor({ execute: async () => ({ data: { steps: [], ambiguities: ++calls <= votes ? ['Unassigned target'] : [] }, raw: '' }) });
    const result = await countAmbiguityLiveOutcomes(fake, 'M');
    expect(fake.structuredRequests).toHaveLength(9);
    expect(result.promptAmbiguous).toBe(votes);
    expect(result.ambiguityFailed).toBe(votes);
    expect(result.generated).toBe(9 - votes);
    expect(result.passed).toBe(votes === 6);
  });

  it.each(['throw', 'missing row', 'scoring failure'] as const)('fails S closed on one %s and continues all later attempts', async fault => {
    let calls = 0;
    vi.mocked(generate).mockImplementation(async (deps, options) => {
      const result = await realGenerate(deps, options);
      if (++calls !== 2) return result;
      if (fault === 'throw') throw new Error('Generation failed');
      if (fault === 'missing row') return { ...result, results: [] };
      return { ...result, results: [{ ...result.results[0]!, status: 'failed', error: { get kind() { throw new Error('Classification failed'); } } }] } as unknown as GenerateOutcome;
    });
    const fake = executor();
    const result = await countAmbiguityLiveOutcomes(fake, 'S');
    expect(fake.structuredRequests).toHaveLength(9);
    expect(generate).toHaveBeenCalledTimes(9);
    expect(result.generated).toBe(8);
    expect(result.unscored).toBe(1);
    expect(result.records[1]?.outcome).toBe('unscored');
    expect(result.passed).toBe(false);
  });

  it('does not count unscored PROMPT_AMBIGUOUS metadata toward the M threshold', async () => {
    vi.mocked(generate).mockImplementation(async (deps, options) => {
      const result = await realGenerate(deps, options);
      return { ...result, results: [{ ...result.results[0]!, status: 'failed', error: new PromptAmbiguousError('Ambiguous', 1),
        warnings: { filter() { throw new Error('Scoring failed'); } } }] } as unknown as GenerateOutcome;
    });
    const fake = executor();
    const result = await countAmbiguityLiveOutcomes(fake, 'M');
    expect(fake.structuredRequests).toHaveLength(9);
    expect(result.unscored).toBe(9);
    expect(result.promptAmbiguous).toBe(0);
    expect(result.passed).toBe(false);
  });

  it('scores only the final result after a retry succeeds', async () => {
    let calls = 0;
    const fake = createFakeAiExecutor({ execute: async () => {
      if (++calls % 2 === 1) throw new AiResponseInvalidError('Retry', { issues: [{ code: 'schema-mismatch', path: ['ambiguities'] }] });
      return { data: { steps: [], ambiguities: [] }, raw: '' };
    } });
    const result = await countAmbiguityLiveOutcomes(fake, 'S');
    expect(fake.structuredRequests).toHaveLength(18);
    expect(result.generated).toBe(9);
    expect(result.ambiguityFailed).toBe(0);
    expect(result.passed).toBe(true);
    for (const record of result.records) expect(record).toMatchObject({ aiCalls: 2, errorCode: null, issuePaths: [] });
  });

  it('records non-ambiguity provider failures without failing S', async () => {
    const fake = createFakeAiExecutor({ execute: async () => { throw new Error('Provider connection failed'); } });
    const result = await countAmbiguityLiveOutcomes(fake, 'S');
    expect(fake.structuredRequests).toHaveLength(9);
    expect(result.otherFailed).toBe(9);
    expect(result.unscored).toBe(0);
    expect(result.passed).toBe(true);
    for (const record of result.records) {
      expect(record.status).toBe('failed');
      expect(record.errorCode).not.toBeNull();
      expect(record.errorCode).not.toBe('PROMPT_AMBIGUOUS');
    }
  });

  it('retains the executor provider identity without adding a signature argument', async () => {
    const fake = { ...executor(), name: 'claude-code-cli' as const };
    const result = await countAmbiguityLiveOutcomes(fake, 'S');
    expect(fake.structuredRequests).toHaveLength(9);
    for (const record of result.records) expect(record.provider).toBe('claude-code-cli');
  });

  it('logs error paths without raw output, error messages, or secret values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ambercast-600-error-'));
    const path = join(directory, 'attempts.jsonl');
    vi.stubEnv('AMBERCAST_AMBIGUITY_LIVE_LOG', path);
    const secret = 'PRIVATE_PASSWORD_NEVER_LOG';
    const fake = createFakeAiExecutor({ execute: async () => {
      throw new AiResponseInvalidError(secret, { raw: 'PRIVATE_PROVIDER_RAW', issues: [{ code: 'schema-mismatch', path: ['steps', 0, 'target'] }] });
    } });
    try {
      const result = await countAmbiguityLiveOutcomes(fake, 'S');
      expect(fake.structuredRequests).toHaveLength(18);
      expect(result.otherFailed).toBe(9);
      const text = await readFile(path, 'utf8');
      expect(text).not.toContain(secret);
      expect(text).not.toContain('PRIVATE_PROVIDER_RAW');
      expect(text.trimEnd().split('\n').map(line => JSON.parse(line))).toEqual(result.records);
      for (const record of result.records) expect(record.issuePaths).toEqual([['steps', '0', 'target']]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('rejects append failures immediately after the completed attempt', async () => {
    const path = join(tmpdir(), `ambercast-600-absent-${crypto.randomUUID()}`, 'attempts.jsonl');
    vi.stubEnv('AMBERCAST_AMBIGUITY_LIVE_LOG', path);
    const fake = executor();
    await expect(countAmbiguityLiveOutcomes(fake, 'S')).rejects.toMatchObject({ code: 'ENOENT', path });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(fake.structuredRequests).toHaveLength(1);
  });

  it.each([true, false])('appends exactly nine sanitized records only when opted in (enabled=%s)', async enabled => {
    const directory = await mkdtemp(join(tmpdir(), 'ambercast-600-live-'));
    const path = join(directory, 'attempts.jsonl');
    vi.stubEnv('AMBERCAST_AMBIGUITY_LIVE_LOG', enabled ? path : undefined);
    const secret = 'PRIVATE_PASSWORD_NEVER_LOG';
    vi.stubEnv('AMBERCAST_SECRET_PASSWORD', secret);
    let calls = 0;
    vi.mocked(generate).mockImplementation(async (deps, options) => {
      if (enabled && calls > 0) expect((await readFile(path, 'utf8')).trimEnd().split('\n')).toHaveLength(calls);
      calls += 1;
      const result = await realGenerate(deps, options);
      return { ...result, results: [{ ...result.results[0]!, warnings: [
        { kind: 'generator-assumption', message: secret },
        { kind: 'generator-assumption', message: 'PRIVATE_PROVIDER_RAW' },
        { kind: 'action-unconfirmed', stepId: 'fill' },
      ] }] } as unknown as GenerateOutcome;
    });
    try {
      const fake = executor();
      const result = await countAmbiguityLiveOutcomes(fake, 'S');
      expect(fake.structuredRequests).toHaveLength(9);
      expect(result.generated).toBe(9);
      expect(result.assumptionWarnings).toBe(18);
      expect(result.records).toHaveLength(9);
      if (!enabled) { await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' }); return; }
      const text = await readFile(path, 'utf8');
      expect(text.endsWith('\n')).toBe(true);
      expect(text.trimEnd().split('\n').map(line => JSON.parse(line))).toEqual(result.records);
      for (const record of result.records) expect(Object.keys(record).sort()).toEqual([
        'provider', 'scenario', 'attempt', 'outcome', 'status', 'errorCode', 'issuePaths', 'aiCalls', 'assumptionWarnings',
      ].sort());
      expect(text).not.toContain(secret);
      expect(text).not.toContain('PRIVATE_PROVIDER_RAW');
      calls = 0;
      vi.mocked(generate).mockImplementation(realGenerate);
      await countAmbiguityLiveOutcomes(fake, 'S');
      expect((await readFile(path, 'utf8')).trimEnd().split('\n')).toHaveLength(18);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
