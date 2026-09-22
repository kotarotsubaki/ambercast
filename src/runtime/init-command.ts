import { join, relative, resolve } from 'node:path';
import { createFsStorage } from '#adapters/storage/fs-storage.js';
import { createDirectoryCheck } from '#adapters/system/directory-check.js';
import { createInitConfirmationReader } from '#adapters/system/init-confirmation-reader.js';
import { createProcessEnvironmentInfo } from '#adapters/system/process-environment-info.js';
import { createTtyInteractivityCheck } from '#adapters/system/tty-interactivity.js';
import type { StorageAdapter } from '#ports/storage.js';
import { escapeControlChars } from '#runtime/control-chars.js';
import { applyInitPlan, planInit, type InitArtifactTargets, type InitFileApplyResult, type InitFileApplyResults, type InitPlan } from '#usecases/init.js';

/**
 * Defines runtime composition for the init command's preflight, confirmation,
 * and application boundaries.
 *
 * This layer maps those expected outcomes to meaningful exit codes instead of
 * letting them reach `main()`'s generic catch, which would collapse them into
 * exit code 3. CLI dispatch still invokes this command inside that catch as a
 * defense against an unexpected programming error.
 */
export interface InitCommandInput {
  readonly dir: string | undefined;
  readonly yes: boolean;
  readonly force: boolean;
  readonly cwd: string;
  readonly stderr: NodeJS.WritableStream;
  readonly signal?: AbortSignal;
}

/** Supplies runtime-owned ports and environment predicates for init. */
export interface InitCommandDeps {
  readonly storage: StorageAdapter;
  readonly isCI: boolean;
  readonly isInteractive: () => boolean;
  readonly isDirectory: (absolutePath: string) => Promise<boolean>;
  readonly readConfirmationAnswer: (signal?: AbortSignal) => Promise<'authorized' | 'declined' | 'interrupted'>;
}

/** Describes one artifact's path and final visible application state. */
export interface InitFileState {
  readonly path: string;
  readonly state: 'written' | 'skipped' | 'failed' | 'not-attempted';
}

/** A result row for an artifact that required no change. */
export interface InitSkippedFileState {
  readonly path: string;
  readonly state: 'skipped';
}

/** A result row for a successfully completed apply. */
export interface InitCompletedFileState {
  readonly path: string;
  readonly state: 'written' | 'skipped';
}

export type InitFileStates = readonly [InitFileState, InitFileState, InitFileState, InitFileState];

export type InitSkippedFileStates = readonly [
  InitSkippedFileState,
  InitSkippedFileState,
  InitSkippedFileState,
  InitSkippedFileState,
];

export type InitCompletedFileStates = readonly [
  InitCompletedFileState,
  InitCompletedFileState,
  InitCompletedFileState,
  InitCompletedFileState,
];

function toVisibleState(result: InitFileApplyResult, directory: string): InitFileState {
  return {
    path: escapeControlChars(relative(directory, result.path).replaceAll('\\', '/')),
    state: result.state,
  };
}

function toFileStates(results: InitFileApplyResults, directory: string): InitFileStates {
  const [config, sample, gitignore, agents] = results;
  return [
    toVisibleState(config, directory),
    toVisibleState(sample, directory),
    toVisibleState(gitignore, directory),
    toVisibleState(agents, directory),
  ];
}

function toCompletedFileStates(results: InitFileApplyResults, directory: string): InitCompletedFileStates {
  const [config, sample, gitignore, agents] = results;
  const stateFor = (result: InitFileApplyResult): InitCompletedFileState => ({
    path: escapeControlChars(relative(directory, result.path).replaceAll('\\', '/')),
    state: result.state === 'skipped' ? 'skipped' : 'written',
  });
  return [stateFor(config), stateFor(sample), stateFor(gitignore), stateFor(agents)];
}

/**
 * Represents every normal terminal outcome of the init command.
 *
 * @remarks
 * `phase` distinguishes pre-apply from applying failures and interruptions.
 * The same outcome label has no state rows before application but exactly four
 * rows once application starts, so the discriminated union enforces that
 * cardinality instead of leaving it to callers' convention.
 */
