import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ReportEnvelope, ReportError } from '#report/schema.js';
import type { GenerateCommandInput, GenerateCommandOutput } from '#runtime/generate-command.js';
import type { CheckCommandInput } from '#runtime/check-command.js';
import type { HealCommandInput } from '#runtime/heal-command.js';

const runGenerateCommand = vi.hoisted(() => vi.fn());
const runRunCommand = vi.hoisted(() => vi.fn());
const runCheckCommand = vi.hoisted(() => vi.fn());
const runHealCommand = vi.hoisted(() => vi.fn());
vi.mock('#runtime/generate-command.js', () => ({ runGenerateCommand }));
vi.mock('#runtime/run-command.js', () => ({ runRunCommand }));
vi.mock('#runtime/check-command.js', () => ({ runCheckCommand }));
vi.mock('#runtime/heal-command.js', () => ({ runHealCommand }));

import { ERROR_DETAILS_KEY_ORDER, main, renderHumanReport, REPORT_PERSISTENCE_FAILED_WARNING } from '../../src/cli/main.js';
import { CAUSE_NAMES } from './report/cause-name-fixtures.js';

const expectedUsage = readFileSync(new URL('../fixtures/cli-usage.txt', import.meta.url), 'utf8');

class MemoryWritable extends Writable {
  chunks: string[] = [];

