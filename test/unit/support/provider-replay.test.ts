import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import * as fakeRunner from '../../doubles/create-fake-command-runner.js';
import { typedJsonSchema } from '#core/ai/typed-json-schema.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { AiExecutorUnavailableError } from '#core/errors/ai-executor-unavailable-error.js';
import { ProviderFixtureValue, type ProviderFixture } from '../../support/provider-fixture.js';
import { validResponse, truncatedJson, emptyStdoutExitZero, emptyOutputFile, nonZeroExit, hangUntilTimeout } from '../../support/provider-fault-builders.js';
import { createFixtureCommandRunner, createAdapterFor, replayExecute, repeatFixture, HANG_GUARD_MS, SETTLE_SLACK_MS, CLEANUP_WINDOW_MS, type FixtureCommandRunner } from '../../support/provider-replay.js';

const providers = ['claude-code-cli', 'codex-cli'] as const;
const request = { prompt: 'Return the result.', responseSchema: typedJsonSchema(z.object({ ok: z.boolean() })) };
const payload = { ok: true };
const directories: string[] = [];

/** Tests own direct-runner directories because only real adapters remove theirs. */
async function ownedDirectory(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'provider-replay-test-')));
  directories.push(directory);
  return directory;
}

/** Mirrors the real Codex invocation so protocol checks exercise output placement. */
function codexArgs(path: string): string[] {
  return ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--json', '--output-schema', join(dirname(path), 'schema.json'), '-o', path, '-'];
}

