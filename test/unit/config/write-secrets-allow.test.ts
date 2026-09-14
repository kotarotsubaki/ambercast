import { describe, expect, it, vi } from 'vitest';
import { commitAllowlist } from '../../../src/config/write-secrets-allow.js';
import { CONFIG_SCHEMA_ID } from '../../../src/core/config/json-schema.js';
import { ConfigInvalidError } from '../../../src/core/errors/config-invalid-error.js';
import { FsIoError } from '../../../src/core/errors/fs-io-error.js';
import type { StorageAdapter } from '../../../src/ports/storage.js';
import { createInMemoryStorage } from '../../doubles/create-in-memory-storage.js';

const CONFIG_PATH = '/workspace/ambercast.config.json';

interface ExclusiveFixture {
  readonly storage: StorageAdapter;
  readonly update: ReturnType<typeof vi.fn<StorageAdapter['updateTextExclusive']>>;
  readonly replacements: (string | null)[];
  current(): string | null;
}

function createExclusiveFixture(initial: string | null): ExclusiveFixture {
  let current = initial;
  const replacements: (string | null)[] = [];
  const update = vi.fn<StorageAdapter['updateTextExclusive']>(async (_path, updater) => {
    const replacement = await updater(current);
    replacements.push(replacement);
    if (replacement !== null) {
      current = replacement;
    }
  });

  return {
    storage: { ...createInMemoryStorage(), updateTextExclusive: update },
    update,
    replacements,
    current: () => current,
  };
}

function document(properties: Record<string, unknown>): string {
  return `${JSON.stringify({ $schema: CONFIG_SCHEMA_ID, ...properties }, null, 2)}\n`;
}