export type InitCommandOutput =
  | { readonly outcome: 'rejected'; readonly states: readonly []; readonly message: string; readonly exitCode: 2 }
  | { readonly outcome: 'declined'; readonly states: readonly []; readonly message: null; readonly exitCode: 0 }
  | { readonly outcome: 'nothing-to-do'; readonly states: InitSkippedFileStates; readonly message: null; readonly exitCode: 0 }
  | { readonly outcome: 'interrupted'; readonly phase: 'pre-apply'; readonly states: readonly []; readonly message: string; readonly exitCode: 3 }
  | { readonly outcome: 'interrupted'; readonly phase: 'applying'; readonly states: InitFileStates; readonly message: string; readonly exitCode: 3 }
  | { readonly outcome: 'failed'; readonly phase: 'pre-apply'; readonly states: readonly []; readonly message: string; readonly exitCode: 3 }
  | { readonly outcome: 'failed'; readonly phase: 'applying'; readonly states: InitFileStates; readonly message: string; readonly exitCode: 3 }
  | { readonly outcome: 'written'; readonly states: InitCompletedFileStates; readonly message: null; readonly exitCode: 0 };

/**
 * Runs init through directory validation, planning, authorization, and apply.
 *
 * @param input - Parsed command data, process context, and output stream.
 * @param deps - Optional runtime ports and environment predicates for
 * composition or deterministic tests.
 * @returns A rendering-ready, non-throwing result for every expected command
 * outcome.
 * @remarks
 * CLI argument parsing precedes this function. Runtime then validates the
 * resolved directory, rejects non-interactive use without authorization, and
 * builds the plan by reading configuration, sample, `.gitignore`, and
 * `AGENTS.md` in that order, stopping at the first failure. Once planning
 * succeeds, the plan is always written to stderr before the all-skipped test,
 * so even a no-op invocation displays what was inspected.
 *
 * Expected preflight, confirmation, interruption, and application failures
 * are returned as `InitCommandOutput` so their exit-code meanings survive the
 * CLI boundary. An interruption before apply writes nothing and has no state
 * rows; an interruption after apply begins preserves the completed prefix and
 * reports four state rows. An unexpected invariant violation may still reach
 * the dispatcher's defensive catch.
 */