/** Observes rejections without leaving an asynchronous abort rejection unhandled. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => { throw new Error('expected rejection'); }, error => error);
}

/** Compile-time protection is checked without mutating runtime invocation history. */
function readonlyCalls(runner: FixtureCommandRunner): void {
  // @ts-expect-error Invocation history is a read-only consumer view.
  runner.calls.push({ command: 'claude', args: ['-p'], options: undefined });
}
void readonlyCalls;

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('fixture command runner', () => {
  it.each([0, 60001])('TEST-17 rejects hangGuardMs %i before creating command scripts', hangGuardMs => {
    const startup = vi.spyOn(fakeRunner, 'createFakeCommandRunner');
    let thrown: unknown;
    try { createFixtureCommandRunner([hangUntilTimeout('claude-code-cli')], { hangGuardMs }); }
    catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('replay: hangGuardMs must be an integer in 1..60000');
    expect(startup).not.toHaveBeenCalled();
  });
  it('TEST-4 exports the owned timing constants', () => {
    expect([HANG_GUARD_MS, SETTLE_SLACK_MS, CLEANUP_WINDOW_MS]).toEqual([10000, 3000, 1000]);
  });
  it.each([{ exitCode: 0 }, { signal: 'SIGTERM' as const }])('TEST-4 replays %j', async run => {
    const fixture = ProviderFixtureValue.parse({ ...emptyStdoutExitZero(), run, stdout: 'out', stderr: 'err' });
    const runner = createFixtureCommandRunner([fixture]);
    expect(await runner.run('claude', ['-p'])).toStrictEqual('exitCode' in run
      ? { outcome: 'exited', stdout: 'out', stderr: 'err', exitCode: 0 }
      : { outcome: 'signaled', stdout: 'out', stderr: 'err', signal: 'SIGTERM' });
    expect(runner.calls).toStrictEqual([{ command: 'claude', args: ['-p'], options: undefined }]);
    expect(await runner.assertClean()).toStrictEqual({ notes: [] });
  });
  it.each(['日本語\n', '', undefined])('TEST-5 distinguishes output file %j before returning', async outputFile => {
    const directory = await ownedDirectory();
    const path = join(directory, 'response.json');
    const fixture = ProviderFixtureValue.parse({ ...nonZeroExit('codex-cli', { exitCode: 1 }), ...(outputFile === undefined ? {} : { outputFile }) });
    const runner = createFixtureCommandRunner([fixture]);
    await runner.run('codex', codexArgs(path));
    if (outputFile === undefined) expect(existsSync(path)).toBe(false);
    else {
      expect(await readFile(path)).toEqual(Buffer.from(outputFile));
      expect((await stat(path)).size).toBe(Buffer.byteLength(outputFile));
    }
    await rm(directory, { recursive: true, force: true });
    await runner.assertClean();
  });
  it.each([
    { command: 'codex', args: ['exec', '-o', '/unused'], reason: 'fixture provider claude-code-cli but command codex' },
    { command: 'claude', args: ['--version'], reason: 'protocol' },
  ])('TEST-6 records protocol mismatch $command $args without throwing', async ({ command, args, reason }) => {
    const runner = createFixtureCommandRunner([emptyStdoutExitZero()]);
    expect(await runner.run(command, args)).toStrictEqual({ outcome: 'exited', stdout: '', stderr: '', exitCode: 0 });
    const error = await rejection(runner.assertClean());
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^replay: \d+ problem\(s\)/);
    expect((error as Error).message).toContain(reason);
  });
  it.each([['--version'], ['exec'], ['exec', '-o'], ['exec', '-o', '']])('TEST-6 rejects invalid Codex protocol %j', async (...args) => {
    const runner = createFixtureCommandRunner([emptyOutputFile()]);
    await runner.run('codex', args);
    await expect(runner.assertClean()).rejects.toThrow(/protocol/);
  });
  it.each([1, 3])('TEST-6 aggregates invocation count mismatch %i', async count => {
    const runner = createFixtureCommandRunner(repeatFixture(emptyStdoutExitZero(), 2));
    for (let i = 0; i < count; i++) await runner.run('claude', ['-p']).catch(() => undefined);
    await expect(runner.assertClean()).rejects.toThrow(/calls/);
  });
  it('TEST-6 harness count violation outranks the adapter result', async () => {
    const fixture = validResponse('claude-code-cli', payload);
    const runner = createFixtureCommandRunner([fixture]);
    await createAdapterFor(fixture.provider, runner.run).execute(request);
    await expect(replayExecute(fixture, request, runner)).rejects.toThrow(/^replay: \d+ problem\(s\)/);
  });
  it('TEST-6 provider mismatch through the real Codex adapter remains visible', async () => {
    const runner = createFixtureCommandRunner([emptyStdoutExitZero()]);
    await expect(replayExecute(emptyOutputFile(), request, runner)).rejects.toThrow('fixture provider claude-code-cli but command codex');
    const call = runner.calls[0]!;
    expect(existsSync(dirname(call.args[call.args.indexOf('-o') + 1]!))).toBe(false);
  });
  it('TEST-6 caller abort exempts only unconsumed hangs and caches cleanup', async () => {
    const controller = new AbortController();
    const runner = createFixtureCommandRunner(repeatFixture(hangUntilTimeout('claude-code-cli'), 2));
    const outcome = rejection(runner.run('claude', ['-p'], { signal: controller.signal }));
    controller.abort();
    await outcome;
    const first = runner.assertClean();
    expect(runner.assertClean()).toBe(first);
    const clean = await first;
    expect(clean.notes).toHaveLength(1);
    expect(clean.notes[0]).toContain('1');
    expect(await runner.assertClean()).toBe(clean);
  });
  it('TEST-6 internal cleanup abort never grants the hang count exemption', async () => {
    const controller = new AbortController();
    const runner = createFixtureCommandRunner(repeatFixture(hangUntilTimeout('claude-code-cli'), 2), { deadlineMs: 30 });
    const outcome = rejection(runner.run('claude', ['-p'], { signal: controller.signal }));
    const error = await rejection(runner.assertClean());
    await outcome;
    expect(controller.signal.aborted).toBe(false);
    expect((error as Error).message).toContain('calls');
    expect((error as Error).message).toContain('unsettled');
  });
  it('TEST-6 snapshots unsettled scripts only when the deadline elapses', async () => {
    const runner = createFixtureCommandRunner([{ ...emptyStdoutExitZero(), delayMs: 20 }], { deadlineMs: 100 });
    const work = runner.run('claude', ['-p']);
    const first = runner.assertClean();
    expect(runner.assertClean()).toBe(first);
    await work;
    expect(await first).toStrictEqual({ notes: [] });
  });
  it('TEST-6 synchronously closes admission when cleanup starts', async () => {
    const runner = createFixtureCommandRunner([{ ...emptyStdoutExitZero(), delayMs: 20 }]);
    const work = runner.run('claude', ['-p']);
    const clean = rejection(runner.assertClean());
    await expect(runner.run('claude', ['-p'])).rejects.toThrow(/^replay: \d+ problem\(s\)/);
    await work;
    expect((await clean as Error).message).toContain('cleaning');
  });
  it('TEST-6 pre-aborted calls consume a slot without starting a script', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const runner = createFixtureCommandRunner([hangUntilTimeout('claude-code-cli')]);
    await expect(runner.run('claude', ['-p'], { signal: controller.signal })).rejects.toBe(controller.signal.reason);
    expect(runner.calls).toHaveLength(1);
    expect(await runner.assertClean()).toStrictEqual({ notes: [] });
  });
  it('TEST-6 reports remaining Codex temporary directories', async () => {
    const directory = await ownedDirectory();
    const runner = createFixtureCommandRunner([emptyOutputFile()]);
    await runner.run('codex', codexArgs(join(directory, 'response.json')));
    await expect(runner.assertClean()).rejects.toThrow(/directory/);
  });
  it('TEST-6 reports output I/O failure as a harness failure', async () => {
    const directory = await ownedDirectory();
    const runner = createFixtureCommandRunner([emptyOutputFile()]);
    await runner.run('codex', codexArgs(join(directory, 'missing', 'response.json'))).catch(() => undefined);
    await expect(runner.assertClean()).rejects.toThrow(/write/);
  });
  it('TEST-10 missing signals and expired hang guards remain harness violations', async () => {
    const fixture = hangUntilTimeout('claude-code-cli');
    const missing = createFixtureCommandRunner([fixture]);
    await expect(missing.run('claude', ['-p'])).rejects.toThrow('hang fixture requires an AbortSignal');
    await expect(missing.assertClean()).rejects.toThrow('hang fixture requires an AbortSignal');
    const guarded = createFixtureCommandRunner([fixture], { hangGuardMs: 30 });
    await expect(guarded.run('claude', ['-p'], { signal: new AbortController().signal })).rejects.toThrow('replay: hang fixture was never aborted');
    await expect(guarded.assertClean()).rejects.toThrow('replay: hang fixture was never aborted');
  });
  it('SUPP-1 revalidates hand-built fixtures with the same Zod error', () => {
    const invalid = { ...emptyStdoutExitZero(), outputFile: 'forbidden' };
    const parsed = ProviderFixtureValue.safeParse(invalid);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('invalid test input');
    let thrown: unknown;
    try { createFixtureCommandRunner([invalid]); }
    catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(z.ZodError);
    expect((thrown as z.ZodError).issues).toStrictEqual(parsed.error.issues);
  });
  it.each([0, -1, 1.5, NaN, Infinity])('TEST-17 rejects repeat count %j', n => {
    expect(() => repeatFixture(emptyStdoutExitZero(), n)).toThrow('replay: repeatFixture n must be an integer >= 1');
  });
  it('TEST-17 repeatFixture preserves input references in a fresh array', () => {
    const fixture = emptyStdoutExitZero();
    const repeated = repeatFixture(fixture, 2);
    expect(repeated).toStrictEqual([fixture, fixture]);
    expect(repeated[0]).toBe(fixture);
    expect(repeatFixture(fixture, 2)).not.toBe(repeated);
  });
});

