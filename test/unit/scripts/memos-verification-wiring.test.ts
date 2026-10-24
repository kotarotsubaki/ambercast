import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, test, vi } from 'vitest';

const root = new URL('../../../', import.meta.url);
const fixture = new URL('test/verification/memos/fixture/', root);
const expectedCases = [
  { id: 'memos-sign-in-create-memo', target: 'memos' },
  { id: 'memos-edit-memo', target: 'memos' },
  { id: 'memos-delete-memo', target: 'memos' },
  { id: 'memos-search-memos', target: 'memos' },
  { id: 'memos-tag-filter', target: 'memos' },
  { id: 'memos-settings-dialog', target: 'memos-readonly' },
  { id: 'memos-ja-locale', target: 'memos-ja' },
];
const signIn = 'Open the sign-in page. Enter the username "verifier" and the saved password, then click "Sign in". Assert that the "Save" button is displayed. Then assert that the text "verifier" is displayed.';
const originalPrompt = `# Sign in to Memos and create a memo

${signIn}
Type "ambercast smoke memo" into the memo editor and click "Save". Assert that the text "ambercast smoke memo" is displayed in the memo list.
`;

// Literal expectations remain independent of the exported table so losing a
// case cannot silently reduce both the harness input and its test oracle.
async function harnessExports(): Promise<Record<string, unknown>> {
  return import(new URL('scripts/verify-memos.mjs', root).href);
}

function fixtureText(path: string): string {
  return readFileSync(new URL(path, fixture), 'utf8');
}

interface FixtureStep {
  id: string;
  target: string;
  action?: string;
  value?: string;
  secretRef?: string;
  intent?: { quote?: unknown };
}

