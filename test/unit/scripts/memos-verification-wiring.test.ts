import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const root = new URL('../../../', import.meta.url);

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

    const baseRef = execSync('git merge-base HEAD main', { cwd: root, encoding: 'utf8' }).trim();
    const committedPkg = JSON.parse(
      execSync(`git show ${baseRef}:package.json`, { cwd: root, encoding: 'utf8' }),
    );
    const dependencyKeys = (manifest: typeof pkg) =>
      [...new Set([...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)])].sort();
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