describe('commitAllowlist()', () => {
  it('creates the exact schema-identified document when the default config was absent at load', async () => {
    const fixture = createExclusiveFixture(null);

    await commitAllowlist(
      fixture.storage,
      { path: CONFIG_PATH, existedAtLoad: false },
      ['zeta', 'Alpha', 'zeta'],
    );

    expect(fixture.update).toHaveBeenCalledOnce();
    expect(fixture.update).toHaveBeenCalledWith(CONFIG_PATH, expect.any(Function), undefined);
    expect(fixture.current()).toBe(document({ secrets: { allow: ['Alpha', 'zeta'] } }));
  });

  it('returns an updater no-op when the current allowlist is wildcard-authoritative', async () => {
    const original = document({ secrets: { allow: '*' }, viewer: { port: 4600 } });
    const fixture = createExclusiveFixture(original);

    await commitAllowlist(fixture.storage, { path: CONFIG_PATH, existedAtLoad: true }, ['new.secret']);

    expect(fixture.replacements).toEqual([null]);
    expect(fixture.current()).toBe(original);
  });

  it('replaces secrets in its existing insertion position without reordering unrelated keys', async () => {
    const original = JSON.stringify({
      $schema: CONFIG_SCHEMA_ID,
      viewer: { port: 4600 },
      secrets: { allow: ['existing'] },
      ai: { provider: 'codex' },
    });
    const fixture = createExclusiveFixture(original);

    await commitAllowlist(fixture.storage, { path: CONFIG_PATH, existedAtLoad: true }, ['beta', 'Alpha']);

    expect(fixture.current()).toBe(document({
      viewer: { port: 4600 },
      secrets: { allow: ['existing', 'Alpha', 'beta'] },
      ai: { provider: 'codex' },
    }));
  });

  it('appends a missing secrets key after all existing keys, including for an empty incoming set', async () => {
    const original = JSON.stringify({
      $schema: CONFIG_SCHEMA_ID,
      viewer: { port: 4600 },
      ai: { provider: 'claude' },
    });
    const fixture = createExclusiveFixture(original);

    await commitAllowlist(fixture.storage, { path: CONFIG_PATH, existedAtLoad: true }, []);

    expect(fixture.current()).toBe(document({
      viewer: { port: 4600 },
      ai: { provider: 'claude' },
      secrets: { allow: [] },
    }));
  });

  it('deduplicates incoming names and UTF-16-sorts only genuinely new names', async () => {
    const fixture = createExclusiveFixture(document({ secrets: { allow: ['zeta', 'existing'] } }));

    await commitAllowlist(
      fixture.storage,
      { path: CONFIG_PATH, existedAtLoad: true },
      ['zeta', 'beta', 'Alpha', 'beta'],
    );

    expect(fixture.current()).toBe(document({
      secrets: { allow: ['zeta', 'existing', 'Alpha', 'beta'] },
    }));
  });

  it('returns an updater no-op only when the current and merged arrays are element-for-element equal', async () => {
    const original = document({ secrets: { allow: ['zeta', 'Alpha'] }, viewer: { port: 4600 } });
    const fixture = createExclusiveFixture(original);

    await commitAllowlist(
      fixture.storage,
      { path: CONFIG_PATH, existedAtLoad: true },
      ['Alpha', 'zeta', 'Alpha'],
    );

    expect(fixture.replacements).toEqual([null]);
    expect(fixture.current()).toBe(original);
  });

  it('rewrites duplicate current entries even when no incoming name is new', async () => {
    const fixture = createExclusiveFixture(document({ secrets: { allow: ['first', 'first', 'second'] } }));

    await commitAllowlist(fixture.storage, { path: CONFIG_PATH, existedAtLoad: true }, ['second']);

    expect(fixture.replacements).toEqual([
      document({ secrets: { allow: ['first', 'second'] } }),
    ]);
  });

  it.each([
    ['malformed JSON', '{"$schema":'],
    ['schema-invalid JSON', JSON.stringify({ $schema: CONFIG_SCHEMA_ID, secrets: { allow: 42 } })],
    ['unsafe raw key', `{"$schema":${JSON.stringify(CONFIG_SCHEMA_ID)},"__proto__":{}}`],
  ] as const)('rejects %s current content without overwriting it', async (_name, original) => {
    const fixture = createExclusiveFixture(original);

    await expect(commitAllowlist(
      fixture.storage,
      { path: CONFIG_PATH, existedAtLoad: true },
      ['new.secret'],
    )).rejects.toBeInstanceOf(ConfigInvalidError);

    expect(fixture.current()).toBe(original);
    expect(fixture.replacements).toEqual([]);
  });

  it('rejects disappearance of a configuration that existed at load', async () => {
    const fixture = createExclusiveFixture(null);

    await expect(commitAllowlist(
      fixture.storage,
      { path: CONFIG_PATH, existedAtLoad: true },
      ['new.secret'],
    )).rejects.toBeInstanceOf(FsIoError);

    expect(fixture.current()).toBeNull();
    expect(fixture.replacements).toEqual([]);
  });

  it('validates and merges a file that appeared after an absent-at-load snapshot', async () => {
    const appeared = document({ viewer: { port: 4600 }, secrets: { allow: ['concurrent'] } });
    const fixture = createExclusiveFixture(appeared);

    await commitAllowlist(
      fixture.storage,
      { path: CONFIG_PATH, existedAtLoad: false },
      ['accepted'],
    );

    expect(fixture.current()).toBe(document({
      viewer: { port: 4600 },
      secrets: { allow: ['concurrent', 'accepted'] },
    }));
  });

  it('does not overwrite invalid content that appeared after an absent-at-load snapshot', async () => {
    const appeared = '{"$schema":"unexpected","secrets":{"allow":false}}';
    const fixture = createExclusiveFixture(appeared);

    await expect(commitAllowlist(
      fixture.storage,
      { path: CONFIG_PATH, existedAtLoad: false },
      ['accepted'],
    )).rejects.toBeInstanceOf(ConfigInvalidError);

    expect(fixture.current()).toBe(appeared);
    expect(fixture.replacements).toEqual([]);
  });

  it('forwards the caller signal to the exclusive update boundary', async () => {
    const fixture = createExclusiveFixture(null);
    const controller = new AbortController();

    await commitAllowlist(
      fixture.storage,
      { path: CONFIG_PATH, existedAtLoad: false },
      ['accepted'],
      controller.signal,
    );

    expect(fixture.update).toHaveBeenCalledWith(CONFIG_PATH, expect.any(Function), controller.signal);
  });
});