function fixturePlan(id: string): { steps: FixtureStep[] } {
  return JSON.parse(fixtureText(`tests/ambercast/${id}.ambercast.plan.json`));
}

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
  it('TEST-544-4 exports the frozen seven-case table in the specified id and target order', async () => {
    const { CASES } = await harnessExports();
    expect(Array.isArray(CASES)).toBe(true);
    expect(CASES).toHaveLength(7);
    expect(CASES).toEqual(expectedCases);
    expect(Object.isFrozen(CASES)).toBe(true);
  });

  it.each(expectedCases)('TEST-544-4 commits all three fixture files for $id', ({ id }) => {
    for (const suffix of ['.test.md', '.ambercast.plan.json', '.ambercast.grounding.json']) {
      const file = new URL(`tests/ambercast/${id}${suffix}`, fixture);
      expect.soft(existsSync(file), file.pathname).toBe(true);
    }
  });

  it('TEST-544-4 preserves the original sign-in/create prompt byte for byte', () => {
    const bytes = readFileSync(new URL('tests/ambercast/memos-sign-in-create-memo.test.md', fixture));
    expect(bytes.equals(Buffer.from(originalPrompt, 'utf8'))).toBe(true);
  });

  it.each(expectedCases.slice(1, 6))('TEST-544-4 reuses the original sign-in sentence in $id', ({ id }) => {
    const first = fixtureText('tests/ambercast/memos-sign-in-create-memo.test.md').split('\n')[2];
    expect(first).toBe(signIn);
    expect(fixtureText(`tests/ambercast/${id}.test.md`).split('\n')).toContain(first);
  });

  it.each([
    ['memos-edit-memo', '# Edit a memo',
      'Type "ambercast edit original" into the memo editor and click "Save". Assert that the text "ambercast edit original" is displayed in the memo list.',
      'Reload the page.',
      'Open the menu of the memo "ambercast edit original" and choose "<Edit>". Replace the memo text with "ambercast edit updated" and click "<save>". Assert that the text "ambercast edit updated" is displayed in the memo list.'],
    ['memos-delete-memo', '# Delete a memo',
      'Type "ambercast delete target" into the memo editor and click "Save". Assert that the text "ambercast delete target" is displayed in the memo list.',
      'Reload the page.',
      'Open the menu of the memo "ambercast delete target", choose "<Delete>" and confirm with "<confirm>". Assert that the text "ambercast delete target" is no longer displayed.'],
    ['memos-search-memos', '# Search memos',
      'Type "ambercast searchable kiwi" into the memo editor and click "Save".',
      'Click the Search button in the sidebar.',
      'Type "kiwi" into the search box and press Enter. Assert that the text "ambercast searchable kiwi" is displayed.'],
    ['memos-tag-filter', '# Filter memos by tag',
      'Type "ambercast tagged memo #ambercasttag" into the memo editor and click "Save".',
      'Click the tag "ambercasttag" in the tag list. Assert that the text "ambercast tagged memo" is displayed.'],
    ['memos-settings-dialog', '# Open a settings dialog',
      'Open the user menu in the sidebar and go to the settings page.',
      'Open the "<open>" dialog and assert that the "<heading>" heading is displayed. Then close the dialog with "<Cancel>".'],
    ['memos-ja-locale', '# Use Memos in Japanese',
      'Open the sign-in page. Assert that the "サインイン" button is displayed. Enter the username "verifier" and the saved password, then click "サインイン". Assert that the "Save" button is displayed.'],
  ])('TEST-544-4 preserves the fixed prompt text and LF format for %s', (id, heading, ...lines) => {
    const text = fixtureText(`tests/ambercast/${id}.test.md`);
    expect(text.startsWith(`${heading}\n\n`)).toBe(true);
    expect(text).not.toContain('\r');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    // Observed accessible names are checked by replay; only the surrounding
    // specification text is an oracle here, including straight quote marks.
    for (const line of lines) {
      const parts = line.split(/<[^>]+>/);
      let offset = 0;
      for (const part of parts) {
        const index = text.indexOf(part, offset);
        expect(index, part).toBeGreaterThanOrEqual(offset);
        offset = index + part.length;
      }
    }
  });

  it('TEST-544-5 pins the three fixture targets, isolation, secret count and heal budget', () => {
    const config = JSON.parse(fixtureText('ambercast.config.json'));
    expect(Object.keys(config.targets).sort()).toEqual(['memos', 'memos-ja', 'memos-readonly']);
    for (const target of ['memos', 'memos-readonly', 'memos-ja']) {
      expect(config.targets[target].baseUrl).toBe('http://127.0.0.1:5230');
      expect(config.targets[target].locale).toBe(target === 'memos-ja' ? 'ja-JP' : 'en-US');
      if (target === 'memos-readonly') {
        expect(config.targets[target].healReplayIsolation).toBe('idempotent');
      } else {
        expect(config.targets[target]).not.toHaveProperty('healReplayIsolation');
      }
    }
    expect(config.defaultTarget).toBe('memos');
    expect(Array.isArray(config.secrets.allow)).toBe(true);
    expect(config.secrets.allow).toHaveLength(1);
    expect(config.heal.maxStepRepairs).toBe(2);
  });

  it.each(expectedCases)('TEST-544-5 uses only target $target in the plan for $id', ({ id, target }) => {
    expect([...new Set(fixturePlan(id).steps.map(step => step.target))]).toEqual([target]);
  });

  it('TEST-544-5 limits settings-dialog inputs to the username and allowed password', () => {
    const config = JSON.parse(fixtureText('ambercast.config.json'));
    expect(config.secrets.allow).toHaveLength(1);
    const inputs = fixturePlan('memos-settings-dialog').steps
      .filter(step => step.action === 'fill' || step.action === 'fill-secret');
    expect(inputs).toHaveLength(2);
    expect(inputs.filter(step => step.action === 'fill')).toHaveLength(1);
    expect(inputs.find(step => step.action === 'fill')?.value).toBe('verifier');
    expect(inputs.filter(step => step.action === 'fill-secret')).toHaveLength(1);
    expect(inputs.find(step => step.action === 'fill-secret')?.secretRef)
      .toBe(`{{secrets.${config.secrets.allow[0]}}}`);
  });

  it('TEST-544-5 identifies exactly one unquoted settings-entry click by HEAL_STEP_ID', async () => {
    const { HEAL_STEP_ID } = await harnessExports();
    expect(HEAL_STEP_ID).toBeTypeOf('string');
    expect(HEAL_STEP_ID).not.toBe('');
    const steps = fixturePlan('memos-settings-dialog').steps.filter(step => step.id === HEAL_STEP_ID);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.action).toBe('click');
    expect(steps[0]?.intent).toBeDefined();
    expect(steps[0]?.intent).not.toHaveProperty('quote');
  });

  it('TEST-544-22 places the release checklist immediately before How to contribute and pins release guidance', () => {
    const text = readFileSync(new URL('CONTRIBUTING.md', root), 'utf8');
    const headings: string[] = text.match(/^## .+$/gm) ?? [];
    const releaseIndex = headings.indexOf('## Release checklist');
    expect(releaseIndex).toBeGreaterThanOrEqual(0);
    expect(headings[releaseIndex + 1]).toBe('## How to contribute');
    const checklist = text.split('## Release checklist\n')[1]?.split('\n## ')[0];
    for (const line of [
      'The middle verification layer, a pinned Memos instance driven by `npm run verify:memos`, is the pre-release check. Dogfooding in a downstream product (the upper layer) is optional and never blocks a release.',
      '1. Before merging the release PR, check out the release PR head and run `npm run verify:memos` and then `npm run verify:memos -- --heal-check`. Both need Docker and a local Chromium; `--heal-check` also calls Claude through the local Claude Code CLI. Each run must end with a `PASS` line. Paste both final lines, including `sha=`, into the release PR.',
      '2. If either run fails, do not merge the release PR. Fix the cause through the normal issue flow first.',
      '3. After npm publication, run `npm run verify:memos -- --published <version>` against the published package and confirm it ends with `PASS`.',
      'If `npm run verify:memos` reports stale plans, regenerate the fixture with `npm run verify:memos -- --regenerate` in a normal issue PR before the release. It calls a real AI provider and may ask for secret consent, so run it locally.',
    ]) expect.soft(checklist).toContain(line);
    const unpublished = text.split('## Testing an unpublished build in another project\n')[1]?.split('\n## ')[0];
    expect(unpublished).toContain("Use this flow to try an unpublished upstream build in the dogfood downstream project. Do not commit a development build's generated `plan` or `grounding` there. For a release, follow the Release checklist below; before merging the release PR, also follow the compatibility-table/glossary/spec-overview update procedure in AGENTS.md's Branching & releases section.");
    expect(text).not.toContain('tracked in issue #544');
  });

  it('TEST-544-22 links the verify:memos command to release guidance and keeps downstream dogfooding optional', () => {
    const agents = readFileSync(new URL('AGENTS.md', root), 'utf8');
    const commands = agents.split('## Commands\n')[1]?.split('\n## ')[0];
    const command = commands?.split('\n').find(line => line.startsWith('- `npm run verify:memos`'));
    for (const part of ['--heal-check', '--published <version>', 'Release checklist']) {
      expect.soft(command).toContain(part);
    }
    const branching = agents.split('\n\n').find(paragraph => paragraph.startsWith('**Branching & releases**'));
    expect(branching).toContain('downstream dogfooding never blocks a release');
  });

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

  test.each(['full', 'disclosure-only', 'heal-report', undefined] as const)(
    'the smoke-judge entry forwards parsed input and skips without REPORT (mode: %s)', async mode => {
    const directory = mkdtempSync(join(tmpdir(), 'memos-entry-test-'));
    temporaryRoots.push(directory);
    const reportFile = join(directory, 'report.json');
    const report = { marker: 'report file contents' };
    writeFileSync(reportFile, JSON.stringify(report));
    const parsed = {
      reportFile,
      mode,
      expectedCases: 7,
      artifactRoots: ['/parsed/.runs', '/parsed/plan.json'],
      secrets: { password: 'synthetic-wiring-secret' },
    };
    const parseJudgeEnv = vi.fn(() => mode === undefined ? undefined : parsed);
    const judgeSmokeReport = vi.fn(async (_input: unknown) => {});
    const bodies: (() => unknown)[] = [];
    const skipIf = vi.fn((skip: boolean) => (_name: string, collect: () => void) => {
      collect();
      if (skip) bodies.length = 0;
    });
    // Capture registration while importing the real entry so no nested tests
    // are registered with the active runner. Only runnable bodies are invoked.
    vi.doMock('vitest', () => ({
      describe: { skipIf },
      it: (_name: string, body: () => unknown) => { bodies.push(body); },
    }));
    vi.doMock('../../verification/memos/support/judge.js', () => ({
      parseJudgeEnv, judgeSmokeReport,
    }));
    try {
      vi.stubEnv('AMBERCAST_VERIFY_MEMOS_REPORT', mode === undefined ? undefined : reportFile);
      vi.stubEnv('AMBERCAST_VERIFY_MEMOS_ARTIFACT_ROOTS', '[]');
      vi.stubEnv('AMBERCAST_VERIFY_MEMOS_SECRETS', '{}');
      vi.stubEnv('AMBERCAST_VERIFY_MEMOS_MODE', mode);
      vi.resetModules();
      await import('../../verification/memos/smoke-judge.verification.test.js');
      expect(skipIf).toHaveBeenCalledExactlyOnceWith(mode === undefined);
      expect(bodies).toHaveLength(mode === undefined ? 0 : 1);
      for (const body of bodies) await body();
      if (mode === undefined) {
        expect(parseJudgeEnv).not.toHaveBeenCalled();
        expect(judgeSmokeReport).not.toHaveBeenCalled();
      } else {
        expect(parseJudgeEnv).toHaveBeenCalledExactlyOnceWith(process.env);
        expect(judgeSmokeReport).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          report,
          artifactRoots: parsed.artifactRoots,
          secrets: parsed.secrets,
          mode: parsed.mode,
          expectedCases: parsed.expectedCases,
        }));
      }
    } finally {
      vi.unstubAllEnvs();
      vi.doUnmock('vitest');
      vi.doUnmock('../../verification/memos/support/judge.js');
      vi.resetModules();
    }
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