  override _write(chunk: Buffer | string, _encoding: string, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  get text(): string {
    return this.chunks.join('');
  }
}

const ENVELOPE = {
  schemaVersion: '3.4' as const,
  command: 'generate' as const,
  startedAt: '2026-08-08T00:00:00Z',
  durationMs: 0,
  summary: { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 },
  errors: [],
  results: [{ id: 'login', file: 'login.test.md', status: 'listed' as const, dryRun: false as const }],
};

const RUN_ENVELOPE = {
  schemaVersion: '3.4' as const,
  command: 'run' as const,
  startedAt: '2026-08-09T00:00:00Z',
  durationMs: 0,
  summary: { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0 },
  errors: [],
  results: [],
  reportPersistence: 'persisted' as const,
};

const CHECK_ENVELOPE = {
  schemaVersion: '3.4' as const,
  command: 'check' as const,
  startedAt: '2026-08-17T00:00:00Z',
  durationMs: 0,
  summary: { total: 2, passed: 1, failed: 1, errored: 0, skipped: 0 },
  errors: [],
  results: [
    {
      id: 'fresh.test.md',
      file: 'fresh.test.md',
      planFile: 'fresh.ambercast.plan.json',
      status: 'fresh' as const,
      reason: 'The plan matches the current prompt and target.',
    },
    {
      id: 'stale.test.md',
      file: 'stale.test.md',
      planFile: 'stale.ambercast.plan.json',
      status: 'stale' as const,
      reason: 'The plan is stale for the current prompt or target.',
    },
  ],
};

const HEAL_ENVELOPE = {
  schemaVersion: '3.4' as const,
  command: 'heal' as const,
  startedAt: '2026-08-25T00:00:00Z',
  durationMs: 0,
  summary: { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0 },
  errors: [],
  results: [],
};

const rawEnvelopeForFinalizedBoundary: Extract<ReportEnvelope, { command: 'generate' }> = ENVELOPE;
// @ts-expect-error An actual CLI command-output literal cannot cross the renderer boundary with a raw envelope.
const rawCommandOutput: GenerateCommandOutput = { exitCode: 0, envelope: rawEnvelopeForFinalizedBoundary };
type RendererParam = Parameters<typeof renderHumanReport>[0];
// @ts-expect-error The renderer's actual derived parameter type excludes raw envelopes.
const rawRendererArgument: RendererParam = rawEnvelopeForFinalizedBoundary;
void rawCommandOutput;
void rawRendererArgument;

let cwdSpy: ReturnType<typeof vi.spyOn> | undefined;
let initialExitCode: typeof process.exitCode;

beforeEach(() => {
  initialExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = initialExitCode;
  cwdSpy?.mockRestore();
  cwdSpy = undefined;
  runGenerateCommand.mockReset();
  runRunCommand.mockReset();
  runCheckCommand.mockReset();
  runHealCommand.mockReset();
});

async function run(argv: readonly string[]) {
  const stdout = new MemoryWritable();
  const stderr = new MemoryWritable();

  await main(argv, stdout, stderr);

  return { stdout: stdout.text, stderr: stderr.text, exitCode: process.exitCode };
}

describe('main()', () => {
  it('renders skipped rows as non-healthy without fabricating execution or inspection evidence', async () => {
    runCheckCommand.mockResolvedValue({
      exitCode: 3,
      envelope: {
        schemaVersion: '3.4', command: 'check', startedAt: '2026-08-17T00:00:00Z', durationMs: 0,
        summary: { total: 1, passed: 0, failed: 0, errored: 0, skipped: 1 },
        errors: [{ scope: 'run', kind: 'environment', code: 'INTERRUPTED', message: 'The command was interrupted before all discovered cases reached a terminal state.' }],
        results: [{ id: 'pending.test.md', file: 'pending.test.md', status: 'skipped' }],
      },
    } as never);

    const result = await run(['check', '--no-color']);

    expect(result.stdout).toContain('skipped pending.test.md');
    expect(result.stdout).not.toContain('fresh');
    expect(result.stdout).not.toContain('duration');
    expect(result.stdout).not.toContain('inspection');
    expect(result.exitCode).toBe(3);
  });

  it('renders the fixed orphan-grounding reason without exposing its artifact path', async () => {
    const artifactPath = '/workspace/tests/private/deleted.ambercast.grounding.json';
    runCheckCommand.mockResolvedValue({
      exitCode: 4,
      envelope: {
        schemaVersion: '3.4', command: 'check', startedAt: '2026-08-17T00:00:00Z', durationMs: 0,
        summary: { total: 1, passed: 0, failed: 1, errored: 0, skipped: 0 }, errors: [],
        results: [{ id: 'deleted.test.md', file: 'deleted.test.md', planFile: 'deleted.ambercast.plan.json', groundingFile: artifactPath, status: 'orphaned-grounding', reason: 'No corresponding test file exists for this grounding artifact.' }],
      },
    } as never);

    const result = await run(['check', '--no-color']);

    expect(result.stdout).toContain('No corresponding test file exists for this grounding artifact.');
    expect(result.stdout).not.toContain(artifactPath);
  });

  it('prints usage and exits 0 when no command is supplied', async () => {
    const result = await run([]);

    expect(result.stdout).toMatch(/usage/i);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('short-circuits top-level version and help before command lookup', async () => {
    const version = await run(['--version']);
    expect(version.stdout).toMatch(/^ambercast v\d+\.\d+\.\d+/);
    expect(version.exitCode).toBe(0);

    const help = await run(['--help']);
    expect(help.stdout).toMatch(/generate/);
    expect(help.exitCode).toBe(0);
    expect(runGenerateCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown command', ['unknown']],
    ['unknown flag even with JSON requested', ['generate', '--json', '--unknown']],
    ['missing target value', ['generate', '--target']],
    ['missing AI provider value', ['generate', '--ai']],
    ['missing config value', ['generate', '--config']],
    ['unsupported provider', ['generate', '--ai', 'other']],
  ] as const)('writes plain usage to stderr and exits 2 for %s', async (_description, argv) => {
    const result = await run(argv);

    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/usage|unknown|missing/i);
    expect(result.stderr.trim().startsWith('{')).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(runGenerateCommand).not.toHaveBeenCalled();
  });

  it('passes parsed list flags and literal paths to runtime then renders its human report', async () => {
    runGenerateCommand.mockResolvedValue({ exitCode: 0, envelope: ENVELOPE });

    const result = await run(['generate', 'login.test.md', '--list', '--no-color', '--config', 'ambercast.config.json']);

    expect(runGenerateCommand).toHaveBeenCalledWith(expect.objectContaining({
      files: ['login.test.md'], list: true, dryRun: false, force: false, strict: false,
      configPathOverride: 'ambercast.config.json',
    }));
    expect(result.stdout).toContain('login.test.md');
    expect(result.stdout).not.toMatch(/\u001B\[/);
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ['target', ['generate', '--target', 'web'], { target: 'web' }],
    ['Claude provider', ['generate', '--ai', 'claude'], { aiProviderOverride: 'claude' }],
    ['Codex provider', ['generate', '--ai', 'codex'], { aiProviderOverride: 'codex' }],
    ['force', ['generate', '--force'], { force: true }],
    ['allow-empty', ['generate', '--allow-empty'], { allowEmpty: true }],
  ] as const)('parses the documented generate %s flag', async (_description, argv, expectedInput) => {
    runGenerateCommand.mockResolvedValue({ exitCode: 0, envelope: ENVELOPE });

    await run(argv);

    expect(runGenerateCommand).toHaveBeenCalledWith(expect.objectContaining(expectedInput));
  });

  it('treats values after -- as literal paths, including option-shaped names', async () => {
    runGenerateCommand.mockResolvedValue({ exitCode: 0, envelope: ENVELOPE });

    await run(['generate', '--', '--not-an-option.test.md']);

    expect(runGenerateCommand).toHaveBeenCalledWith(expect.objectContaining({ files: ['--not-an-option.test.md'] }));
  });

  it('short-circuits command-local generate help before calling runtime', async () => {
    const result = await run(['generate', '--help']);

    expect(result.stdout).toMatch(/generate|usage/i);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(runGenerateCommand).not.toHaveBeenCalled();
  });

  it('passes the current working directory to runtime configuration selection', async () => {
    runGenerateCommand.mockResolvedValue({ exitCode: 0, envelope: ENVELOPE });
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/workspace/project');

    await run(['generate']);

    expect(runGenerateCommand).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/workspace/project' }));
  });

  it('forwards SIGINT through the runtime signal and removes both process listeners after completion', async () => {
    let receivedSignal: AbortSignal | undefined;
    const initialSigintListeners = process.listenerCount('SIGINT');
    const initialSigtermListeners = process.listenerCount('SIGTERM');
    runGenerateCommand.mockImplementation(async (commandInput: GenerateCommandInput) => {
      receivedSignal = commandInput.signal;
      process.emit('SIGINT');
      return { exitCode: 0, envelope: ENVELOPE };
    });

    await run(['generate']);

    expect(receivedSignal?.aborted).toBe(true);
    expect(process.listenerCount('SIGINT')).toBe(initialSigintListeners);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermListeners);
  });

  it('writes exactly one valid JSON envelope for a parsed dry-run invocation', async () => {
    const envelope = {
      ...ENVELOPE,
      results: [{
        ...ENVELOPE.results[0],
        status: 'would-generate' as const,
        dryRun: true,
        planFile: 'login.ambercast.plan.json',
        ambiguities: [],
      }],
    };
    runGenerateCommand.mockResolvedValue({ exitCode: 1, envelope });

    const result = await run(['generate', '--dry-run', '--strict', '--json']);

    expect(runGenerateCommand).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, strict: true }));
    expect(ReportEnvelope.safeParse(JSON.parse(result.stdout)).success).toBe(true);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(1);
  });

  it('keeps an unexpected runtime rejection inside the documented exit-code contract', async () => {
    runGenerateCommand.mockRejectedValue(new Error('unexpected test rejection'));

    const result = await run(['generate']);

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('The generate command crashed unexpectedly (Error). Set AMBERCAST_DEBUG=1 to print the message and stack; they may contain sensitive data.\n');
    expect(result.exitCode).toBe(3);
  });

  it.each([
    ['an unlisted Error subclass', new (class CustomFailure extends Error {})('custom'), 'Error'],
    ['a non-Error value', { name: 'not trusted' }, 'Error'],
    ['a plain object with an allowlisted name', { name: 'TypeError' }, 'Error'],
  ] as const)('projects %s in the fixed crash line', async (_description, rejection, name) => {
    runGenerateCommand.mockRejectedValue(rejection);

    const result = await run(['generate']);

    expect(result.stderr).toBe(`The generate command crashed unexpectedly (${name}). Set AMBERCAST_DEBUG=1 to print the message and stack; they may contain sensitive data.\n`);
    expect(result.exitCode).toBe(3);
  });

  it.each(CAUSE_NAMES)('projects the allowlisted %s Error name in the fixed crash line', async (name) => {
    runGenerateCommand.mockRejectedValue(Object.assign(new Error('aborted'), { name }));

    const result = await run(['generate']);

    expect(result.stderr).toBe(`The generate command crashed unexpectedly (${name}). Set AMBERCAST_DEBUG=1 to print the message and stack; they may contain sensitive data.\n`);
  });

  it.each([undefined, '', '0', 'false'] as const)('suppresses crash message and stack when AMBERCAST_DEBUG is %j', async (debug) => {
    if (debug === undefined) delete process.env.AMBERCAST_DEBUG;
    else process.env.AMBERCAST_DEBUG = debug;
    runGenerateCommand.mockRejectedValue(new Error('sensitive message'));

    const result = await run(['generate']);

    expect(result.stderr).not.toContain('sensitive message');
    expect(result.stderr).not.toContain('cause message:');
    delete process.env.AMBERCAST_DEBUG;
  });

  it.each(['FALSE', 'no', '1'] as const)('prints crash message and stack when AMBERCAST_DEBUG is active for %s', async (debug) => {
    process.env.AMBERCAST_DEBUG = debug;
    runGenerateCommand.mockRejectedValue(new Error('sensitive message'));

    const result = await run(['generate']);

    expect(result.stderr).toContain('cause message: sensitive message');
    expect(result.stderr).toContain('Error: sensitive message');
    delete process.env.AMBERCAST_DEBUG;
  });

  it('escapes terminal controls in active-debug crash diagnostics while preserving stack newlines', async () => {
    process.env.AMBERCAST_DEBUG = '1';
    const error = new Error('unsafe\u001b[31m message');
    error.stack = 'first\u001b[31m line\nsecond\u009b31m line';
    runGenerateCommand.mockRejectedValue(error);

    const result = await run(['generate']);

    expect(result.stderr).toContain('cause message: unsafe\\u001b[31m message\n');
    expect(result.stderr).toContain('cause stack:\nfirst\\u001b[31m line\nsecond\\u009b31m line\n');
    expect(result.stderr).not.toContain('\u001b');
    expect(result.stderr).not.toContain('\u009b');
    delete process.env.AMBERCAST_DEBUG;
  });

  it('does not crash again when a caught value throws from diagnostic getters', async () => {
    const hostile = new Proxy({}, {
      get() { throw new Error('getter failure'); },
    });
    runGenerateCommand.mockRejectedValue(hostile);

    const result = await run(['generate']);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('crashed unexpectedly (Error)');
  });

  it('omits hostile crash message and stack values independently when debug is active', async () => {
    process.env.AMBERCAST_DEBUG = '1';
    const hostile = new Proxy({}, { get() { throw new Error('getter failure'); } });
    runGenerateCommand.mockRejectedValue(hostile);

    const result = await run(['generate']);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe('The generate command crashed unexpectedly (Error). Set AMBERCAST_DEBUG=1 to print the message and stack; they may contain sensitive data.\n');
    delete process.env.AMBERCAST_DEBUG;
  });

  it('passes every documented run argument to runtime and renders JSON output', async () => {
    runRunCommand.mockResolvedValue({ exitCode: 0, envelope: RUN_ENVELOPE });

    const result = await run([
      'run',
      'login.test.md',
      'checkout.test.md',
      '--grep',
      'login|checkout',
      '--target',
      'web',
      '--headed',
      '--json',
      '--cache-only',
      '--update-cache',
      '--stale',
      'regenerate',
      '--ai',
      'claude',
    ]);

    expect(runRunCommand).toHaveBeenCalledWith(expect.objectContaining({
      files: ['login.test.md', 'checkout.test.md'],
      grep: expect.any(RegExp),
      target: 'web',
      headed: true,
      cacheOnly: true,
      updateCache: true,
      stale: 'regenerate',
      aiProviderOverride: 'claude',
    }));
    const commandInput = runRunCommand.mock.calls[0]?.[0] as { grep?: RegExp };
    expect(commandInput.grep).toEqual(/login|checkout/);
    expect(JSON.parse(result.stdout)).toEqual(RUN_ENVELOPE);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('accepts Codex as a run provider override', async () => {
    runRunCommand.mockResolvedValue({ exitCode: 0, envelope: RUN_ENVELOPE });

    await run(['run', '--ai', 'codex']);

    expect(runRunCommand).toHaveBeenCalledWith(expect.objectContaining({ aiProviderOverride: 'codex' }));
  });

  it.each([
    ['JSON', ['run', '--json']],
    ['human-rendered', ['run', '--no-color']],
  ] as const)('writes the fixed persistence warning for a failed %s run', async (_mode, argv) => {
    runRunCommand.mockResolvedValue({
      exitCode: 3,
      envelope: { ...RUN_ENVELOPE, reportPersistence: 'failed' as const },
    });

    const result = await run(argv);

    expect(result.stderr).toBe(`${REPORT_PERSISTENCE_FAILED_WARNING}\n`);
    expect(result.stderr).not.toContain('/workspace');
    expect(result.stderr).not.toContain('disk full');
  });

  it.each(['persisted', 'not-attempted'] as const)('omits the persistence warning for a %s run', async (reportPersistence) => {
    runRunCommand.mockResolvedValue({
      exitCode: 0,
      envelope: { ...RUN_ENVELOPE, reportPersistence },
    });

    const result = await run(['run', '--json']);

    expect(result.stderr).not.toContain(REPORT_PERSISTENCE_FAILED_WARNING);
  });

  it('accepts fail as an explicit run stale policy', async () => {
    runRunCommand.mockResolvedValue({ exitCode: 0, envelope: RUN_ENVELOPE });

    await run(['run', '--stale', 'fail']);

    expect(runRunCommand).toHaveBeenCalledWith(expect.objectContaining({ stale: 'fail', updateCache: false }));
  });

  it('renders --update-cache in the actual usage text', async () => {
    const result = await run(['--help']);

    expect(result.stdout).toContain('--update-cache');
  });

  it.each(['generate', 'check'] as const)('rejects --update-cache for %s before runtime composition', async (command) => {
    const result = await run([command, '--update-cache']);

    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`Unknown ${command} option: --update-cache.`);
    expect(result.exitCode).toBe(2);
    if (command === 'generate') {
      expect(runGenerateCommand).not.toHaveBeenCalled();
    } else {
      expect(runCheckCommand).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['allow-empty', ['run', '--allow-empty'], { allowEmpty: true, list: false }],
    ['list', ['run', '--list'], { allowEmpty: false, list: true }],
    ['allow-empty and list', ['run', '--allow-empty', '--list'], { allowEmpty: true, list: true }],
  ] as const)('parses the run %s flag combination', async (_description, argv, expectedInput) => {
    runRunCommand.mockResolvedValue({ exitCode: 0, envelope: RUN_ENVELOPE });

    await run(argv);

    expect(runRunCommand).toHaveBeenCalledWith(expect.objectContaining(expectedInput));
  });

  it('disables ANSI styling for human run output with --no-color', async () => {
    runRunCommand.mockResolvedValue({
      exitCode: 1,
      envelope: { ...RUN_ENVELOPE, results: [{ file: 'login.test.md', status: 'failed' }] },
    });

    const result = await run(['run', '--no-color']);

    expect(runRunCommand).toHaveBeenCalledOnce();
    expect(result.stdout).toContain('failed login.test.md');
    expect(result.stdout).not.toMatch(/\u001B\[/);
  });

  it('treats values after -- as literal paths, including option-shaped names', async () => {
    runRunCommand.mockResolvedValue({ exitCode: 0, envelope: RUN_ENVELOPE });

    await run(['run', '--', '--not-an-option.test.md']);

    expect(runRunCommand).toHaveBeenCalledWith(expect.objectContaining({ files: ['--not-an-option.test.md'] }));
  });

  it.each([
    ['unknown run flag even with JSON requested', ['run', '--json', '--unknown']],
    ['missing grep value', ['run', '--grep']],
    ['missing target value', ['run', '--target']],
    ['missing stale value', ['run', '--stale']],
    ['missing AI provider value', ['run', '--ai']],
    ['unsupported provider', ['run', '--ai', 'other']],
  ] as const)('writes plain usage to stderr and exits 2 for %s', async (_description, argv) => {
    const result = await run(argv);

    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/usage|unknown|missing|must be/i);
    expect(result.stderr.trim().startsWith('{')).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(runRunCommand).not.toHaveBeenCalled();
  });

  it('rejects a malformed run grep pattern before command composition', async () => {
    const result = await run(['run', '--json', '--grep', '[']);

    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/grep.*valid regular expression/i);
    expect(result.stderr.trim().startsWith('{')).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(runRunCommand).not.toHaveBeenCalled();
  });

  it('rejects an unsupported run stale policy as a parse-usage error', async () => {
    const result = await run(['run', '--stale', 'other']);

    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/stale.*fail.*regenerate/i);
    expect(result.stderr.trim().startsWith('{')).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(runRunCommand).not.toHaveBeenCalled();
  });

  it('short-circuits command-local run help before calling runtime', async () => {
    const result = await run(['run', '--help']);

    expect(result.stdout).toMatch(/run \[files\.\.\.\].*replay deterministic plans/i);
    const runOptions = result.stdout.slice(result.stdout.indexOf('Run options:'), result.stdout.indexOf('Check options:'));
    expect(runOptions).toContain('--stale <fail>');
    expect(runOptions).toContain('--no-color');
    expect(runOptions).not.toContain('--stale <fail|regenerate>');
    expect(runOptions).toContain('--ai <claude|codex>');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(runRunCommand).not.toHaveBeenCalled();
  });

  it('documents --allow-empty and --list in run usage text', async () => {
    const result = await run(['run', '--help']);
    const runOptions = result.stdout.slice(result.stdout.indexOf('Run options:'));

    expect(runOptions).toContain('--allow-empty');
    expect(runOptions).toContain('--list');
  });

  it('passes check positionals and every supported flag to runtime', async () => {
    runCheckCommand.mockResolvedValue({ exitCode: 4, envelope: CHECK_ENVELOPE });

    await run([
      'check',
      'login.test.md',
      'checkout.test.md',
      '--target',
      'web',
      '--allow-empty',
      '--list',
      '--json',
      '--config',
      'ambercast.config.json',
      '--no-color',
    ]);

    expect(runCheckCommand).toHaveBeenCalledWith(expect.objectContaining({
      files: ['login.test.md', 'checkout.test.md'],
      target: 'web',
      allowEmpty: true,
      list: true,
      configPathOverride: 'ambercast.config.json',
    }));
  });

  it('treats option-shaped check paths after -- as literal positionals', async () => {
    runCheckCommand.mockResolvedValue({ exitCode: 0, envelope: CHECK_ENVELOPE });

    await run(['check', '--', '--literal.test.md']);

    expect(runCheckCommand).toHaveBeenCalledWith(expect.objectContaining({ files: ['--literal.test.md'] }));
  });

  it('rejects an unknown check flag before runtime composition', async () => {
    const result = await run(['check', '--unknown']);

    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown check option: --unknown.');
    expect(result.exitCode).toBe(2);
    expect(runCheckCommand).not.toHaveBeenCalled();
  });

  it.each([
    '--strict',
    '--force',
    '--dry-run',
    '--ai',
    '--grep',
    '--headed',
    '--cache-only',
    '--stale',
    '--update-cache',
  ] as const)('rejects the generate/run-only %s flag before runtime composition', async (flag) => {
    const result = await run(['check', flag]);

    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`Unknown check option: ${flag}.`);
    expect(result.exitCode).toBe(2);
    expect(runCheckCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['target', ['check', '--target']],
    ['config', ['check', '--config']],
  ] as const)('rejects a check %s flag missing its value before runtime composition', async (_name, argv) => {
    const result = await run(argv);

    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`Missing value for --${_name}.`);
    expect(result.exitCode).toBe(2);
    expect(runCheckCommand).not.toHaveBeenCalled();
  });

