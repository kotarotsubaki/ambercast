/**
 * Pins how broken provider output is classified end to end. Each committed
 * corpus row is replayed through the real provider adapter and the real
 * generate or heal use case, and the resulting report error (code, message,
 * issues, attempts) plus the number of provider calls are compared with the
 * row's `expected` block.
 *
 * The corpus rows are the contract: a row's expectation changes only in the
 * pull request that fixes the defect it documents, never to follow an
 * accidental behavior change. Every row repeats one output on each call, so the use case's own retry
 * policy decides the call count and the replay harness fails any mismatch
 * between that count and `expected.calls`. Sequences of different outputs
 * belong to `provider-replay-usecases.test.ts`.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { StageTwoRejectionReason } from '#ports/system.js';
import { ReportErrorCode } from '#report/schema.js';
import { loadCorpus } from '../../support/corpus.js';
import { ProviderFixtureValue } from '../../support/provider-fixture.js';
import { repeatFixture, replayThroughUseCase } from '../../support/provider-replay.js';
import { assertDiagnosable } from '../../support/report-assertions.js';

const GENERATE_SEEDS = [
  'confirms-navigate-512',
  'confirms-pattern-uppercase',
  'confirms-pattern-underscore',
  'confirms-pattern-japanese',
  'truncated-json-payload',
  'truncated-json-transport',
  'empty-stdout-exit-zero',
  'empty-output-file',
] as const;
const HEAL_SEEDS = [
  'confirms-pattern-uppercase',
  'truncated-json-payload',
  'truncated-json-transport',
  'empty-stdout-exit-zero',
  'empty-output-file',
] as const;

// The enum is listed by hand so a new rejection reason in the use case fails
// type checking here instead of silently widening what the corpus may name.
const STAGE2_REASONS = [
  'provider-error', 'response-shape', 'id-mismatch', 'secret-name-invalid', 'coverage-invalid',
  'obligation-mismatch', 'intent-invalid', 'literal-secret', 'no-advance',
] as const satisfies readonly StageTwoRejectionReason[];
const stage2ReasonsAreExhaustive: [Exclude<StageTwoRejectionReason, (typeof STAGE2_REASONS)[number]>] extends [never] ? true : never = true;
void stage2ReasonsAreExhaustive;

/**
 * `hint` is pinned to null because `AI_RESPONSE_INVALID` carries no hint
 * today; the change that adds one updates this schema and the rows together.
 * Issues are matched by containment plus the set of codes rather than as a
 * full list because AJV runs with `allErrors` and a discriminated union can
 * report issues per branch, so pinning the whole list would fail on
 * schema-conversion details instead of on classification regressions.
 */
const ErrorExpectation = z.strictObject({
  code: ReportErrorCode,
  message: z.string().refine(s => s.trim() !== ''),
  issuesContain: z.array(z.strictObject({ code: z.string(), path: z.array(z.union([z.int().min(0), z.string()])) })).min(1),
  issueCodes: z.array(z.string()).min(1).refine(a => new Set(a).size === a.length),
  attempts: z.array(z.strictObject({ attempt: z.int().min(1), code: ReportErrorCode })).min(1),
  hint: z.null(),
});

const GenerateExpectation = z.strictObject({
  seed: z.enum(GENERATE_SEEDS),
  maxAttempts: z.int().min(1).max(10),
  calls: z.int().min(1),
  exitCode: z.int(),
  status: z.enum(['generated', 'failed']),
  error: ErrorExpectation.nullable(),
})
  .refine(e => e.calls <= e.maxAttempts)
  .refine(e => (e.status === 'generated' ? e.error === null && e.exitCode === 0 : e.error !== null && e.exitCode === 3))
  .refine(e => e.error === null || e.error.attempts.length === e.calls);

const HealExpectation = z.strictObject({
  seed: z.enum(HEAL_SEEDS),
  calls: z.literal(2),
  exitCode: z.int(),
  repairOutcome: z.literal('unresolved'),
  stage2Reason: z.enum(STAGE2_REASONS),
  stage3Code: ReportErrorCode,
  error: ErrorExpectation,
}).refine(e => e.error.attempts.length === 1);

type GenerateExpected = z.infer<typeof GenerateExpectation>;
type HealExpected = z.infer<typeof HealExpectation>;
type ErrorExpected = z.infer<typeof ErrorExpectation>;

const GENERATE_FILE = new URL('../../fixtures/corpus/provider-output/generate-malformed-output.jsonl', import.meta.url);
const HEAL_FILE = new URL('../../fixtures/corpus/provider-output/heal-malformed-output.jsonl', import.meta.url);
const generateRows = loadCorpus(GENERATE_FILE, { value: ProviderFixtureValue, expected: GenerateExpectation });
const healRows = loadCorpus(HEAL_FILE, { value: ProviderFixtureValue, expected: HealExpectation });

