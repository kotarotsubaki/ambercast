import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFsStorage } from '#adapters/storage/fs-storage.js';
import { AGENTS_BLOCK, CONFIG_TEMPLATE, GITIGNORE_APPEND_UNIT, SAMPLE_TEMPLATE } from '#core/init/templates.js';
import { applyInitPlan, planInit, type InitArtifactTargets } from '#usecases/init.js';

const temporaryDirectories: string[] = [];
const bom = Buffer.from([0xef, 0xbb, 0xbf]);
const withBom = (text: string): Buffer => Buffer.concat([bom, Buffer.from(text, 'utf8')]);

async function fixture(): Promise<{ root: string; targets: InitArtifactTargets }> {
  const root = await mkdtemp(join(tmpdir(), 'ambercast-init-fs-'));
  temporaryDirectories.push(root);
  return {
    root,
    targets: {
      config: join(root, 'ambercast.config.json'),
      sample: join(root, 'tests/ambercast/find-page.test.md'),
      gitignore: join(root, '.gitignore'),
      agents: join(root, 'AGENTS.md'),
    },
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('init with real FsStorage', () => {
  it('appends to a BOM-prefixed .gitignore without dropping its BOM', async () => {
    const { targets } = await fixture();
    const original = withBom('node_modules/\n');
    await writeFile(targets.gitignore, original);
    const deps = { storage: createFsStorage(), force: false };
    const planned = await planInit(deps, targets);
    expect(planned.kind).toBe('plan');
    if (planned.kind !== 'plan') return;
    expect(planned.plan.gitignore.classification).toMatchObject({ kind: 'action', action: 'append' });
    const applied = await applyInitPlan(deps, planned.plan);
    expect(applied.kind).toBe('applied');
    expect(applied.results).toEqual([
      { path: targets.config, state: 'written' },
      { path: targets.sample, state: 'written' },
      { path: targets.gitignore, state: 'written' },
      { path: targets.agents, state: 'written' },
    ]);
    const bytes = await readFile(targets.gitignore);
    expect(bytes.subarray(0, 3)).toEqual(bom);
    expect(bytes).toEqual(withBom(`node_modules/\n${GITIGNORE_APPEND_UNIT}`));
  });

  it('skips a BOM-prefixed AGENTS.md whose managed block already matches', async () => {
    const { targets } = await fixture();
    const original = withBom(`Before\r\n${AGENTS_BLOCK.replaceAll('\n', '\r\n')}After\r\n`);
    await writeFile(targets.agents, original);
    const deps = { storage: createFsStorage(), force: false };
    const planned = await planInit(deps, targets);
    expect(planned.kind).toBe('plan');
    if (planned.kind !== 'plan') return;
    expect(planned.plan.agents.classification).toStrictEqual({ kind: 'action', action: 'skipped', nextText: null });
    const applied = await applyInitPlan(deps, planned.plan);
    expect(applied.kind).toBe('applied');
    expect(applied.results).toEqual([
      { path: targets.config, state: 'written' },
      { path: targets.sample, state: 'written' },
      { path: targets.gitignore, state: 'written' },
      { path: targets.agents, state: 'skipped' },
    ]);
    expect(await readFile(targets.agents)).toEqual(original);
  });

  it('replaces only the differing AGENTS.md managed block while preserving BOM and surrounding text', async () => {
    const { targets } = await fixture();
    await writeFile(targets.agents, withBom('Before\r\n<!-- ambercast:begin -->\r\nOld\r\n<!-- ambercast:end -->\r\nAfter\r\n'));
    const deps = { storage: createFsStorage(), force: false };
    const planned = await planInit(deps, targets);
    expect(planned.kind).toBe('plan');
    if (planned.kind !== 'plan') return;
    expect(planned.plan.agents.classification).toMatchObject({ kind: 'action', action: 'replace' });
    const applied = await applyInitPlan(deps, planned.plan);
    expect(applied.kind).toBe('applied');
    expect(applied.results).toEqual([
      { path: targets.config, state: 'written' },
      { path: targets.sample, state: 'written' },
      { path: targets.gitignore, state: 'written' },
      { path: targets.agents, state: 'written' },
    ]);
    expect(await readFile(targets.agents)).toEqual(withBom(`Before\r\n${AGENTS_BLOCK.replaceAll('\n', '\r\n')}After\r\n`));
  });

  it('rejects a BOM-only config difference without force, then writes exact BOM-free config with force', async () => {
    const { targets } = await fixture();
    const original = withBom(CONFIG_TEMPLATE);
    await writeFile(targets.config, original);
    const storage = createFsStorage();
    const rejected = await planInit({ storage, force: false }, targets);
    expect(rejected).toEqual({ kind: 'rejected', path: targets.config, reason: 'config-conflict' });
    // This classification is the usecase precondition for runtime's config-conflict exit code 2.
    expect(await readFile(targets.config)).toEqual(original);

    const forced = await planInit({ storage, force: true }, targets);
    expect(forced.kind).toBe('plan');
    if (forced.kind !== 'plan') return;
    expect(forced.plan.config.classification).toMatchObject({ kind: 'action', action: 'replace' });
    const applied = await applyInitPlan({ storage, force: true }, forced.plan);
    expect(applied.kind).toBe('applied');
    expect(applied.results).toEqual([
      { path: targets.config, state: 'written' },
      { path: targets.sample, state: 'written' },
      { path: targets.gitignore, state: 'written' },
      { path: targets.agents, state: 'written' },
    ]);
    expect(await readFile(targets.config)).toEqual(Buffer.from(CONFIG_TEMPLATE, 'utf8'));
  });

  it('skips all four artifacts on a fresh second plan and performs no additional writes', async () => {
    const { targets } = await fixture();
    const storage = createFsStorage();
    const deps = { storage, force: false };
    const first = await planInit(deps, targets);
    expect(first.kind).toBe('plan');
    if (first.kind !== 'plan') return;
    const firstApply = await applyInitPlan(deps, first.plan);
    expect(firstApply).toEqual({ kind: 'applied', results: [
      { path: targets.config, state: 'written' },
      { path: targets.sample, state: 'written' },
      { path: targets.gitignore, state: 'written' },
      { path: targets.agents, state: 'written' },
    ] });
    const paths = Object.values(targets);
    const before = await Promise.all(paths.map(async (path) => ({ bytes: await readFile(path), mtimeNs: (await stat(path, { bigint: true })).mtimeNs })));
    const updateTextExclusive = storage.updateTextExclusive.bind(storage);
    const replacements: Array<string | null> = [];
    const updates = vi.spyOn(storage, 'updateTextExclusive').mockImplementation((path, updater, signal) =>
      updateTextExclusive(path, async (current) => {
        const replacement = await updater(current);
        replacements.push(replacement);
        return replacement;
      }, signal));
    const second = await planInit(deps, targets);
    expect(second.kind).toBe('plan');
    if (second.kind !== 'plan') return;
    for (const entry of Object.values(second.plan)) {
      expect(entry.classification).toStrictEqual({ kind: 'action', action: 'skipped', nextText: null });
    }
    const secondApply = await applyInitPlan(deps, second.plan);
    expect(secondApply).toEqual({ kind: 'applied', results: [
      { path: targets.config, state: 'skipped' },
      { path: targets.sample, state: 'skipped' },
      { path: targets.gitignore, state: 'skipped' },
      { path: targets.agents, state: 'skipped' },
    ] });
    expect(updates).toHaveBeenCalledTimes(4);
    // The real adapter enters its temporary-file/rename path only for non-null replacements.
    expect(replacements).toEqual([null, null, null, null]);
    const after = await Promise.all(paths.map(async (path) => ({ bytes: await readFile(path), mtimeNs: (await stat(path, { bigint: true })).mtimeNs })));
    expect(after).toEqual(before);
    expect(before[0]?.bytes).toEqual(Buffer.from(CONFIG_TEMPLATE));
    expect(before[1]?.bytes).toEqual(Buffer.from(SAMPLE_TEMPLATE));
  });
});