  it('short-circuits check help before runtime composition', async () => {
    const result = await run(['check', '--help']);

    expect(result.stdout).toMatch(/check \[files\.\.\.\].*check plan freshness/i);
    expect(result.stdout).toContain('Check options:');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(runCheckCommand).not.toHaveBeenCalled();
  });

  it('dispatches check to runtime and renders exactly one JSON check envelope', async () => {
    runCheckCommand.mockResolvedValue({ exitCode: 4, envelope: CHECK_ENVELOPE });

    const result = await run(['check', '--json']);

    expect(runCheckCommand).toHaveBeenCalledOnce();
    expect(ReportEnvelope.parse(JSON.parse(result.stdout))).toEqual(CHECK_ENVELOPE);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(4);
  });

  it('renders fresh green and non-fresh non-green check rows with their reasons', async () => {
    runCheckCommand.mockResolvedValue({ exitCode: 4, envelope: CHECK_ENVELOPE });

    const result = await run(['check']);

    expect(result.stdout).toContain('\u001B[32mfresh\u001B[0m fresh.test.md: The plan matches the current prompt and target.');
    expect(result.stdout).toContain('\u001B[31mstale\u001B[0m stale.test.md: The plan is stale for the current prompt or target.');
    expect(result.exitCode).toBe(4);
  });