describe('replayExecute through the real adapters', () => {
  it.each(providers)('TEST-7 %s returns the exact payload and raw JSON', async provider => {
    const result = await replayExecute(validResponse(provider, payload), request);
    expect(result).toStrictEqual({ data: payload, raw: JSON.stringify(payload) });
    console.info('SPEC-5 oracle', provider, 'validResponse', JSON.stringify(result));
  });

  const faults = providers.flatMap(provider => {
    const truncated = truncatedJson(provider, payload);
    const raw = provider === 'codex-cli' ? truncated.outputFile! : JSON.parse(truncated.stdout).result as string;
    const transport = truncatedJson('claude-code-cli', payload, { layer: 'transport' });
    const invalid = (label: string, fixture: ProviderFixture, raw: string, message = 'The AI provider returned malformed JSON.') => ({ label, fixture, errorClass: AiResponseInvalidError, message, details: { raw, issues: [{ code: 'invalid-json', path: [] }] } });
    const unavailable = (label: string, fixture: ProviderFixture, message: string, details: Record<string, unknown>) => ({ label, fixture, errorClass: AiExecutorUnavailableError, message, details });
    const name = provider === 'codex-cli' ? 'Codex' : 'Claude Code';
    const providerName = provider === 'codex-cli' ? 'codex' : 'claude';
    return [
      invalid(`${provider} truncated payload`, truncated, raw),
      ...(provider === 'claude-code-cli' ? [
        invalid('claude transport truncation', transport, transport.stdout, 'The Claude Code CLI returned malformed JSON.'),
        invalid('claude empty stdout', emptyStdoutExitZero(), '', 'The Claude Code CLI returned malformed JSON.'),
      ] : [
        invalid('codex empty file', emptyOutputFile(), ''),
        unavailable('codex missing file', ProviderFixtureValue.parse({ ...nonZeroExit(provider), run: { exitCode: 0 } }), 'The Codex CLI did not produce a response file.', { provider: 'codex' }),
      ]),
      ...['', 'provider failed', 'x'.repeat(1000), 'x'.repeat(999) + '😀'].flatMap((stderr, index) => [
        unavailable(`${provider} nonzero stderr-${index}`, nonZeroExit(provider, { stderr }), `The ${name} CLI did not complete the request.`, { provider: providerName, ...(stderr === '' ? {} : { stderrExcerpt: stderr.slice(0, 1000) }) }),
        unavailable(`${provider} signal stderr-${index}`, ProviderFixtureValue.parse({ ...nonZeroExit(provider, { stderr }), run: { signal: 'SIGTERM' } }), `The ${name} CLI did not complete the request.`, { provider: providerName, ...(stderr === '' ? {} : { stderrExcerpt: stderr.slice(0, 1000) }) }),
      ]),
    ];
  });
  it.each(faults)('TEST-8 $label matches the literal SPEC-5 oracle', async ({ label, fixture, errorClass, message, details }) => {
    const runner = createFixtureCommandRunner([fixture]);
    const error = await rejection(replayExecute(fixture, request, runner));
    console.info('SPEC-5 oracle', label, JSON.stringify({ classification: (error as Error).constructor.name, message: (error as Error).message, details: (error as AiResponseInvalidError).details }));
    expect(error).toBeInstanceOf(errorClass);
    expect((error as Error).message).toBe(message);
    expect((error as AiResponseInvalidError).details).toStrictEqual(details);
    expect(await runner.assertClean()).toStrictEqual({ notes: [] });
  });
  it.each(providers)('TEST-9 %s resolves a delayed response', async provider => {
    expect((await replayExecute({ ...validResponse(provider, payload), delayMs: 20 }, request)).data).toStrictEqual(payload);
  });
  it.each(providers.flatMap(provider => ['delay', 'hang'].map(kind => ({ provider, kind }))))('TEST-9/10 $provider $kind propagates caller abort and releases resources', async ({ provider, kind }) => {
    const fixture = kind === 'hang' ? hangUntilTimeout(provider) : { ...validResponse(provider, payload), delayMs: 5000 };
    const runner = createFixtureCommandRunner([fixture]);
    const controller = new AbortController();
    const outcome = rejection(replayExecute(fixture, { ...request, signal: controller.signal }, runner));
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1));
    const start = performance.now();
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    expect(await outcome).toBe(controller.signal.reason);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(await runner.assertClean()).toStrictEqual({ notes: [] });
    if (provider === 'codex-cli') {
      const call = runner.calls[0]!;
      const output = call.args[call.args.indexOf('-o') + 1]!;
      expect(existsSync(output)).toBe(false);
      expect(existsSync(dirname(output))).toBe(false);
    }
    if (kind === 'hang') console.info('SPEC-5 oracle', provider, 'hangUntilTimeout', 'signal.reason TimeoutError; cleanup clean');
  });
  it.each(providers)('TEST-10 %s missing signal reports the harness failure', async provider => {
    await expect(replayExecute(hangUntilTimeout(provider), request)).rejects.toThrow('hang fixture requires an AbortSignal');
  });
  it.each(providers.flatMap(provider => ['delay', 'hang'].map(kind => ({ provider, kind }))))('SUPP-3 $provider $kind releases all timers after replay and cleanup', async ({ provider, kind }) => {
    vi.useFakeTimers();
    const fixture = kind === 'delay' ? { ...validResponse(provider, payload), delayMs: 500 } : hangUntilTimeout(provider);
    const runner = createFixtureCommandRunner([fixture]);
    const controller = new AbortController();
    const work = replayExecute(fixture, { ...request, signal: controller.signal }, runner);
    const outcome = work.then(value => value, error => error);
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1));
    if (kind === 'hang') controller.abort();
    await vi.advanceTimersByTimeAsync(500);
    const observed = await outcome;
    if (kind === 'hang') expect(observed).toBe(controller.signal.reason);
    else expect(observed).toStrictEqual({ data: payload, raw: JSON.stringify(payload) });
    await runner.assertClean();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('TEST-17 rejects invalid replay fixture inputs before invoking the transport', async () => {
    const run = vi.fn();
    const runner = { run, calls: [], assertClean: vi.fn() } as FixtureCommandRunner;
    await expect(replayExecute({ ...emptyStdoutExitZero(), provider: 'unknown' } as unknown as ProviderFixture, request, runner)).rejects.toBeInstanceOf(z.ZodError);
    expect(run).not.toHaveBeenCalled();
  });
  it.each(providers)('TEST-17 %s replay is reproducible with fresh runners', async provider => {
    const fixture = validResponse(provider, payload);
    expect(await replayExecute(fixture, request)).toStrictEqual(await replayExecute(fixture, request));
  });
});