// The #512 response: a navigate step id reused as a later assert's `confirms`.
const P512 = {
  steps: [
    { id: 'visit', kind: 'action', action: 'navigate', target: 'web', url: 'https://example.test' },
    { id: 'after-visit', kind: 'assert', check: 'text-visible', target: 'web', text: 'Home', confirms: ['visit'] },
  ],
  ambiguities: [],
};
const P512_JSON = JSON.stringify(P512);
const withConfirms = (value: string) => ({ ...P512, steps: [P512.steps[0], { ...P512.steps[1], confirms: [value] }] });

const SEED_REVISION = /^[0-9a-f]{7}$/;
const RECONSTRUCTED_NOTE = 'Original provider output was not kept; rebuilt from the #512 failure path steps[1].confirms[0] and the 2026-10-04 probe (a navigate step id in a later assert\'s confirms).';

const isSeedRow = (row: { source: string }) => row.source === '#512' || row.source === '#542';

type Report = Awaited<ReturnType<typeof replayThroughUseCase>>['report'];

/**
 * Shared judgment for one replay. Generate must end in exactly one case-scoped
 * error that matches the row; heal must contain exactly one matching provider
 * error among case-scoped errors. Neither may carry a crash classification.
 */
function expectClassifiedError(report: Report, error: ErrorExpected, mode: 'only' | 'among-others' = 'only'): void {
  // Heal's fixed scenario also reports an unrelated final-replay error for its
  // deliberately invalid navigation, so heal rows pick the classified provider
  // error out of the list instead of requiring it to be the only entry.
  const candidates = mode === 'only' ? report.errors : report.errors.filter(e => e.code === error.code);
  if (mode === 'among-others') for (const other of report.errors) expect(other.scope).toBe('case');
  expect(candidates).toHaveLength(1);
  if (mode === 'only') expect(report.errors).toHaveLength(1);
  const actual = candidates[0] as Record<string, unknown> & { details: { issues: { code: string; path: unknown[] }[]; attempts: unknown } };
  expect(actual.scope).toBe('case');
  expect(actual.caseId).toBe((report.results[0] as { id: string }).id);
  expect(actual.code).toBe(error.code);
  expect(actual.message).toBe(error.message);
  expect(Object.keys(actual.details).sort()).toStrictEqual(['attempts', 'issues']);
  for (const issue of error.issuesContain) expect(actual.details.issues).toContainEqual(issue);
  for (const issue of actual.details.issues) expect(error.issueCodes).toContain(issue.code);
  for (const code of error.issueCodes) expect(actual.details.issues.map(i => i.code)).toContain(code);
  expect(actual.details.attempts).toStrictEqual(error.attempts);
  expect(actual).not.toHaveProperty('hint');
}

function expectNoCrash(report: Report): void {
  assertDiagnosable(report);
  expect(report.errors.map(e => e.code)).not.toContain('UNEXPECTED_CRASH');
}