  it('renders the uncommitted grounding waiver as a healthy green check row', async () => {
    runCheckCommand.mockResolvedValue({
      exitCode: 0,
      envelope: {
        ...CHECK_ENVELOPE,
        summary: { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 },
        results: [{
          id: 'fresh.test.md', file: 'fresh.test.md', planFile: 'fresh.ambercast.plan.json',
          status: 'fresh-without-grounding',
          reason: "The plan is fresh; a grounding cache is not required by this project's repository policy.",
        }],
      },
    } as never);

    const result = await run(['check']);

    expect(result.stdout).toContain('\u001B[32mfresh-without-grounding\u001B[0m fresh.test.md');
    expect(result.exitCode).toBe(0);
  });

  it('passes a check runtime exit code through unchanged', async () => {
    runCheckCommand.mockResolvedValue({ exitCode: 3, envelope: { ...CHECK_ENVELOPE, errors: [{
      scope: 'case', kind: 'environment', code: 'FS_IO_ERROR', caseId: 'broken.test.md', message: 'read failed',
    }] } });

    const result = await run(['check', '--no-color']);

    expect(runCheckCommand).toHaveBeenCalledWith(expect.objectContaining({
      allowEmpty: false,
      list: false,
    } satisfies Partial<CheckCommandInput>));
    expect(result.stdout).not.toContain('\u001B[');
    expect(result.exitCode).toBe(3);
  });

