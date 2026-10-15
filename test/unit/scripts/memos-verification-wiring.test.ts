import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';

const root = new URL('../../../', import.meta.url);
const temporaryRoots: string[] = [];
const git = (cwd: string | URL, args: string[]) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000,
}).trim();

// Committing a dependency change must not reset the baseline to HEAD. PR CI
// checks out a shallow merge ref, so neither main ref nor its ancestry is assured.
function baselineCommit(cwd: string | URL, eventPath = process.env.GITHUB_EVENT_PATH): string {
  for (const ref of ['main', 'origin/main']) {
    try { return git(cwd, ['merge-base', 'HEAD', ref]); } catch { /* Try the next stable base. */ }
  }
  const sha: unknown = eventPath
    ? JSON.parse(readFileSync(eventPath, 'utf8')).pull_request?.base?.sha
    : undefined;
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/i.test(sha)) {
    throw new Error('Cannot resolve main/origin/main or a valid pull_request.base.sha dependency baseline');
  }
  try {
    try { git(cwd, ['cat-file', '-e', `${sha}^{commit}`]); } catch {
      git(cwd, ['fetch', '--no-tags', '--depth=1', 'origin', sha]);
      git(cwd, ['cat-file', '-e', `${sha}^{commit}`]);
    }
  } catch (cause) {
    throw new Error(`Cannot obtain dependency baseline commit ${sha} from the PR event`, { cause });
  }
  return sha;
}

function dependencyKeys(manifest: {
  dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>;
}) {
  return [...new Set([
    ...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {}),
  ])].sort();
}

function repositoryFixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'memos-wiring-test-'));
  temporaryRoots.push(cwd);
  git(cwd, ['init', '-b', 'main']);
  const commit = (dependencies: Record<string, string>) => {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies, devDependencies: {} }));
    git(cwd, ['add', 'package.json']);
    git(cwd, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test',
      '-c', 'commit.gpgSign=false', 'commit', '-m', 'fixture']);
    return git(cwd, ['rev-parse', 'HEAD']);
  };
  const base = commit({ existing: '1.0.0' });
  git(cwd, ['checkout', '-b', 'issues/549']);
  const head = commit({ existing: '1.0.0', added: '1.0.0' });
  return { cwd, base, head };
}

afterEach(() => {
  for (const cwd of temporaryRoots.splice(0)) rmSync(cwd, { recursive: true, force: true });
});

describe('TEST-63 stable dependency baseline', () => {
  test('prefers main and detects a dependency added in an already committed change', () => {
    const { cwd, base, head } = repositoryFixture();
    git(cwd, ['update-ref', 'refs/remotes/origin/main', head]);
    const resolved = baselineCommit(cwd, '');
    expect(resolved).toBe(base);
    const baseline = JSON.parse(git(cwd, ['show', `${resolved}:package.json`]));
    const current = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    expect(dependencyKeys(baseline)).toEqual(['existing']);
    expect(dependencyKeys(current)).toEqual(['added', 'existing']);
    expect(dependencyKeys(current)).not.toEqual(dependencyKeys(baseline));
  });

  test('uses origin/main when the local main branch is absent', () => {
    const { cwd, base } = repositoryFixture();
    git(cwd, ['update-ref', 'refs/remotes/origin/main', base]);
    git(cwd, ['branch', '-D', 'main']);
    expect(baselineCommit(cwd, '')).toBe(base);
  });

  test('fetches the event base SHA in a depth-one PR checkout without main refs', () => {
    const { cwd, base } = repositoryFixture();
    const checkout = join(cwd, 'checkout');
    git(cwd, ['clone', '--depth=1', '--single-branch', '--branch', 'issues/549',
      pathToFileURL(cwd).href, checkout]);
    const event = join(cwd, 'event.json');
    writeFileSync(event, JSON.stringify({ pull_request: { base: { sha: base } } }));
    expect(git(checkout, ['rev-parse', '--is-shallow-repository'])).toBe('true');
    expect(() => git(checkout, ['cat-file', '-e', `${base}^{commit}`])).toThrow();
    expect(baselineCommit(checkout, event)).toBe(base);
    expect(JSON.parse(git(checkout, ['show', `${base}:package.json`])).dependencies)
      .toEqual({ existing: '1.0.0' });
    expect(git(checkout, ['for-each-ref', '--format=%(refname)', 'refs/heads/main', 'refs/remotes/origin/main']))
      .toBe('');
  });

  test.each([undefined, '--upload-pack=unexpected', 'a'.repeat(39), 'g'.repeat(40)])(
    'fails closed without a main ref or valid event base SHA (%s)', sha => {
      const { cwd } = repositoryFixture();
      git(cwd, ['branch', '-D', 'main']);
      const event = join(cwd, 'event.json');
      if (sha !== undefined) writeFileSync(event, JSON.stringify({ pull_request: { base: { sha } } }));
      expect(() => baselineCommit(cwd, sha === undefined ? '' : event))
        .toThrow('Cannot resolve main/origin/main or a valid pull_request.base.sha dependency baseline');
    },
  );
});