describe('provider-output corpus replay', () => {
  describe('generate', () => {
    it.each(generateRows)('TEST-2 line $line: $note', async ({ value, expected }: { value: z.infer<typeof ProviderFixtureValue>; expected: GenerateExpected }) => {
      const { report, exitCode, calls } = await replayThroughUseCase({
        useCase: 'generate',
        fixtures: repeatFixture(value, expected.calls),
        maxAttempts: expected.maxAttempts,
      });
      expect(exitCode).toBe(expected.exitCode);
      expect(calls).toHaveLength(expected.calls);
      expect(report.results).toHaveLength(1);
      const result = report.results[0] as { status: string; aiCalls?: number };
      expect(result.status).toBe(expected.status);
      expect(result.aiCalls).toBe(expected.calls);
      if (expected.error === null) expect(report.errors).toStrictEqual([]);
      else expectClassifiedError(report, expected.error);
      expectNoCrash(report);
    });
  });

  describe('heal', () => {
    it.each(healRows)('TEST-3 line $line: $note', async ({ value, expected }: { value: z.infer<typeof ProviderFixtureValue>; expected: HealExpected }) => {
      const { report, exitCode, calls } = await replayThroughUseCase({
        useCase: 'heal',
        fixtures: repeatFixture(value, expected.calls),
      });
      expect(exitCode).toBe(expected.exitCode);
      expect(calls).toHaveLength(expected.calls);
      expect(report.results).toHaveLength(1);
      const result = report.results[0] as { repairOutcome: string; repairTrace: { stage: string }[] };
      expect(result.repairOutcome).toBe(expected.repairOutcome);
      expect(result.repairTrace.find(e => e.stage === 'stage2')).toStrictEqual({
        stage: 'stage2', stepId: 'repair-me', outcome: 'rejected', reason: expected.stage2Reason,
      });
      expect(result.repairTrace.find(e => e.stage === 'stage3')).toStrictEqual({
        stage: 'stage3', outcome: 'failed', code: expected.stage3Code,
      });
      expectClassifiedError(report, expected.error, 'among-others');
      expectNoCrash(report);
    });
  });

  describe('corpus coverage', () => {
    it('TEST-4 covers every seed and binds each seed row to its payload', () => {
      const seeds = (rows: readonly { expected: { seed: string } }[]) => new Set(rows.map(r => r.expected.seed));
      // Containment, not equality: later rows may add seeds to the zod vocabulary.
      for (const seed of GENERATE_SEEDS) expect(seeds(generateRows)).toContain(seed);
      for (const seed of HEAL_SEEDS) expect(seeds(healRows)).toContain(seed);

      const pairs = (rows: typeof generateRows | typeof healRows) =>
        rows.filter(isSeedRow).map(r => `${r.expected.seed}/${r.value.provider}`).sort();
      expect(pairs(generateRows)).toStrictEqual([
        'confirms-navigate-512/claude-code-cli',
        'confirms-pattern-japanese/claude-code-cli',
        'confirms-pattern-underscore/claude-code-cli',
        'confirms-pattern-uppercase/claude-code-cli',
        'confirms-pattern-uppercase/codex-cli',
        'empty-output-file/codex-cli',
        'empty-stdout-exit-zero/claude-code-cli',
        'truncated-json-payload/claude-code-cli',
        'truncated-json-payload/codex-cli',
        'truncated-json-transport/claude-code-cli',
      ]);
      expect(pairs(healRows)).toStrictEqual([
        'confirms-pattern-uppercase/claude-code-cli',
        'empty-output-file/codex-cli',
        'empty-stdout-exit-zero/claude-code-cli',
        'truncated-json-payload/claude-code-cli',
        'truncated-json-payload/codex-cli',
        'truncated-json-transport/claude-code-cli',
      ]);

      // Seeds are decoded only where the payload layer is parseable; the
      // transport and empty seeds are compared as raw strings on purpose.
      const wrapperHalf = (() => { const w = JSON.stringify({ result: P512_JSON }); return w.slice(0, Math.floor(w.length / 2)); })();
      const payloadHalf = P512_JSON.slice(0, Math.floor(P512_JSON.length / 2));
      const confirmsBySeed: Record<string, string> = {
        'confirms-pattern-uppercase': 'Visit',
        'confirms-pattern-underscore': 'visit_page',
        'confirms-pattern-japanese': '訪問',
      };
      for (const row of [...generateRows, ...healRows].filter(isSeedRow)) {
        const { seed } = row.expected;
        const { value } = row;
        // Decoding happens only for seeds whose payload layer is parseable, so the transport and empty seeds never reach JSON.parse.
        const payloadOutput = () => (value.provider === 'claude-code-cli' ? (JSON.parse(value.stdout) as { result: string }).result : value.outputFile);
        switch (seed) {
          case 'truncated-json-transport':
            expect(value.stdout).toBe(wrapperHalf);
            break;
          case 'empty-stdout-exit-zero':
            expect(value.stdout).toBe('');
            break;
          case 'empty-output-file':
            expect(value.outputFile).toBe('');
            expect(value.stdout).toBe('');
            break;
          case 'truncated-json-payload':
            expect(payloadOutput()).toBe(payloadHalf);
            break;
          case 'confirms-navigate-512':
            expect(JSON.parse(payloadOutput() as string)).toStrictEqual(P512);
            break;
          default:
            expect(JSON.parse(payloadOutput() as string)).toStrictEqual(withConfirms(confirmsBySeed[seed]!));
        }
        expect(row.value.run).toStrictEqual({ exitCode: 0 });
        expect(row.value.delayMs).toBe(0);
        expect(row.value.provenance.ambercast).toMatch(SEED_REVISION);
        expect(row.value.provenance.origin).toBe(row.source === '#512' ? 'reconstructed' : 'synthetic');
        expect(row.source).toBe(seed === 'confirms-navigate-512' ? '#512' : '#542');
      }

      const reconstructed = generateRows.filter(r => r.source === '#512');
      expect(reconstructed).toHaveLength(1);
      expect(reconstructed[0]!.value.provenance.note).toBe(RECONSTRUCTED_NOTE);
      // The #512 response is well-formed, so in heal's fixed scenario the outcome would hinge on
      // the fake browser's replay of the proposed step, not on classifying malformed output.
      expect(healRows.filter(r => r.source === '#512')).toHaveLength(0);
    });

    it('TEST-4 holds every row, including later additions, to the fixture rules', () => {
      for (const row of [...generateRows, ...healRows]) {
        expect(ProviderFixtureValue.safeParse(row.value).success).toBe(true);
        if (row.value.provenance.origin !== 'recorded') expect(row.value.provenance.providerVersion).toBeUndefined();
      }
      for (const rows of [generateRows, healRows]) {
        expect(new Set(rows.map(r => r.value.provider))).toStrictEqual(new Set(['claude-code-cli', 'codex-cli']));
      }
    });

    it('TEST-4 keeps the seed rows at 10 for generate and 6 for heal', () => {
      expect(generateRows.filter(isSeedRow)).toHaveLength(10);
      expect(healRows.filter(isSeedRow)).toHaveLength(6);
    });
  });

  describe('expectation schema', () => {
    const dirs: string[] = [];
    afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

    const value = { provider: 'claude-code-cli', provenance: { ambercast: '37a0e71', input: 'x', origin: 'synthetic' }, run: { exitCode: 0 } };
    const error = {
      code: 'AI_RESPONSE_INVALID', message: 'm', issuesContain: [{ code: 'invalid-json', path: [] }], issueCodes: ['invalid-json'],
      attempts: [{ attempt: 1, code: 'AI_RESPONSE_INVALID' }, { attempt: 2, code: 'AI_RESPONSE_INVALID' }], hint: null,
    };
    const generate = { seed: 'empty-stdout-exit-zero', maxAttempts: 2, calls: 2, exitCode: 3, status: 'failed', error };
    const heal = {
      seed: 'empty-stdout-exit-zero', calls: 2, exitCode: 3, repairOutcome: 'unresolved', stage2Reason: 'provider-error',
      stage3Code: 'AI_RESPONSE_INVALID', error: { ...error, attempts: [error.attempts[0]] },
    };

    function load(kind: 'generate' | 'heal', expected: unknown) {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'provider-output-corpus-')));
      dirs.push(dir);
      const file = join(dir, 'row.jsonl');
      writeFileSync(file, `${JSON.stringify({ value, expected, note: 'n', source: '#542', date: '2026-10-23' })}\n`);
      return kind === 'generate'
        ? loadCorpus(file, { value: ProviderFixtureValue, expected: GenerateExpectation })
        : loadCorpus(file, { value: ProviderFixtureValue, expected: HealExpectation });
    }

    it('TEST-1 accepts the well-formed baseline rows', () => {
      expect(load('generate', generate)).toHaveLength(1);
      expect(load('heal', heal)).toHaveLength(1);
    });

    it('TEST-1 loads both committed files with the seed rows present', () => {
      expect(generateRows.filter(isSeedRow)).toHaveLength(10);
      expect(healRows.filter(isSeedRow)).toHaveLength(6);
    });

    const generateCases: [string, unknown][] = [
      ['an extra key', { ...generate, extra: 1 }],
      ['calls 0', { ...generate, calls: 0, error: { ...error, attempts: [] } }],
      ['calls above maxAttempts', { ...generate, calls: 3, error: { ...error, attempts: [...error.attempts, error.attempts[0]] } }],
      ['duplicate issueCodes', { ...generate, error: { ...error, issueCodes: ['invalid-json', 'invalid-json'] } }],
      ['empty attempts', { ...generate, error: { ...error, attempts: [] } }],
      ['generated with a non-null error', { ...generate, status: 'generated', exitCode: 0 }],
      ['failed with a null error', { ...generate, error: null }],
      ['attempts length different from calls', { ...generate, error: { ...error, attempts: [error.attempts[0]] } }],
      ['an unknown error code', { ...generate, error: { ...error, code: 'NOT_A_CODE' } }],
      ['a non-null hint', { ...generate, error: { ...error, hint: 'try again' } }],
    ];
    it.each(generateCases)('TEST-1 rejects a generate expectation with %s', (_name, expected) => {
      expect(() => load('generate', expected)).toThrow(/- line 1: expected schema threw: /);
    });

    const healCases: [string, unknown][] = [
      ['calls 3', { ...heal, calls: 3 }],
      ['two attempts', { ...heal, error: { ...heal.error, attempts: error.attempts } }],
      ['an unknown stage2Reason', { ...heal, stage2Reason: 'nope' }],
      ['an unknown stage3Code', { ...heal, stage3Code: 'NOT_A_CODE' }],
      ['a null error', { ...heal, error: null }],
    ];
    it.each(healCases)('TEST-1 rejects a heal expectation with %s', (_name, expected) => {
      expect(() => load('heal', expected)).toThrow(/- line 1: expected schema threw: /);
    });
  });
});