  it.each([
    ['dry-run', ['heal', '--dry-run'], { dryRun: true }],
    ['target', ['heal', '--target', 'web'], { target: 'web' }],
    ['Claude provider', ['heal', '--ai', 'claude'], { aiProviderOverride: 'claude' }],
    ['Codex provider', ['heal', '--ai', 'codex'], { aiProviderOverride: 'codex' }],
    ['allow-empty', ['heal', '--allow-empty'], { allowEmpty: true }],
    ['list', ['heal', '--list'], { list: true }],
  ] as const)('parses the documented heal %s flag', async (_description, argv, expectedInput) => {
    runHealCommand.mockResolvedValue({ exitCode: 0, envelope: HEAL_ENVELOPE });

    await run(argv);

    expect(runHealCommand).toHaveBeenCalledWith(expect.objectContaining(expectedInput));
  });

  it('treats --yes and -y as interchangeable through the real heal parser', async () => {
    runHealCommand.mockResolvedValue({ exitCode: 0, envelope: HEAL_ENVELOPE });

    await run(['heal', '--yes']);
    const longForm = runHealCommand.mock.calls[0]?.[0] as HealCommandInput;
    runHealCommand.mockClear();

    await run(['heal', '-y']);
    const shortForm = runHealCommand.mock.calls[0]?.[0] as HealCommandInput;

    expect(longForm).toMatchObject({ yes: true });
    expect(shortForm).toMatchObject({ yes: true });
    const { signal: _longSignal, stderr: _longStderr, ...longComparable } = longForm;
    const { signal: _shortSignal, stderr: _shortStderr, ...shortComparable } = shortForm;
    expect(shortComparable).toEqual(longComparable);
  });

  it('passes literal heal paths and option-shaped paths after -- to runtime', async () => {
    runHealCommand.mockResolvedValue({ exitCode: 0, envelope: HEAL_ENVELOPE });

    await run(['heal', 'login.test.md', 'checkout.test.md']);
    expect(runHealCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      files: ['login.test.md', 'checkout.test.md'],
    }));

