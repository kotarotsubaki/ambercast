import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  main,
  validateTag,
  verifyRelease,
  classifyNpmView,
  renderSummary,
// @ts-expect-error The production ESM script is deliberately untyped JavaScript.
} from '../../../scripts/lib/release-recover.mjs';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

const tag = 'v0.6.0';
const version = '0.6.0';
const messages = [
  'recover must run from main',
  'tag must look like vX.Y.Z',
  'no published, non-prerelease GitHub Release for the tag',
  'tag is not the latest GitHub Release',
  'tag commit is not on main',
  'package.json name or version does not match the tag',
];
const indeterminate = 'could not determine the npm publication state';

type Command = { cmd: string; args: string[] };
type Result = { code: number | null; stdout: string; stderr: string };
const passing: Result[] = [
  { code: 0, stdout: JSON.stringify({ isDraft: false, isPrerelease: false }), stderr: '' },
  { code: 0, stdout: JSON.stringify({ tagName: tag }), stderr: '' },
  { code: 0, stdout: 'abc123\n', stderr: '' },
  { code: 0, stdout: '', stderr: '' },
  { code: 0, stdout: JSON.stringify({ name: 'ambercast', version }), stderr: '' },
];

function fixture(replacements: Record<number, Result> = {}) {
  const calls: Command[] = [];
  const exec = (call: Command): Result => {
    calls.push(call);
    return replacements[calls.length - 1] ?? passing[calls.length - 1]!;
  };
  return { calls, exec };
}

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const originalEnv = { ...process.env };
const tempDirs: string[] = [];