describe('memos verification wiring', () => {
  test('TEST-41 the committed fixture config has the documented shape', () => {
    const config = JSON.parse(
      readFileSync(new URL('test/verification/memos/fixture/ambercast.config.json', root), 'utf8'),
    );

    expect(typeof config.$schema).toBe('string');
    expect(config.$schema).toBeTruthy();
    expect(config.targets.memos.baseUrl).toBe('http://127.0.0.1:5230');
    expect(config.defaultTarget).toBe('memos');
    expect(Array.isArray(config.secrets.allow)).toBe(true);
    // The committed fixture seeds an empty allow-list; a regenerated fixture
    // populates it with exactly one secret name. Both shapes are valid here,
    // since this check only constrains the committed seed, not the
    // post-regeneration oracle.
    expect([0, 1]).toContain(config.secrets.allow.length);

    const prompt = readFileSync(
      new URL('test/verification/memos/fixture/tests/ambercast/memos-sign-in-create-memo.test.md', root),
      'utf8',
    );
    expect(prompt).toBe(`# Sign in to Memos and create a memo

Open the sign-in page. Enter the username "verifier" and the saved password, then click "Sign in". Assert that the "Save" button is displayed. Then assert that the text "verifier" is displayed.
Type "ambercast smoke memo" into the memo editor and click "Save". Assert that the text "ambercast smoke memo" is displayed in the memo list.
`);
  });

  test('the smoke-judge verification entry point wires AMBERCAST_VERIFY_MEMOS_MODE into judgeSmokeReport\'s mode', () => {
    const source = readFileSync(
      new URL('test/verification/memos/smoke-judge.verification.test.ts', root), 'utf8',
    );
    expect(source).toMatch(/AMBERCAST_VERIFY_MEMOS_MODE/);
    expect(source).toMatch(/judgeSmokeReport\(\{[^}]*mode/);
  });

  test('TEST-63 package.json, vitest configs, and AGENTS.md are wired as documented', () => {
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
    expect(pkg.scripts['verify:memos']).toBe('node scripts/verify-memos.mjs');
    expect(pkg.scripts['test:verification:memos']).toBe('vitest run --config vitest.config.verification.ts');

    const baseRef = baselineCommit(root);
    const committedPkg = JSON.parse(
      git(root, ['show', `${baseRef}:package.json`]),
    );
    expect(dependencyKeys(pkg)).toEqual(dependencyKeys(committedPkg));

    const unitConfig = readFileSync(new URL('vitest.config.ts', root), 'utf8');
    expect(unitConfig).toMatch(/\bexclude\s*:\s*\[[^\]]*['"]test\/verification\/\*\*['"][^\]]*\]/);
    const verificationConfig = readFileSync(new URL('vitest.config.verification.ts', root), 'utf8');
    expect(verificationConfig).toMatch(
      /\binclude\s*:\s*\[[^\]]*['"]test\/verification\/\*\*\/\*\.verification\.test\.ts['"][^\]]*\]/,
    );

    const agents = readFileSync(new URL('AGENTS.md', root), 'utf8');
    const commandsHeading = agents.indexOf('## Commands');
    expect(commandsHeading).toBeGreaterThanOrEqual(0);
    const commands = agents.slice(commandsHeading);
    expect(commands).toContain('npm run verify:memos');
    expect(commands).toContain('npm run test:verification:memos');
  });
});