    await run(['heal', '--', '--not-an-option.test.md']);
    expect(runHealCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      files: ['--not-an-option.test.md'],
    }));
  });

  it.each([
    ['unknown heal flag even with JSON requested', ['heal', '--json', '--unknown']],
    ['missing target value', ['heal', '--target']],
    ['missing AI provider value', ['heal', '--ai']],
    ['unsupported provider', ['heal', '--ai', 'other']],
  ] as const)('writes plain usage to stderr and exits 2 for %s', async (_description, argv) => {
    const result = await run(argv);

    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/usage|unknown|missing|must be/i);
    expect(result.stderr.trim().startsWith('{')).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(runHealCommand).not.toHaveBeenCalled();
  });

  it('short-circuits command-local heal help before calling runtime', async () => {
    const result = await run(['heal', '--help']);

    expect(result.stdout).toMatch(/heal \[files\.\.\.\].*repair deterministic plans/i);
    expect(result.stdout).toContain('--yes, -y');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(runHealCommand).not.toHaveBeenCalled();
  });

  it('renders exactly one JSON heal envelope and forwards target selection to runtime', async () => {
    runHealCommand.mockResolvedValue({ exitCode: 1, envelope: HEAL_ENVELOPE });

    const result = await run(['heal', '--json', '--target', 'web']);

    expect(runHealCommand).toHaveBeenCalledWith(expect.objectContaining({
      target: 'web',
    } satisfies Partial<HealCommandInput>));
    expect(ReportEnvelope.parse(JSON.parse(result.stdout))).toEqual(HEAL_ENVELOPE);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(1);
  });

  it('disables ANSI styling for human heal output with --no-color', async () => {
    runHealCommand.mockResolvedValue({
      exitCode: 1,
      envelope: {
        ...HEAL_ENVELOPE,
        summary: { total: 1, passed: 0, failed: 1, errored: 0, skipped: 0 },
        results: [{
          id: 'login.test.md', file: 'login.test.md', planFile: 'login.ambercast.plan.json',
          status: 'completed', repairOutcome: 'unresolved', application: 'no-artifact-change', stopReason: 'settled', steps: [], explanation: 'The repair did not resolve the case.',
          durationMs: 0,
        }],
      },
    });

    const result = await run(['heal', '--no-color']);

    expect(runHealCommand).toHaveBeenCalledOnce();
    expect(result.stdout).toContain('completed login.test.md');
    expect(result.stdout).not.toMatch(/\u001B\[/);
  });

  it.each([
    ['applied', 'healed', '32'],
    ['preview-only', 'healed', '32'],
    ['no-artifact-change', 'no-changes-needed', '32'],
    ['no-artifact-change', 'unresolved', '31'],
    ['applied', 'partially-healed', '31'],
    ['declined', 'healed', '31'],
    ['not-applied-interrupted', 'healed', '31'],
    ['apply-failed', 'healed', '31'],
    ['partially-applied', 'healed', '31'],
    ['not-eligible', 'unresolved', '31'],
  ] as const)('colors a completed heal row with application %s using ANSI %s', (application, repairOutcome, color) => {
    const rendered = renderHumanReport({
      ...HEAL_ENVELOPE,
      summary: { total: 1, passed: 0, failed: 1, errored: 0, skipped: 0 },
      results: [{
        id: 'login.test.md', file: 'login.test.md', planFile: 'login.ambercast.plan.json',
        status: 'completed', repairOutcome, application, stopReason: 'settled',
        steps: [], explanation: 'The repair attempt completed.', durationMs: 0,
      }],
    } as never, true);

    expect(rendered).toContain(`\u001B[${color}mcompleted\u001B[0m login.test.md`);
  });

  it.each([
    ['generate', runGenerateCommand, ENVELOPE, 'generate login.test.md: ai call 1/2\n'],
    ['run', runRunCommand, RUN_ENVELOPE, 'run login.test.md [step-1]: ai call 1/1\n'],
    ['heal', runHealCommand, HEAL_ENVELOPE, 'heal login.test.md [step-1]: ai call 1/1\n'],
    ['check', runCheckCommand, CHECK_ENVELOPE, ''],
  ] as const)('threads the identical stderr reference into %s while keeping JSON stdout isolated', async (command, runtimeCommand, envelope, progress) => {
    const stdout = new MemoryWritable();
    const stderr = new MemoryWritable();
    runtimeCommand.mockImplementation(async (commandInput: { readonly stderr: NodeJS.WritableStream }) => {
      if (progress !== '') commandInput.stderr.write(progress);
      return { exitCode: 0, envelope };
    });

    await main([command, '--json'], stdout, stderr);

    expect(runtimeCommand).toHaveBeenCalledOnce();
    expect(runtimeCommand.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ stderr }));
    expect(runtimeCommand.mock.calls[0]?.[0]?.stderr).toBe(stderr);
    expect(stdout.text).toBe(`${JSON.stringify(envelope)}\n`);
    expect(stderr.text).toBe(progress);
  });

  describe('renderHumanReport', () => {
    it('renders the run-scope error line without optional hint or details', () => {
      const rendered = renderHumanReport({
        ...RUN_ENVELOPE,
        errors: [{ scope: 'run', kind: 'environment', code: 'AI_EXECUTOR_UNAVAILABLE', message: 'executor unavailable' }],
      } as never, false);

      expect(rendered).toBe('error AI_EXECUTOR_UNAVAILABLE: executor unavailable\n');
    });

    it('renders a run-scope error with hint and ordered details without ANSI when color is disabled', () => {
      const rendered = renderHumanReport({
        ...RUN_ENVELOPE,
        errors: [{
          scope: 'run', kind: 'environment', code: 'AI_RESPONSE_INVALID', message: 'invalid response', hint: 'retry',
          details: { issues: [{ code: 'invalid-json', path: [] }], attempts: [{ attempt: 1, code: 'AI_RESPONSE_INVALID' }] },
        }],
      } as never, false);

      expect(rendered).toBe('error AI_RESPONSE_INVALID: invalid response\n  hint: retry\n  details: issues=invalid-json @ []; attempts=[{"attempt":1,"code":"AI_RESPONSE_INVALID"}]\n');
    });

    it.each([
      ['SECRET_LITERAL_REJECTED', 'usage', { detector: 'credential-prefix-sk', path: 'generatorMeta.key', attempts: [] }, 'detector=credential-prefix-sk; path=generatorMeta.key; attempts=[]'],
      ['SECRET_GRANT_UNATTRIBUTABLE', 'usage', { reason: 'citation-not-found', secretRef: '{{secrets.API_TOKEN}}', stepId: 'step-a', attempts: [] }, 'reason=citation-not-found; secretRef={{secrets.API_TOKEN}}; stepId=step-a; attempts=[]'],
      ['AI_EXECUTOR_UNAVAILABLE', 'environment', { attempts: [] }, 'attempts=[]'],
      ['UNEXPECTED_CRASH', 'environment', { cause: { name: 'AbortError' } }, 'cause={"name":"AbortError"}'],
      ['FS_IO_ERROR', 'environment', { partiallyWritten: ['plan', 'grounding'] }, 'partiallyWritten=["plan","grounding"]'],
      ['PROMPT_PATH_INVALID', 'usage', { path: 'other/foo.md', reason: 'outside-test-dir' }, 'path=other/foo.md; reason=outside-test-dir'],
      ['PROMPT_PATH_INVALID', 'usage', { path: 'other/foo.md', reason: 'not-test-md' }, 'path=other/foo.md; reason=not-test-md'],
      ['PROMPT_PATH_INVALID', 'usage', { path: 'unsafe\u001bname.test.md', reason: 'no-name' }, 'path=unsafe\\u001bname.test.md; reason=no-name'],
    ] as const)('renders ordered details for %s', (code, kind, details, expected) => {
      const rendered = renderHumanReport({
        ...RUN_ENVELOPE,
        errors: [{ scope: 'run', kind, code, message: 'message', details }],
      } as never, false);

      expect(rendered).toBe(`error ${code}: message\n  details: ${expected}\n`);
    });

    it('omits the details line entirely when formatting yields no content', () => {
      const rendered = renderHumanReport({
        ...RUN_ENVELOPE,
        errors: [{ scope: 'run', kind: 'environment', code: 'AI_EXECUTOR_UNAVAILABLE', message: 'message', details: {} }],
      } as never, false);

      expect(rendered).toBe('error AI_EXECUTOR_UNAVAILABLE: message\n');
    });

    it.each([
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
      '__proto__',
    ])('ignores inherited registry key %s when rendering details', (code) => {
      const rendered = renderHumanReport({
        ...RUN_ENVELOPE,
        errors: [{ scope: 'run', kind: 'environment', code, message: 'message', details: { unexpected: 'value' } }],
      } as never, false);

      expect(rendered).toBe(`error ${code}: message\n`);
    });

    it('registers every ReportError code that declares a details branch', () => {
      const detailsCodes = new Set<string>();
      const walkSchema = (node: unknown): void => {
        if (node === null || typeof node !== 'object' || Array.isArray(node)) {
          throw new Error(`Unrecognized JSON Schema shape: ${JSON.stringify(node)}`);
        }

        const schema = node as Record<string, unknown>;
        if (Object.hasOwn(schema, 'allOf') || Object.hasOwn(schema, '$ref')) {
          throw new Error(`Unsupported JSON Schema composition: ${JSON.stringify(schema)}`);
        }

        const alternatives = schema.anyOf ?? schema.oneOf;
        if (alternatives !== undefined) {
          if (Object.hasOwn(schema, 'anyOf') && Object.hasOwn(schema, 'oneOf')) {
            throw new Error(`Unrecognized JSON Schema shape: ${JSON.stringify(schema)}`);
          }
          if (!Array.isArray(alternatives)) {
            throw new Error(`Unrecognized JSON Schema shape: ${JSON.stringify(schema)}`);
          }
          alternatives.forEach(walkSchema);
          return;
        }

        const properties = schema.properties;
        if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
          throw new Error(`Unrecognized JSON Schema shape: ${JSON.stringify(schema)}`);
        }

        const fields = properties as Record<string, unknown>;
        const code = fields.code;
        if (
          code === null || typeof code !== 'object' || Array.isArray(code)
          || typeof (code as Record<string, unknown>).const !== 'string'
          || !Object.hasOwn(fields, 'scope')
          || !Object.hasOwn(fields, 'kind')
          || !Object.hasOwn(fields, 'message')
        ) {
          throw new Error(`Unrecognized JSON Schema shape: ${JSON.stringify(schema)}`);
        }

        if (Object.hasOwn(fields, 'details')) {
          detailsCodes.add((code as { const: string }).const);
        }
      };

      walkSchema(z.toJSONSchema(ReportError));

      expect(detailsCodes).toEqual(new Set(Object.keys(ERROR_DETAILS_KEY_ORDER)));
    });

    it('renders a case-scope error with an escaped case ID and hint only', () => {
      const rendered = renderHumanReport({
        ...RUN_ENVELOPE,
        errors: [{ scope: 'case', kind: 'usage', code: 'SECRET_LITERAL_REJECTED', caseId: 'case\u001b\nnext', message: 'message', hint: 'hint' }],
      } as never, false);

      expect(rendered).toBe('error SECRET_LITERAL_REJECTED [case\\u001b\\nnext]: message\n  hint: hint\n');
    });

    it('renders a case-scope error with details but no hint', () => {
      const rendered = renderHumanReport({
        ...RUN_ENVELOPE,
        errors: [{
          scope: 'case', kind: 'environment', code: 'FS_IO_ERROR', caseId: 'write-plan', message: 'write failed',
          details: { partiallyWritten: ['plan'] },
        }],
      } as never, false);

      expect(rendered).toBe('error FS_IO_ERROR [write-plan]: write failed\n  details: partiallyWritten=["plan"]\n');
    });

    it('renders a browser-launch error with its fixed hint and ordered details', () => {
      const rendered = renderHumanReport({
        ...RUN_ENVELOPE,
        errors: [{
          scope: 'case', kind: 'environment', code: 'BROWSER_LAUNCH_FAILED', caseId: 'launch', message: 'browser failed',
          hint: 'Install Chromium by running `npx playwright install chromium`, then retry.',
          details: { engine: 'chromium', reason: 'executable-missing' },
        }],
      } as never, false);

      expect(rendered).toBe('error BROWSER_LAUNCH_FAILED [launch]: browser failed\n  hint: Install Chromium by running `npx playwright install chromium`, then retry.\n  details: reason=executable-missing; engine=chromium\n');
    });

    it('renders a browser-launch error with its fixed hint and no details', () => {
      const rendered = renderHumanReport({
        ...RUN_ENVELOPE,
        errors: [{
          scope: 'run', kind: 'environment', code: 'BROWSER_LAUNCH_FAILED', message: 'browser failed',
          hint: 'Install Chromium by running `npx playwright install chromium`, then retry.',
        }],
      } as never, false);

      expect(rendered).toBe('error BROWSER_LAUNCH_FAILED: browser failed\n  hint: Install Chromium by running `npx playwright install chromium`, then retry.\n');
    });

    it('renders an empty issue collection as an exact details field', () => {
      const rendered = renderHumanReport({
        ...RUN_ENVELOPE,
        errors: [{
          scope: 'run', kind: 'environment', code: 'AI_RESPONSE_INVALID', message: 'message',
          details: { issues: [], attempts: [] },
        }],
      } as never, false);

      expect(rendered).toBe('error AI_RESPONSE_INVALID: message\n  details: issues=; attempts=[]\n');
    });

    it('escapes DEL and C1 characters that reach details through JSON serialization', () => {
      const rendered = renderHumanReport({
        ...RUN_ENVELOPE,
        errors: [{
          scope: 'run', kind: 'environment', code: 'AI_RESPONSE_INVALID', message: 'message',
          details: { issues: [{ code: 'schema-mismatch', path: ['dynamic\u007f\u0080'] }], attempts: [] },
        }],
      } as never, false);

      expect(rendered).toContain('\\u007f\\u0080');
    });

    it('escapes DEL and C1 characters in non-issues object details', () => {
      const rendered = renderHumanReport({
        ...RUN_ENVELOPE,
        errors: [{
          scope: 'run', kind: 'usage', code: 'SECRET_GRANT_UNATTRIBUTABLE', message: 'message',
          details: {
            reason: 'uncovered-grant',
            secretRef: '{{secrets.API_TOKEN}}',
            sourceSpan: { startLine: 'unsafe\u007f\u0080', endLine: 2 },
          },
        }],
      } as never, false);

      expect(rendered).toBe('error SECRET_GRANT_UNATTRIBUTABLE: message\n  details: reason=uncovered-grant; secretRef={{secrets.API_TOKEN}}; sourceSpan={"startLine":"unsafe\\u007f\\u0080","endLine":2}\n');
    });

    it('renders normal filesystem and error text as exact report lines', () => {
      const rendered = renderHumanReport({
        ...CHECK_ENVELOPE,
        results: [{
          ...CHECK_ENVELOPE.results[0],
          file: 'normal.test.md',
          reason: 'The plan is current.',
        }],
        errors: [{ message: 'No control characters appear here.' }],
      } as never, false);

      expect(rendered).toBe('fresh normal.test.md: The plan is current.\nerror No control characters appear here.\n');
    });

    it.each([
      ['backspace', '\u0008', '\\b'],
      ['tab', '\u0009', '\\t'],
      ['newline', '\u000a', '\\n'],
      ['form feed', '\u000c', '\\f'],
      ['carriage return', '\u000d', '\\r'],
    ])('renders %s in a file as its named escape', (_name, character, escaped) => {
      const rendered = renderHumanReport({
        ...ENVELOPE,
        results: [{ ...ENVELOPE.results[0], file: `prefix${character}suffix.test.md` }],
      } as never, false);

      expect(rendered).toBe(`listed prefix${escaped}suffix.test.md\n`);
    });

    it.each([
      ['the lower C0 boundary', '\u0000', '\\u0000'],
      ['the upper C0 boundary', '\u001f', '\\u001f'],
      ['space immediately above C0', ' ', ' '],
      ['DEL', '\u007f', '\\u007f'],
      ['the lower C1 boundary', '\u0080', '\\u0080'],
      ['the upper C1 boundary', '\u009f', '\\u009f'],
      ['the character immediately above C1', '\u00a0', '\u00a0'],
    ])('renders %s with the exact expected file text', (_name, character, expected) => {
      const rendered = renderHumanReport({
        ...ENVELOPE,
        results: [{ ...ENVELOPE.results[0], file: `prefix${character}suffix.test.md` }],
      } as never, false);

      expect(rendered).toBe(`listed prefix${expected}suffix.test.md\n`);
    });

    it('escapes ESC embedded in a file value', () => {
      const rendered = renderHumanReport({
        ...ENVELOPE,
        results: [{ ...ENVELOPE.results[0], file: 'unsafe\u001bname.test.md' }],
      } as never, false);

      expect(rendered).toBe('listed unsafe\\u001bname.test.md\n');
    });

    it('escapes a CRLF combination in a reason without splitting the output line', () => {
      const rendered = renderHumanReport({
        ...CHECK_ENVELOPE,
        results: [{
          ...CHECK_ENVELOPE.results[1],
          file: 'stale.test.md',
          reason: 'First line\r\nsecond line',
        }],
      } as never, false);

      expect(rendered).toBe('stale stale.test.md: First line\\r\\nsecond line\n');
    });

    it('escapes a C1 control character in an error message', () => {
      const rendered = renderHumanReport({
        ...ENVELOPE,
        errors: [{ message: 'Unexpected\u0085failure' }],
      } as never, false);

      expect(rendered).toBe('listed login.test.md\nerror Unexpected\\u0085failure\n');
    });

    it('escapes a control character in the id fallback when file is absent', () => {
      const rendered = renderHumanReport({
        ...ENVELOPE,
        results: [{ ...ENVELOPE.results[0], id: 'fallback\u001bname.test.md', file: undefined }],
      } as never, false);

      expect(rendered).toBe('listed fallback\\u001bname.test.md\n');
    });

    it('preserves a literal backslash in a file value', () => {
      const rendered = renderHumanReport({
        ...ENVELOPE,
        results: [{ ...ENVELOPE.results[0], file: 'folder\\name.test.md' }],
      } as never, false);

      expect(rendered).toBe('listed folder\\name.test.md\n');
    });

    it('writes control-character-bearing envelopes unchanged with --json', async () => {
      const expectedJson = JSON.stringify({
        ...ENVELOPE,
        results: [{ ...ENVELOPE.results[0], file: 'unsafe\u001bname.test.md' }],
      });
      const envelope = {
        ...ENVELOPE,
        results: [{ ...ENVELOPE.results[0], file: 'unsafe\u001bname.test.md' }],
      };
      runGenerateCommand.mockResolvedValue({ exitCode: 0, envelope });

      const result = await run(['generate', '--json']);

      expect(result.stdout).toBe(`${expectedJson}\n`);
    });
  });
});

