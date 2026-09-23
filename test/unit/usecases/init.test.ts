import { describe, expect, it } from 'vitest';
import { AGENTS_BLOCK, CONFIG_TEMPLATE, GITIGNORE_APPEND_UNIT, SAMPLE_TEMPLATE } from '#core/init/templates.js';
import { FsIoError } from '#core/errors/fs-io-error.js';
import type { StorageAdapter } from '#ports/storage.js';
import {
  applyInitPlan,
  planInit,
  type InitPlan,
  type InitUsecaseDeps,
} from '#usecases/init.js';

const targets = {
  config: '/project/ambercast.config.json',
  sample: '/project/tests/ambercast/find-page.test.md',
  gitignore: '/project/.gitignore',
  agents: '/project/AGENTS.md',
} as const;

type UpdateHook = (path: string, files: Map<string, string>) => void;

function createStorage(initial: Readonly<Record<string, string>> = {}, options: {
  readonly onUpdate?: UpdateHook;
  readonly failUpdateAt?: number;
  readonly failAfterReplaceAt?: number;
  readonly updateFailureAt?: { readonly index: number; readonly error: Error };
  readonly readFailure?: { readonly path: string; readonly error: Error };
  readonly abortDuringRead?: { readonly path: string; readonly controller: AbortController };
} = {}): {
  readonly storage: StorageAdapter;
  readonly files: Map<string, string>;
  readonly reads: string[];
  readonly updates: string[];
  readonly signals: Array<AbortSignal | undefined>;
  readonly ensureDirCalls: string[];
  readonly locks: Set<string>;
  readonly clearLock: (path: string) => void;
} {
  const files = new Map(Object.entries(initial));
  const reads: string[] = [];
  const updates: string[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  const ensureDirCalls: string[] = [];
  const locks = new Set<string>();
  let updateCount = 0;
  const snapshot = (text: string): { readonly text: string; readonly bytes: Uint8Array } => ({
    text,
    bytes: new TextEncoder().encode(text),
  });
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
      if (options.readFailure?.path === path) throw options.readFailure.error;
      const text = files.get(path);
      if (options.abortDuringRead?.path === path) options.abortDuringRead.controller.abort();
      return text === undefined ? null : snapshot(text);
    },
    async exists(path) { return files.has(path); },
    async updateTextExclusive(path, updater, signal) {
      updates.push(path);
      signals.push(signal);
      updateCount += 1;
      if (locks.has(path)) throw new Error(`exclusive lock remains at ${path}`);
      options.onUpdate?.(path, files);
      if (options.failUpdateAt === updateCount) throw new Error(`write failed at ${path}`);
      if (options.updateFailureAt?.index === updateCount) throw options.updateFailureAt.error;
      const next = await updater(files.get(path) ?? null);
      if (next !== null) files.set(path, next);
      if (options.failAfterReplaceAt === updateCount) {
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
    async ensureDir(path) { ensureDirCalls.push(path); },
  };
  return { storage, files, reads, updates, signals, ensureDirCalls, locks, clearLock: (path) => locks.delete(path) };
}

function deps(storage: StorageAdapter, force = false): InitUsecaseDeps {
  return { storage, force };
}

const createPlan: InitPlan = {
  config: { path: targets.config, classification: { kind: 'action', action: 'create', nextText: CONFIG_TEMPLATE } },
  sample: { path: targets.sample, classification: { kind: 'action', action: 'create', nextText: SAMPLE_TEMPLATE } },
  gitignore: { path: targets.gitignore, classification: { kind: 'action', action: 'create', nextText: GITIGNORE_APPEND_UNIT } },
  agents: { path: targets.agents, classification: { kind: 'action', action: 'create', nextText: AGENTS_BLOCK } },
};

const skippedPlan: InitPlan = {
  config: { path: targets.config, classification: { kind: 'action', action: 'skipped', nextText: null } },
  sample: { path: targets.sample, classification: { kind: 'action', action: 'skipped', nextText: null } },
  gitignore: { path: targets.gitignore, classification: { kind: 'action', action: 'skipped', nextText: null } },
  agents: { path: targets.agents, classification: { kind: 'action', action: 'skipped', nextText: null } },
};

describe('planInit()', () => {
  it('plans creation for four absent artifacts in required order', async () => {
    const fake = createStorage();

    await expect(planInit(deps(fake.storage), targets)).resolves.toMatchObject({
      kind: 'plan',
      plan: {
        config: { path: targets.config, classification: { kind: 'action', action: 'create' } },
        sample: { path: targets.sample, classification: { kind: 'action', action: 'create' } },
        gitignore: { path: targets.gitignore, classification: { kind: 'action', action: 'create' } },
        agents: { path: targets.agents, classification: { kind: 'action', action: 'create' } },
      },
    });
    expect(fake.reads).toEqual(Object.values(targets));
  });

  it('stops at a config conflict without reading later artifacts', async () => {
    const fake = createStorage({ [targets.config]: 'different config' });

    await expect(planInit(deps(fake.storage), targets)).resolves.toEqual({
      kind: 'rejected', path: targets.config, reason: 'config-conflict',
    });
    expect(fake.reads).toEqual([targets.config]);
  });

  it('reports malformed AGENTS markers after the preceding artifacts', async () => {
    const fake = createStorage({ [targets.agents]: '<!-- ambercast:begin -->\n' });

    await expect(planInit(deps(fake.storage), targets)).resolves.toEqual({
      kind: 'rejected', path: targets.agents, reason: 'agents-malformed-markers',
    });
  });

  it('reports only the earlier config conflict when both config and AGENTS are invalid', async () => {
    const fake = createStorage({
      [targets.config]: 'different config',
      [targets.agents]: '<!-- ambercast:begin -->\n',
    });

    await expect(planInit(deps(fake.storage), targets)).resolves.toEqual({
      kind: 'rejected', path: targets.config, reason: 'config-conflict',
    });
    expect(fake.reads).toEqual([targets.config]);
  });

  it.each(Object.values(targets))('returns a read failure at %s without inspecting later artifacts', async (path) => {
    const failure = new Error(`cannot read ${path}`);
    const fake = createStorage({}, { readFailure: { path, error: failure } });
    const expectedReads = Object.values(targets).slice(0, Object.values(targets).indexOf(path) + 1);

    await expect(planInit(deps(fake.storage), targets)).resolves.toEqual({
      kind: 'read-failed', path, error: failure,
    });
    expect(fake.reads).toEqual(expectedReads);
  });

  it('does not read when already aborted', async () => {
    const fake = createStorage();
    const controller = new AbortController();
    controller.abort();

    await expect(planInit(deps(fake.storage), targets, controller.signal)).resolves.toEqual({ kind: 'interrupted' });
    expect(fake.reads).toEqual([]);
  });

  it.each(Object.values(targets))('stops as interrupted when abort occurs during the %s read', async (path) => {
    const controller = new AbortController();
    const fake = createStorage({}, { abortDuringRead: { path, controller } });
    const expectedReads = Object.values(targets).slice(0, Object.values(targets).indexOf(path) + 1);

    await expect(planInit(deps(fake.storage), targets, controller.signal)).resolves.toEqual({ kind: 'interrupted' });
    expect(fake.reads).toEqual(expectedReads);
  });

  it('returns an all-skipped plan when every artifact already agrees', async () => {
    const fake = createStorage({
      [targets.config]: CONFIG_TEMPLATE,
      [targets.sample]: 'user sample',
      [targets.gitignore]: 'tests/ambercast/.runs/\n',
      [targets.agents]: AGENTS_BLOCK,
    });

    await expect(planInit(deps(fake.storage), targets)).resolves.toMatchObject({
      kind: 'plan',
      plan: {
        config: { classification: { action: 'skipped' } },
        sample: { classification: { action: 'skipped' } },
        gitignore: { classification: { action: 'skipped' } },
        agents: { classification: { action: 'skipped' } },
      },
    });
  });
});

describe('applyInitPlan()', () => {
  it('applies all four entries in order', async () => {
    const fake = createStorage();

    await expect(applyInitPlan(deps(fake.storage), createPlan)).resolves.toEqual({
      kind: 'applied',
      results: Object.values(targets).map((path) => ({ path, state: 'written' })),
    });
    expect(fake.updates).toEqual(Object.values(targets));
    expect(fake.ensureDirCalls).toEqual([]);
  });

  it.each(Object.values(targets))('stops after a concurrent %s change and preserves external content', async (changedPath) => {
    const fake = createStorage({}, {
      onUpdate(path, files) {
        if (path === changedPath) files.set(path, 'external change\n');
      },
    });
    const changedIndex = Object.values(targets).indexOf(changedPath);

    await expect(applyInitPlan(deps(fake.storage), createPlan)).resolves.toMatchObject({
      kind: 'failed', path: changedPath, failure: 'mismatch',
      results: Object.values(targets).map((path, index) => ({
        path,
        state: index < changedIndex ? 'written' : index === changedIndex ? 'failed' : 'not-attempted',
      })),
    });
    expect(fake.files.get(changedPath)).toBe('external change\n');
    expect(fake.updates).toEqual(Object.values(targets).slice(0, changedIndex + 1));
    expect(fake.ensureDirCalls).toEqual([]);
  });

  it('stops when a concurrent append keeps its action but changes its next text', async () => {
    const fake = createStorage({
      [targets.config]: CONFIG_TEMPLATE,
      [targets.sample]: 'existing sample',
      [targets.gitignore]: 'first ignore\n',
      [targets.agents]: AGENTS_BLOCK,
    }, {
      onUpdate(path, files) {
        if (path === targets.gitignore) files.set(path, 'second ignore\n');
      },
    });
    const planned = await planInit(deps(fake.storage), targets);
    if (planned.kind !== 'plan') throw new Error('expected an append plan');

    await expect(applyInitPlan(deps(fake.storage), planned.plan)).resolves.toMatchObject({
      kind: 'failed', path: targets.gitignore, failure: 'mismatch',
      results: [
        { state: 'skipped' }, { state: 'skipped' }, { state: 'failed' }, { state: 'not-attempted' },
      ],
    });
    expect(fake.files.get(targets.gitignore)).toBe('second ignore\n');
  });

  it('reports a storage write failure and stops later writes', async () => {
    const fake = createStorage({}, { failUpdateAt: 3 });

    await expect(applyInitPlan(deps(fake.storage), createPlan)).resolves.toMatchObject({
      kind: 'failed', path: targets.gitignore, failure: 'write-failed',
      results: [
        { state: 'written' }, { state: 'written' }, { state: 'failed' }, { state: 'not-attempted' },
      ],
    });
  });

  it('reports a symlink FsIoError as failed and leaves later entries not attempted', async () => {
    const symlinkFailure = new FsIoError('Refusing to update text through a symbolic link.', { path: targets.sample });
    const fake = createStorage({}, { updateFailureAt: { index: 2, error: symlinkFailure } });

    await expect(applyInitPlan(deps(fake.storage), createPlan)).resolves.toMatchObject({
      kind: 'failed', path: targets.sample, failure: 'write-failed',
      results: [
        { path: targets.config, state: 'written' },
        { path: targets.sample, state: 'failed' },
        { path: targets.gitignore, state: 'not-attempted' },
        { path: targets.agents, state: 'not-attempted' },
      ],
    });
  });

  it('reports a post-replace lock-release failure, then converges after the stale lock is cleared', async () => {
    const fake = createStorage({}, { failAfterReplaceAt: 1 });
    const initialPlan = await planInit(deps(fake.storage), targets);
    if (initialPlan.kind !== 'plan') throw new Error('expected an initial plan');

    await expect(applyInitPlan(deps(fake.storage), initialPlan.plan)).resolves.toMatchObject({
      kind: 'failed', path: targets.config, failure: 'write-failed',
      results: [
        { path: targets.config, state: 'failed' },
        { state: 'not-attempted' }, { state: 'not-attempted' }, { state: 'not-attempted' },
      ],
    });
    expect(fake.files.get(targets.config)).toBe(CONFIG_TEMPLATE);
    expect(fake.locks).toEqual(new Set([targets.config]));

    fake.clearLock(targets.config);
    const rerunPlan = await planInit(deps(fake.storage), targets);
    expect(rerunPlan).toMatchObject({ kind: 'plan' });
    if (rerunPlan.kind !== 'plan') throw new Error('expected a rerunnable plan');

    await expect(applyInitPlan(deps(fake.storage), rerunPlan.plan)).resolves.toMatchObject({ kind: 'applied' });
    expect(fake.files.get(targets.config)).toBe(CONFIG_TEMPLATE);
  });

  it('reports unattempted entries after cancellation before a write', async () => {
    const controller = new AbortController();
    const fake = createStorage({}, {
      onUpdate(path) {
        if (path === targets.config) controller.abort();
      },
    });

    await expect(applyInitPlan(deps(fake.storage), createPlan, controller.signal)).resolves.toEqual({
      kind: 'interrupted',
      results: [
        { path: targets.config, state: 'written' },
        { path: targets.sample, state: 'not-attempted' },
        { path: targets.gitignore, state: 'not-attempted' },
        { path: targets.agents, state: 'not-attempted' },
      ],
    });
    expect(fake.signals).toEqual([controller.signal]);
  });

  it('returns four skipped results for an all-skipped plan', async () => {
    const fake = createStorage({
      [targets.config]: CONFIG_TEMPLATE,
      [targets.sample]: 'existing sample',
      [targets.gitignore]: 'tests/ambercast/.runs/\n',
      [targets.agents]: AGENTS_BLOCK,
    });

    await expect(applyInitPlan(deps(fake.storage), skippedPlan)).resolves.toEqual({
      kind: 'applied',
      results: Object.values(targets).map((path) => ({ path, state: 'skipped' })),
    });
    expect(fake.updates).toEqual(Object.values(targets));
  });

  it('reclassifies a planned skipped entry and stops when it changed during confirmation', async () => {
    const fake = createStorage({
      [targets.config]: CONFIG_TEMPLATE,
      [targets.sample]: 'existing sample',
      [targets.gitignore]: 'tests/ambercast/.runs/\n',
      [targets.agents]: AGENTS_BLOCK,
    }, {
      onUpdate(path, files) {
        if (path === targets.sample) files.delete(path);
      },
    });

    await expect(applyInitPlan(deps(fake.storage), skippedPlan)).resolves.toMatchObject({
      kind: 'failed', path: targets.sample, failure: 'mismatch',
      results: [
        { path: targets.config, state: 'skipped' },
        { path: targets.sample, state: 'failed' },
        { path: targets.gitignore, state: 'not-attempted' },
        { path: targets.agents, state: 'not-attempted' },
      ],
    });
    expect(fake.updates).toEqual([targets.config, targets.sample]);
  });
});
