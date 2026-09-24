import { describe, expect, it, vi } from 'vitest';
import { AGENTS_BLOCK, CONFIG_TEMPLATE, GITIGNORE_APPEND_UNIT, SAMPLE_TEMPLATE } from '#core/init/templates.js';
import type { StorageAdapter } from '#ports/storage.js';
import {
  runInitCommand,
  type InitCommandDeps,
  type InitCommandInput,
} from '#runtime/init-command.js';

const root = '/workspace/project';
const paths = {
  config: `${root}/ambercast.config.json`,
  sample: `${root}/tests/ambercast/find-page.test.md`,
  gitignore: `${root}/.gitignore`,
  agents: `${root}/AGENTS.md`,
} as const;

type StorageOptions = {
  readonly failUpdateAt?: number;
  readonly failAfterReplaceAt?: number;
  readonly onUpdate?: (path: string, files: Map<string, string>) => void;
};

function createStorage(initial: Readonly<Record<string, string>> = {}, options: StorageOptions = {}): {
  readonly storage: StorageAdapter;
  readonly files: Map<string, string>;
  readonly reads: string[];
  readonly updates: string[];
  readonly signals: Array<AbortSignal | undefined>;
  readonly locks: Set<string>;
  readonly clearLock: (path: string) => void;
} {
  const files = new Map(Object.entries(initial));
  const reads: string[] = [];
  const updates: string[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  const locks = new Set<string>();
  let updateCount = 0;
  const snapshot = (text: string) => ({ text, bytes: new TextEncoder().encode(text) });

  const storage: StorageAdapter = {
    listDirectories: async () => [],
    realPath: async () => undefined,
    async readText(path) {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    async readTextSnapshot(path) {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return snapshot(text);
    },
    async readTextSnapshotIfExists(path) {
      reads.push(path);
      const text = files.get(path);
      return text === undefined ? null : snapshot(text);
    },
    async exists(path) { return files.has(path); },
    async updateTextExclusive(path, updater, signal) {
      updates.push(path);
      signals.push(signal);
      updateCount += 1;
      if (locks.has(path)) throw new Error(`exclusive lock remains at ${path}`);
      options.onUpdate?.(path, files);
      if (updateCount === options.failUpdateAt) throw new Error(`write failed at ${path}`);
      const next = await updater(files.get(path) ?? null);
      if (next !== null) files.set(path, next);
      if (updateCount === options.failAfterReplaceAt) {
        locks.add(path);
        throw new Error(`lock release failed at ${path}`);
      }
    },
    async writeText(path, content) { files.set(path, content); },
    async readBinary(path) {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return new TextEncoder().encode(text);
    },
    async writeBinary(path, content) { files.set(path, new TextDecoder().decode(content)); },
    async listFiles() { return []; },
    async ensureDir() {},
  };

  return { storage, files, reads, updates, signals, locks, clearLock: (path) => locks.delete(path) };
}

function createStderr(): { readonly stream: NodeJS.WritableStream; readonly text: () => string } {
  const writes: string[] = [];
  return {
    stream: { write(chunk: unknown) { writes.push(String(chunk)); return true; } } as NodeJS.WritableStream,
    text: () => writes.join(''),
  };
}

function input(stderr: NodeJS.WritableStream, overrides: Partial<InitCommandInput> = {}): InitCommandInput {
  return { dir: undefined, yes: false, force: false, cwd: root, stderr, ...overrides };
}

function deps(storage: StorageAdapter, overrides: Partial<InitCommandDeps> = {}): InitCommandDeps {
  return {
    storage,
    isCI: false,
    isInteractive: () => true,
    isDirectory: async () => true,
    readConfirmationAnswer: async () => 'authorized',
    ...overrides,
  };
}

function allSkippedFiles(): Record<string, string> {
  return {
    [paths.config]: CONFIG_TEMPLATE,
    [paths.sample]: SAMPLE_TEMPLATE,
    [paths.gitignore]: GITIGNORE_APPEND_UNIT,
    [paths.agents]: AGENTS_BLOCK,
  };
}

function expectedPlan(actions: readonly ['create' | 'skipped', 'create' | 'skipped', 'create' | 'skipped', 'create' | 'skipped']): string {
  return `ambercast init will write to ${root}:\n`
    + `  ${actions[0].padEnd(8)}ambercast.config.json\n`
    + `  ${actions[1].padEnd(8)}tests/ambercast/find-page.test.md\n`
    + `  ${actions[2].padEnd(8)}.gitignore\n`
    + `  ${actions[3].padEnd(8)}AGENTS.md\n`;
}

function expectNoWrites(fake: ReturnType<typeof createStorage>, before: Map<string, Uint8Array>): void {
  expect(fake.updates).toEqual([]);
  expect(new Map([...fake.files].map(([path, content]) => [path, new TextEncoder().encode(content)]))).toEqual(before);
}

async function runWithoutStdout(commandInput: InitCommandInput, commandDeps: InitCommandDeps) {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    const result = await runInitCommand(commandInput, commandDeps);
    expect(stdout).not.toHaveBeenCalled();
    return result;
  } finally {
    stdout.mockRestore();
  }
}

describe('runInitCommand', () => {
  it('interrupts after displaying an all-skipped plan before returning nothing-to-do', async () => {
    const controller = new AbortController();
    const fake = createStorage(allSkippedFiles());
    const before = new Map([...fake.files].map(([path, content]) => [path, new TextEncoder().encode(content)]));
    const writes: string[] = [];
    const stderr = { write(chunk: unknown) {
      writes.push(String(chunk));
      if (writes.length === 5) controller.abort();
      return true;
    } } as NodeJS.WritableStream;
    const readConfirmationAnswer = vi.fn(async () => 'authorized' as const);

    const output = await runWithoutStdout(input(stderr, { signal: controller.signal }), deps(fake.storage, { readConfirmationAnswer }));
    expect(output).toEqual({
      outcome: 'interrupted', phase: 'pre-apply', states: [], message: 'init was interrupted before writing anything.', exitCode: 3,
    });
    expect(output.message).toBe('init was interrupted before writing anything.');
    expect(writes.join('')).toBe(expectedPlan(['skipped', 'skipped', 'skipped', 'skipped']));
    expect(readConfirmationAnswer).not.toHaveBeenCalled();
    expectNoWrites(fake, before);
  });

  it('interrupts after displaying a plan with writes before prompting or applying', async () => {
    const controller = new AbortController();
    const fake = createStorage({ [paths.sample]: 'existing prompt' });
    const before = new Map([...fake.files].map(([path, content]) => [path, new TextEncoder().encode(content)]));
    const writes: string[] = [];
    const stderr = { write(chunk: unknown) {
      writes.push(String(chunk));
      if (writes.length === 5) controller.abort();
      return true;
    } } as NodeJS.WritableStream;
    const readConfirmationAnswer = vi.fn(async () => 'authorized' as const);

    const output = await runWithoutStdout(input(stderr, { signal: controller.signal }), deps(fake.storage, { readConfirmationAnswer }));
    expect(output).toEqual({
      outcome: 'interrupted', phase: 'pre-apply', states: [], message: 'init was interrupted before writing anything.', exitCode: 3,
    });
    expect(output.message).toBe('init was interrupted before writing anything.');
    expect(writes.join('')).toBe(expectedPlan(['create', 'skipped', 'create', 'create']));
    expect(readConfirmationAnswer).not.toHaveBeenCalled();
    expectNoWrites(fake, before);
  });

  it('prioritizes an abort observed after a declined confirmation answer', async () => {
    const controller = new AbortController();
    const fake = createStorage({ [paths.sample]: 'existing prompt' });
    const before = new Map([...fake.files].map(([path, content]) => [path, new TextEncoder().encode(content)]));
    const stderr = createStderr();
    const readConfirmationAnswer = vi.fn(async () => {
      stderr.stream.write('Write these files? [y/N] \n');
      controller.abort();
      return 'declined' as const;
    });

    const output = await runWithoutStdout(input(stderr.stream, { signal: controller.signal }), deps(fake.storage, { readConfirmationAnswer }));
    expect(output).toEqual({
      outcome: 'interrupted', phase: 'pre-apply', states: [], message: 'init was interrupted before writing anything.', exitCode: 3,
    });
    expect(output.message).toBe('init was interrupted before writing anything.');
    expect(stderr.text()).toBe(`${expectedPlan(['create', 'skipped', 'create', 'create'])}Write these files? [y/N] \n`);
    expect(readConfirmationAnswer).toHaveBeenCalledWith(controller.signal);
    expectNoWrites(fake, before);
  });

  it('prioritizes an abort observed after an authorized confirmation answer', async () => {
    const controller = new AbortController();
    const fake = createStorage({ [paths.sample]: 'existing prompt' });
    const before = new Map([...fake.files].map(([path, content]) => [path, new TextEncoder().encode(content)]));
    const stderr = createStderr();
    const readConfirmationAnswer = vi.fn(async () => {
      stderr.stream.write('Write these files? [y/N] \n');
      controller.abort();
      return 'authorized' as const;
    });

    const output = await runWithoutStdout(input(stderr.stream, { signal: controller.signal }), deps(fake.storage, { readConfirmationAnswer }));
    expect(output).toEqual({
      outcome: 'interrupted', phase: 'pre-apply', states: [], message: 'init was interrupted before writing anything.', exitCode: 3,
    });
    expect(output.message).toBe('init was interrupted before writing anything.');
    expect(stderr.text()).toBe(`${expectedPlan(['create', 'skipped', 'create', 'create'])}Write these files? [y/N] \n`);
    expect(readConfirmationAnswer).toHaveBeenCalledWith(controller.signal);
    expectNoWrites(fake, before);
  });
  it('rejects a non-directory and returns a pre-apply failure when its directory check throws', async () => {
    const rejectedStderr = createStderr();
    const rejectedStorage = createStorage();
    const isDirectory = vi.fn(async () => false);

    await expect(runInitCommand(input(rejectedStderr.stream, { dir: 'not-a-directory' }), deps(rejectedStorage.storage, { isDirectory }))).resolves.toEqual({
      outcome: 'rejected', states: [], message: '--dir not-a-directory is not a directory.', exitCode: 2,
    });
    expect(rejectedStorage.reads).toEqual([]);
    expect(isDirectory).toHaveBeenCalledWith(`${root}/not-a-directory`);

    const failedStderr = createStderr();
    await expect(runInitCommand(
      input(failedStderr.stream),
      deps(createStorage().storage, { isDirectory: async () => { throw new Error('directory inspection failed'); } }),
    )).resolves.toMatchObject({ outcome: 'failed', phase: 'pre-apply', states: [], exitCode: 3, message: expect.stringContaining('directory inspection failed') });
  });

  it('rejects an empty --dir before inspecting storage', async () => {
    const stderr = createStderr();
    const fake = createStorage();

    await expect(runInitCommand(input(stderr.stream, { dir: '' }), deps(fake.storage))).resolves.toEqual({
      outcome: 'rejected', states: [], message: '--dir must not be empty.', exitCode: 2,
    });
    expect(fake.reads).toEqual([]);
  });

  it.each([
    ['CI', { isCI: true }],
    ['a non-interactive terminal', { isInteractive: () => false }],
  ] as const)('rejects %s without --yes before reading storage', async (_name, environment) => {
    const stderr = createStderr();
    const fake = createStorage(allSkippedFiles());

    await expect(runInitCommand(input(stderr.stream), deps(fake.storage, environment))).resolves.toEqual({
      outcome: 'rejected', states: [], message: 'init requires --yes when confirmation cannot be shown.', exitCode: 2,
    });
    expect(fake.reads).toEqual([]);
  });

  it('prioritizes an invalid --dir over non-interactive rejection without reading storage', async () => {
    const stderr = createStderr();
    const fake = createStorage();

    await expect(runInitCommand(
      input(stderr.stream, { dir: 'missing' }),
      deps(fake.storage, { isDirectory: async () => false, isCI: true }),
    )).resolves.toEqual({
      outcome: 'rejected', states: [], message: '--dir missing is not a directory.', exitCode: 2,
    });
    expect(fake.reads).toEqual([]);
  });

  it('reports the first config conflict without inspecting later artifacts', async () => {
    const stderr = createStderr();
    const fake = createStorage({
      [paths.config]: 'user configuration',
      [paths.agents]: '<!-- ambercast:begin -->\n',
    });

    await expect(runInitCommand(input(stderr.stream, { yes: true }), deps(fake.storage))).resolves.toEqual({
      outcome: 'rejected', states: [],
      message: 'ambercast.config.json already exists and differs from the scaffold; rerun with --force to replace it.',
      exitCode: 2,
    });
    expect(fake.reads).toEqual([paths.config]);
  });

  it('prints an all-skipped plan but neither prompts nor applies it', async () => {
    const stderr = createStderr();
    const fake = createStorage(allSkippedFiles());
    const readConfirmationAnswer = vi.fn(async () => 'authorized' as const);

    await expect(runInitCommand(input(stderr.stream), deps(fake.storage, { readConfirmationAnswer }))).resolves.toEqual({
      outcome: 'nothing-to-do',
      states: [
        { path: 'ambercast.config.json', state: 'skipped' },
        { path: 'tests/ambercast/find-page.test.md', state: 'skipped' },
        { path: '.gitignore', state: 'skipped' },
        { path: 'AGENTS.md', state: 'skipped' },
      ],
      message: null,
      exitCode: 0,
    });
    expect(readConfirmationAnswer).not.toHaveBeenCalled();
    expect(fake.updates).toEqual([]);
    expect(stderr.text()).toContain('ambercast.config.json');
    expect(stderr.text()).toContain('skipped');
  });

  it('uses --yes to write all missing files without reading confirmation and still prints the plan', async () => {
    const stderr = createStderr();
    const fake = createStorage();
    const readConfirmationAnswer = vi.fn(async () => 'declined' as const);

    await expect(runInitCommand(input(stderr.stream, { yes: true }), deps(fake.storage, { readConfirmationAnswer }))).resolves.toEqual({
      outcome: 'written',
      states: [
        { path: 'ambercast.config.json', state: 'written' },
        { path: 'tests/ambercast/find-page.test.md', state: 'written' },
        { path: '.gitignore', state: 'written' },
        { path: 'AGENTS.md', state: 'written' },
      ],
      message: null,
      exitCode: 0,
    });
    expect(readConfirmationAnswer).not.toHaveBeenCalled();
    expect(fake.updates).toEqual(Object.values(paths));
    expect(fake.files).toEqual(new Map([
      [paths.config, CONFIG_TEMPLATE],
      [paths.sample, SAMPLE_TEMPLATE],
      [paths.gitignore, GITIGNORE_APPEND_UNIT],
      [paths.agents, AGENTS_BLOCK],
    ]));
    expect(stderr.text()).toContain('create');
  });

  it('does not inspect interactivity when --yes already authorizes the write', async () => {
    const isInteractive = vi.fn(() => { throw new Error('TTY probe must not run'); });

    await expect(runInitCommand(
      input(createStderr().stream, { yes: true }),
      deps(createStorage().storage, { isInteractive }),
    )).resolves.toMatchObject({ outcome: 'written', exitCode: 0 });
    expect(isInteractive).not.toHaveBeenCalled();
  });

  it('short-circuits TTY inspection when CI rejects an unapproved command', async () => {
    const isInteractive = vi.fn(() => { throw new Error('TTY probe must not run'); });

    await expect(runInitCommand(
      input(createStderr().stream),
      deps(createStorage().storage, { isCI: true, isInteractive }),
    )).resolves.toEqual({
      outcome: 'rejected', states: [],
      message: 'init requires --yes when confirmation cannot be shown.', exitCode: 2,
    });
    expect(isInteractive).not.toHaveBeenCalled();
  });

  it('returns declined without states when the interactive reader declines', async () => {
    const stderr = createStderr();
    const fake = createStorage();

    await expect(runInitCommand(
      input(stderr.stream),
      deps(fake.storage, { readConfirmationAnswer: async () => 'declined' }),
    )).resolves.toEqual({ outcome: 'declined', states: [], message: null, exitCode: 0 });
    expect(fake.updates).toEqual([]);
  });

  it('returns a pre-apply interruption when the interactive reader is interrupted', async () => {
    const stderr = createStderr();

    await expect(runInitCommand(
      input(stderr.stream),
      deps(createStorage().storage, { readConfirmationAnswer: async () => 'interrupted' }),
    )).resolves.toEqual({
      outcome: 'interrupted', phase: 'pre-apply', states: [],
      message: 'init was interrupted before writing anything.', exitCode: 3,
    });
  });

  it('maps a rejected confirmation reader to a pre-apply failure', async () => {
    const stderr = createStderr();
    const failure = new Error('stdin disconnected');

    await expect(runInitCommand(
      input(stderr.stream),
      deps(createStorage().storage, { readConfirmationAnswer: async () => { throw failure; } }),
    )).resolves.toEqual({
      outcome: 'failed', phase: 'pre-apply', states: [],
      message: 'could not read the confirmation answer: stdin disconnected', exitCode: 3,
    });
  });

  it('records completed writes and not-attempted suffixes when the signal aborts during apply', async () => {
    const controller = new AbortController();
    const stderr = createStderr();
    const fake = createStorage({}, { onUpdate(path) { if (path === paths.config) controller.abort(); } });

    await expect(runInitCommand(input(stderr.stream, { yes: true, signal: controller.signal }), deps(fake.storage))).resolves.toEqual({
      outcome: 'interrupted', phase: 'applying',
      states: [
        { path: 'ambercast.config.json', state: 'written' },
        { path: 'tests/ambercast/find-page.test.md', state: 'not-attempted' },
        { path: '.gitignore', state: 'not-attempted' },
        { path: 'AGENTS.md', state: 'not-attempted' },
      ],
      message: 'init was interrupted; see the file list above.', exitCode: 3,
    });
    expect(fake.signals).toEqual([controller.signal]);
  });

  it('reports a third-write I/O failure with failed and not-attempted states', async () => {
    const stderr = createStderr();
    const fake = createStorage({}, { failUpdateAt: 3 });

    await expect(runInitCommand(input(stderr.stream, { yes: true }), deps(fake.storage))).resolves.toMatchObject({
      outcome: 'failed', phase: 'applying', exitCode: 3,
      states: [
        { path: 'ambercast.config.json', state: 'written' },
        { path: 'tests/ambercast/find-page.test.md', state: 'written' },
        { path: '.gitignore', state: 'failed' },
        { path: 'AGENTS.md', state: 'not-attempted' },
      ],
      message: expect.stringContaining('write failed'),
    });
    expect(fake.updates).toEqual([paths.config, paths.sample, paths.gitignore]);
  });

  it('formats a write failure once with relative paths and escaped controls', async () => {
    const stderr = createStderr();
    const fake = createStorage({}, {
      onUpdate(path) {
        if (path === paths.gitignore) throw new Error('write\nfailed');
      },
    });

    await expect(runInitCommand(input(stderr.stream, { yes: true }), deps(fake.storage))).resolves.toMatchObject({
      outcome: 'failed', phase: 'applying', exitCode: 3,
      message: 'init failed while writing .gitignore: write\\nfailed',
      states: [
        { path: 'ambercast.config.json', state: 'written' },
        { path: 'tests/ambercast/find-page.test.md', state: 'written' },
        { path: '.gitignore', state: 'failed' },
        { path: 'AGENTS.md', state: 'not-attempted' },
      ],
    });
  });

  it('resolves --dir relative to cwd and uses cwd itself when --dir is absent', async () => {
    const relativeDirectory = vi.fn(async () => false);
    await runInitCommand(
      input(createStderr().stream, { dir: 'nested/project' }),
      deps(createStorage().storage, { isDirectory: relativeDirectory }),
    );
    expect(relativeDirectory).toHaveBeenCalledWith(`${root}/nested/project`);

    const defaultDirectory = vi.fn(async () => false);
    await runInitCommand(
      input(createStderr().stream),
      deps(createStorage().storage, { isDirectory: defaultDirectory }),
    );
    expect(defaultDirectory).toHaveBeenCalledWith(root);
  });

  it('writes relative --dir targets as absolute storage paths', async () => {
    const stderr = createStderr();
    const fake = createStorage();
    const relativePaths = {
      config: `${root}/sub/ambercast.config.json`,
      sample: `${root}/sub/tests/ambercast/find-page.test.md`,
      gitignore: `${root}/sub/.gitignore`,
      agents: `${root}/sub/AGENTS.md`,
    };

    await expect(runInitCommand(
      input(stderr.stream, { dir: 'sub', yes: true }),
      deps(fake.storage),
    )).resolves.toMatchObject({ outcome: 'written', exitCode: 0 });
    expect(fake.updates).toEqual(Object.values(relativePaths));
    expect([...fake.files.keys()]).toEqual(Object.values(relativePaths));
  });

  it('converges after a successful run: reruns skip all files and --force remains a no-op', async () => {
    const stderr = createStderr();
    const fake = createStorage();

    await expect(runInitCommand(input(stderr.stream, { yes: true }), deps(fake.storage))).resolves.toMatchObject({ outcome: 'written' });
    const bytesAfterWrite = new Map(fake.files);

    await expect(runInitCommand(input(stderr.stream, { yes: true }), deps(fake.storage))).resolves.toEqual({
      outcome: 'nothing-to-do',
      states: [
        { path: 'ambercast.config.json', state: 'skipped' },
        { path: 'tests/ambercast/find-page.test.md', state: 'skipped' },
        { path: '.gitignore', state: 'skipped' },
        { path: 'AGENTS.md', state: 'skipped' },
      ],
      message: null,
      exitCode: 0,
    });
    expect(fake.files).toEqual(bytesAfterWrite);

    await expect(runInitCommand(input(stderr.stream, { yes: true, force: true }), deps(fake.storage))).resolves.toMatchObject({
      outcome: 'nothing-to-do',
      states: [
        { path: 'ambercast.config.json', state: 'skipped' },
        { path: 'tests/ambercast/find-page.test.md', state: 'skipped' },
        { path: '.gitignore', state: 'skipped' },
        { path: 'AGENTS.md', state: 'skipped' },
      ],
    });
    expect(fake.files).toEqual(bytesAfterWrite);
  });
});