describe('manifest-driven CLI parser contracts', () => {
  it.each([
    ['top-level help', ['--help']],
    ['top-level help adjacent to --version', ['--help', '--version']],
    ['generate command-local help', ['generate', '--help']],
    ['run command-local help', ['run', '--help']],
    ['check command-local help', ['check', '--help']],
    ['heal command-local help', ['heal', '--help']],
  ] as const)('writes the captured usage bytes for %s', async (_description, argv) => {
    const result = await run(argv);

    expect(result.stdout).toBe(expectedUsage);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ['generate', ['generate', '--headed'], '--headed'],
    ['generate', ['generate', '--cache-only'], '--cache-only'],
    ['run', ['run', '--force'], '--force'],
    ['run', ['run', '--strict'], '--strict'],
    ['check', ['check', '--yes'], '--yes'],
    ['heal', ['heal', '--config', 'ambercast.config.json'], '--config'],
    ['heal', ['heal', '--headed'], '--headed'],
  ] as const)('rejects the foreign %s option %s through that command\'s own manifest lookup', async (command, argv, flag) => {
    const result = await run(argv);

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`Unknown ${command} option: ${flag}.\n${expectedUsage}`);
    expect(result.exitCode).toBe(2);
  });

  it.each([
    ['generate', runGenerateCommand, ENVELOPE],
    ['run', runRunCommand, RUN_ENVELOPE],
    ['check', runCheckCommand, CHECK_ENVELOPE],
  ] as const)('preserves -y outside heal as a literal positional path for %s', async (command, runtimeCommand, envelope) => {
    runtimeCommand.mockResolvedValue({ exitCode: 0, envelope });

    await run([command, '-y']);

    expect(runtimeCommand).toHaveBeenCalledWith(expect.objectContaining({ files: ['-y'] }));
  });

  it.each([
    ['generate --ai', ['generate', '--ai', 'other'], 'The --ai value must be claude or codex.'],
    ['run --ai', ['run', '--ai', 'other'], 'The --ai value must be claude or codex.'],
    ['heal --ai', ['heal', '--ai', 'other'], 'The --ai value must be claude or codex.'],
    ['run --stale', ['run', '--stale', 'other'], 'The --stale value must be fail or regenerate.'],
  ] as const)('keeps the manifest-derived enum rejection text exact for %s', async (_description, argv, message) => {
    const result = await run(argv);

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${message}\n${expectedUsage}`);
    expect(result.exitCode).toBe(2);
  });
});

describe('manifest-driven CLI parser compatibility boundaries', () => {
  it.each([
    ['generate', ['generate', '--target', '--json'], '--target'],
    ['run', ['run', '--grep', '--json'], '--grep'],
    ['check', ['check', '--target', '--json'], '--target'],
    ['heal', ['heal', '--target', '--json'], '--target'],
  ] as const)('does not consume a following known flag as the missing %s value', async (command, argv, flag) => {
    const result = await run(argv);

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`Missing value for ${flag}.\n${expectedUsage}`);
    expect(result.exitCode).toBe(2);
  });

  it.each([
    ['generate consumes -y as a --target value', ['generate', '--target', '-y'], runGenerateCommand, ENVELOPE, { target: '-y' }],
    ['check keeps an unregistered single-hyphen token as a positional path', ['check', '-x'], runCheckCommand, CHECK_ENVELOPE, { files: ['-x'] }],
    ['generate keeps the final duplicate --target value', ['generate', '--target', 'a', '--target', 'b'], runGenerateCommand, ENVELOPE, { target: 'b' }],
    ['generate keeps --help after the separator as a literal positional path', ['generate', '--', '--help'], runGenerateCommand, ENVELOPE, { files: ['--help'] }],
  ] as const)('preserves %s', async (_description, argv, runtimeCommand, envelope, expectedInput) => {
    runtimeCommand.mockResolvedValue({ exitCode: 0, envelope });

    const result = await run(argv);

    expect(runtimeCommand).toHaveBeenCalledWith(expect.objectContaining(expectedInput));
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ['generate', ['generate', '--target=web'], '--target=web'],
  ] as const)('rejects unsupported combined value syntax for %s', async (command, argv, flag) => {
    const result = await run(argv);

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`Unknown ${command} option: ${flag}.\n${expectedUsage}`);
    expect(result.exitCode).toBe(2);
  });
});