function mainFixture(results: Result[]) {
  const directory = mkdtempSync(join(tmpdir(), 'ambercast-release-recover-'));
  tempDirs.push(directory);
  const output = join(directory, 'output');
  const summary = join(directory, 'summary');
  process.env.GITHUB_OUTPUT = output;
  process.env.GITHUB_STEP_SUMMARY = summary;
  process.env.GH_TOKEN = 'fixture-token';
  vi.mocked(spawnSync).mockImplementation((_cmd, _args) => {
    const next = results.shift();
    if (next === undefined) throw new Error('Unexpected command');
    return { status: next.code, stdout: next.stdout, stderr: next.stderr } as ReturnType<typeof spawnSync>;
  });
  return { output, summary };
}

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.mocked(spawnSync).mockReset();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('release recovery', () => {
  describe('RECOVER-3: release verification', () => {
    it('RECOVER-3: accepts exact numeric tags', () => {
      for (const candidate of ['v0.6.0', 'v10.20.30', 'v0.0.0']) {
        expect(validateTag(candidate)).toEqual({ ok: true, version: candidate.slice(1) });
      }
    });

    it('RECOVER-3: rejects malformed tags without normalization', () => {
      for (const candidate of ['0.6.0', 'v0.6', 'v01.2.3', 'v1.02.3', 'v1.2.03', 'v1.2.3-rc.1', 'V1.2.3', ' v0.6.0', 'v0.6.0\n', 'v1.2.3;rm', '']) {
        expect(validateTag(candidate), candidate).toEqual({ ok: false });
      }
    });

    it('RECOVER-3: stops at stage 1 for a non-main ref', async () => {
      const { calls, exec } = fixture();
      expect(await verifyRelease({ tag, ref: 'refs/heads/feature', exec })).toEqual({ ok: false, message: messages[0] });
      expect(calls).toHaveLength(0);
    });

    it('RECOVER-3: stops at stage 2 for an invalid tag after a valid ref', async () => {
      const { calls, exec } = fixture();
      expect(await verifyRelease({ tag: 'v01.2.3', ref: 'refs/heads/main', exec })).toEqual({ ok: false, message: messages[1] });
      expect(calls).toHaveLength(0);
    });

    it('RECOVER-3: stops at stage 3 for a missing, draft, or prerelease Release', async () => {
      const bad = [
        { code: 1, stdout: '', stderr: 'private diagnostic' },
        ...[{ isDraft: true, isPrerelease: false }, { isDraft: false, isPrerelease: true },
          { isPrerelease: false }, { isDraft: false }, { isDraft: null, isPrerelease: false },
          { isDraft: false, isPrerelease: null }, { isDraft: 'false', isPrerelease: false },
          { isDraft: false, isPrerelease: 0 }].map((value) => ({ code: 0, stdout: JSON.stringify(value), stderr: '' })),
      ];
      for (const result of bad) {
        const { calls, exec } = fixture({ 0: result });
        expect(await verifyRelease({ tag, ref: 'refs/heads/main', exec })).toEqual({ ok: false, message: messages[2] });
        expect(calls).toHaveLength(1);
      }
    });

    it('RECOVER-3: stops at stage 4 for a non-latest tag', async () => {
      const { calls, exec } = fixture({ 1: { code: 0, stdout: JSON.stringify({ tagName: 'v0.7.0' }), stderr: '' } });
      expect(await verifyRelease({ tag, ref: 'refs/heads/main', exec })).toEqual({ ok: false, message: messages[3] });
      expect(calls).toHaveLength(2);
    });

    it('RECOVER-3: stops at stage 5 for a tag commit outside main', async () => {
      const { calls, exec } = fixture({ 3: { code: 1, stdout: '', stderr: 'private diagnostic' } });
      expect(await verifyRelease({ tag, ref: 'refs/heads/main', exec })).toEqual({ ok: false, message: messages[4] });
      expect(calls).toHaveLength(4);
    });

    it('RECOVER-3: stops at stage 6 for either package field mismatch', async () => {
      for (const packageData of [{ name: 'other', version }, { name: 'ambercast', version: '0.7.0' }]) {
        const { calls, exec } = fixture({ 4: { code: 0, stdout: JSON.stringify(packageData), stderr: '' } });
        expect(await verifyRelease({ tag, ref: 'refs/heads/main', exec })).toEqual({ ok: false, message: messages[5] });
        expect(calls).toHaveLength(5);
      }
    });

    it('RECOVER-3: maps each command failure to its stage message', async () => {
      for (let index = 0; index < passing.length; index += 1) {
        for (const code of [1, null]) {
          const { calls, exec } = fixture({ [index]: { code, stdout: '', stderr: 'raw private stderr' } });
          expect(await verifyRelease({ tag, ref: 'refs/heads/main', exec })).toEqual({
            ok: false, message: messages[index < 2 ? index + 2 : index === 4 ? 5 : 4],
          });
          expect(calls).toHaveLength(index + 1);
        }
      }
    });

    it('RECOVER-3: uses full tag refs and returns the peeled SHA', async () => {
      const { calls, exec } = fixture();
      expect(await verifyRelease({ tag, ref: 'refs/heads/main', exec })).toEqual({ ok: true, sha: 'abc123', version });
      expect(calls).toEqual([
        { cmd: 'gh', args: ['release', 'view', tag, '--json', 'isDraft,isPrerelease'] },
        { cmd: 'gh', args: ['release', 'view', '--json', 'tagName'] },
        { cmd: 'git', args: ['rev-parse', `refs/tags/${tag}^{commit}`] },
        { cmd: 'git', args: ['merge-base', '--is-ancestor', `refs/tags/${tag}`, 'origin/main'] },
        { cmd: 'git', args: ['show', `refs/tags/${tag}:package.json`] },
      ]);
    });

    it('RECOVER-3: renders the exact failure and four success summaries', () => {
      expect(renderSummary({ ok: false, message: messages[0] })).toBe(`| item | value |\n| --- | --- |\n| result | failed: ${messages[0]} |`);
      for (const dryRun of [false, true]) {
        for (const publishNeeded of [false, true]) {
          const action = dryRun ? 'dry run (no publish, no deploy)' : publishNeeded ? 'publish and deploy' : 'deploy only';
          const npm = publishNeeded ? 'not published' : 'published';
          expect(renderSummary({ ok: true, tag, version, dryRun, publishNeeded })).toBe(
            `| item | value |\n| --- | --- |\n| tag | ${tag} |\n| version | ${version} |\n| npm | ${npm} |\n| action | ${action} |`,
          );
        }
      }
    });

    it('RECOVER-3/5: default main writes five outputs and the success table', async () => {
      const { output, summary } = mainFixture([...passing, { code: 1, stdout: JSON.stringify({ error: { code: 'E404', summary: `No match found for version ${version}` } }), stderr: '' }]);
      process.env.TAG = tag;
      process.env.DRY_RUN = 'false';
      process.env.GITHUB_REF = 'refs/heads/main';
      await main();
      expect(readFileSync(output, 'utf8')).toBe(`tag=${tag}\nsha=abc123\nversion=${version}\npublish_needed=true\ndeploy=true\n`);
      expect(readFileSync(summary, 'utf8')).toBe(`| item | value |\n| --- | --- |\n| tag | ${tag} |\n| version | ${version} |\n| npm | not published |\n| action | publish and deploy |\n`);
    });

    it('RECOVER-3: default main reports a fixed verification failure without writing files', async () => {
      const { output, summary } = mainFixture([]);
      process.env.TAG = tag;
      process.env.DRY_RUN = 'false';
      process.env.GITHUB_REF = 'refs/heads/feature';
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      await main();
      expect(log).toHaveBeenCalledWith(`::error::${messages[0]}`);
      expect(process.exitCode).toBe(1);
      expect(existsSync(output)).toBe(false);
      expect(existsSync(summary)).toBe(false);
      expect(spawnSync).not.toHaveBeenCalled();
    });

    it.each([
      { stage: 2, inputTag: 'v01.2.3', results: [], commands: 0 },
      { stage: 3, inputTag: tag, results: [{ code: 1, stdout: '', stderr: 'private diagnostic' }], commands: 1 },
      { stage: 4, inputTag: tag, results: [passing[0]!, { code: 0, stdout: JSON.stringify({ tagName: 'v0.7.0' }), stderr: '' }], commands: 2 },
      { stage: 5, inputTag: tag, results: [...passing.slice(0, 3), { code: 1, stdout: '', stderr: 'private diagnostic' }], commands: 4 },
      { stage: 6, inputTag: tag, results: [...passing.slice(0, 4), { code: 0, stdout: JSON.stringify({ name: 'other', version }), stderr: '' }], commands: 5 },
    ])('RECOVER-3: default main reports stage $stage without writing files', async ({ stage, inputTag, results, commands }) => {
      const { output, summary } = mainFixture([...results]);
      writeFileSync(output, '');
      writeFileSync(summary, '');
      process.env.TAG = inputTag;
      process.env.DRY_RUN = 'false';
      process.env.GITHUB_REF = 'refs/heads/main';
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      await main();
      expect(log).toHaveBeenCalledWith(`::error::${messages[stage - 1]}`);
      expect(process.exitCode).toBe(1);
      expect(readFileSync(output, 'utf8')).toBe('');
      expect(readFileSync(summary, 'utf8')).toBe('');
      expect(spawnSync).toHaveBeenCalledTimes(commands);
    });

    it('RECOVER-3: default main maps a raw spawn launch failure to the stage 3 message', async () => {
      const { output, summary } = mainFixture([]);
      writeFileSync(output, '');
      writeFileSync(summary, '');
      process.env.TAG = tag;
      process.env.DRY_RUN = 'false';
      process.env.GITHUB_REF = 'refs/heads/main';
      vi.mocked(spawnSync).mockReturnValue({ status: null, error: new Error('spawn gh ENOENT'), stdout: '', stderr: '', pid: 0, output: [], signal: null } as ReturnType<typeof spawnSync>);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      await main();
      expect(spawnSync).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(`::error::${messages[2]}`);
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining('spawn gh ENOENT'));
      expect(process.exitCode).toBe(1);
      expect(readFileSync(output, 'utf8')).toBe('');
      expect(readFileSync(summary, 'utf8')).toBe('');
    });

    it('RECOVER-4: default main reports npm classification failure without writing files', async () => {
      const { output, summary } = mainFixture([...passing, { code: 0, stdout: JSON.stringify('0.7.0'), stderr: '' }]);
      process.env.TAG = tag;
      process.env.DRY_RUN = 'false';
      process.env.GITHUB_REF = 'refs/heads/main';
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      await main();
      expect(log).toHaveBeenCalledWith(`::error::${indeterminate}`);
      expect(process.exitCode).toBe(1);
      expect(existsSync(output)).toBe(false);
      expect(existsSync(summary)).toBe(false);
    });
  });

  describe('RECOVER-4: npm publication classification', () => {
    it('RECOVER-4: recognizes an exact published version', () => {
      expect(classifyNpmView({ code: 0, stdout: JSON.stringify(version) }, version)).toEqual({ ok: true, publishNeeded: false });
    });

    it('RECOVER-4: recognizes the exact version-level E404', () => {
      expect(classifyNpmView({ code: 1, stdout: JSON.stringify({ error: { code: 'E404', summary: `No match found for version ${version}` } }) }, version)).toEqual({ ok: true, publishNeeded: true });
    });

    for (const [label, result] of [
      ['different summary', { code: 1, stdout: JSON.stringify({ error: { code: 'E404', summary: 'other' } }) }],
      ['different code', { code: 1, stdout: JSON.stringify({ error: { code: 'E500', summary: `No match found for version ${version}` } }) }],
      ['package-level 404', { code: 1, stdout: JSON.stringify({ error: { code: 'E404', summary: 'Not Found - GET https://registry.npmjs.org/ambercast' } }) }],
      ['different version', { code: 0, stdout: JSON.stringify('0.7.0') }],
      ['unparsable JSON', { code: 0, stdout: '{' }],
      ['empty output', { code: 0, stdout: '' }],
    ] as const) {
      it(`RECOVER-4: fails closed for ${label}`, () => {
        expect(classifyNpmView(result, version)).toEqual({ ok: false, message: indeterminate });
      });
    }
  });

  describe('RECOVER-9: recheck idempotency', () => {
    it('RECOVER-9: recheck skips an already published version and appends its summary line', async () => {
      const { output, summary } = mainFixture([{ code: 0, stdout: JSON.stringify(version), stderr: '' }]);
      writeFileSync(summary, 'existing recover summary\n');
      process.argv = [...originalArgv, '--recheck'];
      process.env.VERSION = version;
      await main();
      expect(readFileSync(output, 'utf8')).toBe('skip=true\n');
      expect(readFileSync(summary, 'utf8')).toBe('existing recover summary\nalready published at publish time\n');
      expect(spawnSync).toHaveBeenCalledTimes(1);
    });

    it('RECOVER-9: recheck lets an unpublished version proceed without a summary', async () => {
      const { output, summary } = mainFixture([{ code: 1, stdout: JSON.stringify({ error: { code: 'E404', summary: `No match found for version ${version}` } }), stderr: '' }]);
      process.argv = [...originalArgv, '--recheck'];
      process.env.VERSION = version;
      await main();
      expect(readFileSync(output, 'utf8')).toBe('skip=false\n');
      expect(existsSync(summary)).toBe(false);
      expect(spawnSync).toHaveBeenCalledTimes(1);
    });

    it('RECOVER-9: recheck fails closed without writing files', async () => {
      const { output, summary } = mainFixture([{ code: 0, stdout: JSON.stringify('0.7.0'), stderr: '' }]);
      process.argv = [...originalArgv, '--recheck'];
      process.env.VERSION = version;
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      await main();
      expect(log).toHaveBeenCalledWith(`::error::${indeterminate}`);
      expect(process.exitCode).toBe(1);
      expect(existsSync(output)).toBe(false);
      expect(existsSync(summary)).toBe(false);
    });
    it('RECOVER-9: changes from publish needed to already published on a second view', () => {
      const first = classifyNpmView({ code: 1, stdout: JSON.stringify({ error: { code: 'E404', summary: `No match found for version ${version}` } }) }, version);
      const second = classifyNpmView({ code: 0, stdout: JSON.stringify(version) }, version);
      expect(first).toEqual({ ok: true, publishNeeded: true });
      expect(second).toEqual({ ok: true, publishNeeded: false });
    });
  });
});