export async function runInitCommand(
  input: InitCommandInput,
  deps?: Partial<InitCommandDeps>,
): Promise<InitCommandOutput> {
  const messageFor = (error: unknown): string => error instanceof Error ? error.message : String(error);
  const preApplyInterrupted = (): InitCommandOutput => ({
    outcome: 'interrupted',
    phase: 'pre-apply',
    states: [],
    message: 'init was interrupted before writing anything.',
    exitCode: 3,
  });
  const toRelativePath = (path: string, directory: string): string => escapeControlChars(relative(directory, path).replaceAll('\\', '/'));

  if (input.dir === '') {
    return { outcome: 'rejected', states: [], message: '--dir must not be empty.', exitCode: 2 };
  }

  const directory = resolve(input.cwd, input.dir ?? '.');
  const storage = deps?.storage ?? createFsStorage();
  const isDirectory = deps?.isDirectory ?? createDirectoryCheck();
  const readConfirmationAnswer = deps?.readConfirmationAnswer ?? createInitConfirmationReader();

  let directoryExists: boolean;
  try {
    directoryExists = await isDirectory(directory);
  } catch (error) {
    return {
      outcome: 'failed',
      phase: 'pre-apply',
      states: [],
      message: `could not inspect --dir: ${escapeControlChars(messageFor(error))}`,
      exitCode: 3,
    };
  }
  if (!directoryExists) {
    return {
      outcome: 'rejected',
      states: [],
      message: `--dir ${escapeControlChars(input.dir ?? directory)} is not a directory.`,
      exitCode: 2,
    };
  }

  if (!input.yes) {
    const isCI = deps?.isCI ?? createProcessEnvironmentInfo().isCI();
    if (isCI) {
      return {
        outcome: 'rejected',
        states: [],
        message: 'init requires --yes when confirmation cannot be shown.',
        exitCode: 2,
      };
    }
    let interactive: boolean;
    try {
      interactive = (deps?.isInteractive ?? (() => createTtyInteractivityCheck()()))();
    } catch (error) {
      return {
        outcome: 'failed',
        phase: 'pre-apply',
        states: [],
        message: `could not determine whether confirmation can be shown: ${escapeControlChars(messageFor(error))}`,
        exitCode: 3,
      };
    }
    if (!interactive) {
      return {
        outcome: 'rejected',
        states: [],
        message: 'init requires --yes when confirmation cannot be shown.',
        exitCode: 2,
      };
    }
  }

  const targets: InitArtifactTargets = {
    config: join(directory, 'ambercast.config.json'),
    sample: join(directory, 'tests', 'ambercast', 'find-page.test.md'),
    gitignore: join(directory, '.gitignore'),
    agents: join(directory, 'AGENTS.md'),
  };
  const planned = await planInit({ storage, force: input.force }, targets, input.signal);
  if (planned.kind === 'interrupted') {
    return preApplyInterrupted();
  }
  if (planned.kind === 'read-failed') {
    return {
      outcome: 'failed',
      phase: 'pre-apply',
      states: [],
      message: `init could not read ${toRelativePath(planned.path, directory)}: ${escapeControlChars(messageFor(planned.error))}`,
      exitCode: 3,
    };
  }
  if (planned.kind === 'rejected') {
    const message = planned.reason === 'config-conflict'
      ? 'ambercast.config.json already exists and differs from the scaffold; rerun with --force to replace it.'
      : 'AGENTS.md has malformed ambercast markers (expected exactly one <!-- ambercast:begin --> … <!-- ambercast:end --> pair); fix it by hand and rerun.';
    return { outcome: 'rejected', states: [], message, exitCode: 2 };
  }

  const plan: InitPlan = planned.plan;
  const entries = [plan.config, plan.sample, plan.gitignore, plan.agents] as const;
  input.stderr.write(`ambercast init will write to ${escapeControlChars(directory)}:\n`);
  for (const entry of entries) {
    input.stderr.write(`  ${entry.classification.action.padEnd(8)}${toRelativePath(entry.path, directory)}\n`);
  }

  if (entries.every((entry) => entry.classification.action === 'skipped')) {
    const states: InitSkippedFileStates = [
      { path: toRelativePath(entries[0].path, directory), state: 'skipped' },
      { path: toRelativePath(entries[1].path, directory), state: 'skipped' },
      { path: toRelativePath(entries[2].path, directory), state: 'skipped' },
      { path: toRelativePath(entries[3].path, directory), state: 'skipped' },
    ];
    return {
      outcome: 'nothing-to-do',
      states,
      message: null,
      exitCode: 0,
    };
  }

  if (!input.yes) {
    let confirmation: 'authorized' | 'declined' | 'interrupted';
    try {
      confirmation = await readConfirmationAnswer(input.signal);
    } catch (error) {
      return {
        outcome: 'failed',
        phase: 'pre-apply',
        states: [],
        message: `could not read the confirmation answer: ${escapeControlChars(messageFor(error))}`,
        exitCode: 3,
      };
    }
    if (confirmation === 'declined') {
      return { outcome: 'declined', states: [], message: null, exitCode: 0 };
    }
    if (confirmation === 'interrupted') {
      return preApplyInterrupted();
    }
  }

  const applied = await applyInitPlan({ storage, force: input.force }, plan, input.signal);
  if (applied.kind === 'applied') {
    return {
      outcome: 'written',
      states: toCompletedFileStates(applied.results, directory),
      message: null,
      exitCode: 0,
    };
  }
  if (applied.kind === 'interrupted') {
    return {
      outcome: 'interrupted',
      phase: 'applying',
      states: toFileStates(applied.results, directory),
      message: 'init was interrupted; see the file list above.',
      exitCode: 3,
    };
  }

  const results: InitFileApplyResults = applied.results;
  const message = applied.failure === 'mismatch'
    ? `${toRelativePath(applied.path, directory)} changed while init was waiting for confirmation; rerun init.`
    : `init failed while writing ${toRelativePath(applied.path, directory)}: ${escapeControlChars(messageFor(applied.error))}`;
  return {
    outcome: 'failed',
    phase: 'applying',
    states: toFileStates(results, directory),
    message,
    exitCode: 3,
  };
}
