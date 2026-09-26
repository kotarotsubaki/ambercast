// Issue #466 verifies workflow_dispatch release-please recovery requests and
// classifies npm publication state before downstream release jobs proceed.

import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/**
 * Validates a recovery tag and extracts its package version.
 *
 * @remarks
 * This pure export lets tag-format cases run without a command fixture, while
 * `verifyRelease` still invokes it as stage ② after the ref check. The
 * format is an exact lowercase `v` followed by three dot-separated
 * non-negative integers without leading zeros. Trimming or case folding would
 * turn a different supplied tag into an apparently valid release request.
 *
 * @param {string} tag - Tag supplied for recovery, including its leading `v`.
 * @returns {{ ok: true, version: string } | { ok: false }} The version without `v` for a valid tag, or a format rejection.
 */
export function validateTag(tag) {
  const regex = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
  const match = tag.match(regex);
  if (match) {
    return { ok: true, version: tag.slice(1) };
  }
  return { ok: false };
}

/**
 * Verifies that a requested tag identifies the latest eligible release on main.
 *
 * @remarks
 * The six checks short-circuit in order: ① `ref === 'refs/heads/main'`,
 * ② exact tag format via `validateTag` (which supplies `version`),
 * ③ `gh release view <tag> --json isDraft,isPrerelease`, requiring both JSON
 * fields to be `false`, ④ `gh release view --json tagName` with no positional
 * argument, requiring its `tagName` to equal the requested tag ("latest"),
 * ⑤ `git rev-parse refs/tags/<tag>^{commit}` to peel the tag to its commit,
 * followed by `git merge-base --is-ancestor refs/tags/<tag> origin/main`, and
 * ⑥ `git show refs/tags/<tag>:package.json`, parsing JSON and requiring
 * `name === 'ambercast' && version === <version from stage ②>`.
 * No later command runs after a failed stage. `ref` is caller-supplied
 * rather than read from `process.env` here, so tests can compose a chosen ref
 * with the injected command executor. Git arguments use full
 * `refs/tags/<tag>` references, including commit peeling and the package
 * lookup, to prevent a same-named branch from taking precedence.
 *
 * Stage failures use these exact messages, including for command failures;
 * raw command diagnostics do not become operator-facing output:
 * ① `recover must run from main`
 * ② `tag must look like vX.Y.Z`
 * ③ `no published, non-prerelease GitHub Release for the tag`
 * ④ `tag is not the latest GitHub Release`
 * ⑤ `tag commit is not on main`
 * ⑥ `package.json name or version does not match the tag`
 * Missing, null, or non-boolean draft/prerelease fields fail at stage ③.
 * The declared async signature keeps this export consistent with async
 * `main`; the injected `exec` seam itself is synchronous.
 *
 * @param {{ tag: string, ref: string, exec: ({ cmd, args }: { cmd: string, args: string[] }) => { code: number | null, stdout: string, stderr: string } }} options - Recovery tag, caller-supplied GitHub ref, and a non-throwing command executor.
 * @returns {Promise<{ ok: true, sha: string, version: string } | { ok: false, message: string }>} The peeled tag commit and version on success, or the first stage's fixed diagnostic.
 */
export async function verifyRelease({ tag, ref, exec }) {
  // ①
  if (ref !== 'refs/heads/main') {
    return { ok: false, message: 'recover must run from main' };
  }

  // ②
  const tagResult = validateTag(tag);
  if (!tagResult.ok) {
    return { ok: false, message: 'tag must look like vX.Y.Z' };
  }
  const version = tagResult.version;

  // ③
  {
    const result = exec({ cmd: 'gh', args: ['release', 'view', tag, '--json', 'isDraft,isPrerelease'] });
    if (result.code !== 0) {
      return { ok: false, message: 'no published, non-prerelease GitHub Release for the tag' };
    }
    let releaseInfo;
    try {
      releaseInfo = JSON.parse(result.stdout);
    } catch {
      return { ok: false, message: 'no published, non-prerelease GitHub Release for the tag' };
    }
    if (typeof releaseInfo !== 'object' || releaseInfo === null ||
        typeof releaseInfo.isDraft !== 'boolean' || releaseInfo.isDraft !== false ||
        typeof releaseInfo.isPrerelease !== 'boolean' || releaseInfo.isPrerelease !== false) {
      return { ok: false, message: 'no published, non-prerelease GitHub Release for the tag' };
    }
  }

  // ④
  {
    const result = exec({ cmd: 'gh', args: ['release', 'view', '--json', 'tagName'] });
    if (result.code !== 0) {
      return { ok: false, message: 'tag is not the latest GitHub Release' };
    }
    let info;
    try {
      info = JSON.parse(result.stdout);
    } catch {
      return { ok: false, message: 'tag is not the latest GitHub Release' };
    }
    if (typeof info !== 'object' || info === null || info.tagName !== tag) {
      return { ok: false, message: 'tag is not the latest GitHub Release' };
    }
  }

  // ⑤
  {
    const result1 = exec({ cmd: 'git', args: ['rev-parse', `refs/tags/${tag}^{commit}`] });
    if (result1.code !== 0) {
      return { ok: false, message: 'tag commit is not on main' };
    }
    const sha = result1.stdout.trim();

    const result2 = exec({ cmd: 'git', args: ['merge-base', '--is-ancestor', `refs/tags/${tag}`, 'origin/main'] });
    if (result2.code !== 0) {
      return { ok: false, message: 'tag commit is not on main' };
    }

    // ⑥
    {
      const result3 = exec({ cmd: 'git', args: ['show', `refs/tags/${tag}:package.json`] });
      if (result3.code !== 0) {
        return { ok: false, message: 'package.json name or version does not match the tag' };
      }
      let pkg;
      try {
        pkg = JSON.parse(result3.stdout);
      } catch {
        return { ok: false, message: 'package.json name or version does not match the tag' };
      }
      if (typeof pkg !== 'object' || pkg === null || pkg.name !== 'ambercast' || pkg.version !== version) {
        return { ok: false, message: 'package.json name or version does not match the tag' };
      }
    }

    return { ok: true, sha, version };
  }
}

/**
 * Classifies one npm version lookup as published, absent, or indeterminate.
 *
 * @remarks
 * This remains separate from release verification because both the initial
 * recovery check and the publish-time recheck need the identical npm rule.
 * Exit zero with the exact requested version means published; exit one with
 * `error.code === 'E404'` and `error.summary === 'No match found for version <version>'`
 * means unpublished. Every other result fails closed with the fixed message
 * `could not determine the npm publication state`, including malformed JSON,
 * a package-level 404, and a version mismatch.
 *
 * @param {{ code: number | null, stdout: string }} view - Exit code and JSON output from `npm view --json`.
 * @param {string} version - Exact package version requested from npm.
 * @returns {{ ok: true, publishNeeded: boolean } | { ok: false, message: string }} Whether publication is needed, or the fixed indeterminate-state diagnostic.
 */
export function classifyNpmView({ code, stdout }, version) {
  if (code === 0) {
    try {
      const parsed = JSON.parse(stdout);
      if (parsed === version) {
        return { ok: true, publishNeeded: false };
      }
    } catch {
      // Fall through to error case
    }
    return { ok: false, message: 'could not determine the npm publication state' };
  }

  if (code === 1) {
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.error?.code === 'E404' && parsed.error?.summary === `No match found for version ${version}`) {
        return { ok: true, publishNeeded: true };
      }
    } catch {
      // Fall through to error case
    }
    return { ok: false, message: 'could not determine the npm publication state' };
  }

  return { ok: false, message: 'could not determine the npm publication state' };
}

/**
 * Formats the recovery result as a GitHub step-summary table.
 *
 * @remarks
 * The failure table is exactly three lines:
 * `| item | value |`
 * `| --- | --- |`
 * `| result | failed: <message> |`
 * The success table is exactly six lines:
 * `| item | value |`
 * `| --- | --- |`
 * `| tag | <tag> |`
 * `| version | <version> |`
 * `| npm | published |` when `!publishNeeded`, otherwise
 * `| npm | not published |`.
 * `| action | dry run (no publish, no deploy) |` when `dryRun`,
 * `| action | publish and deploy |` when `!dryRun && publishNeeded`, or
 * `| action | deploy only |` when `!dryRun && !publishNeeded`.
 * The publish-time recheck writes its single diagnostic directly because it
 * does not use this table contract.
 *
 * @param {{ ok: false, message: string } | { ok: true, tag: string, version: string, dryRun: boolean, publishNeeded: boolean }} result - Failed recovery or successful default-mode inputs.
 * @returns {string} The contractual failure or success table described above.
 */
export function renderSummary(result) {
  if (!result.ok) {
    return `| item | value |\n| --- | --- |\n| result | failed: ${result.message} |`;
  }
  const npm = result.publishNeeded ? 'not published' : 'published';
  const action = result.dryRun ? 'dry run (no publish, no deploy)' : result.publishNeeded ? 'publish and deploy' : 'deploy only';
  return `| item | value |\n| --- | --- |\n| tag | ${result.tag} |\n| version | ${result.version} |\n| npm | ${npm} |\n| action | ${action} |`;
}

/**
 * Runs the recovery check or the publish-time npm recheck.
 *
 * @remarks
 * Default mode reads `TAG`, `DRY_RUN`, `GITHUB_REF`, and `GH_TOKEN`; it
 * verifies the release, then classifies npm state. On success it writes the
 * five downstream contract values to `$GITHUB_OUTPUT`: `tag=<tag>`,
 * `sha=<sha from verifyRelease>`, `version=<version>`,
 * `publish_needed=<'true'|'false'>` according to `publishNeeded`, and
 * `deploy=<'false' when dryRun else 'true'>`. It then writes the exact table
 * specified by `renderSummary` to `$GITHUB_STEP_SUMMARY`.
 * The machine-readable data takes priority over the
 * human summary. Runner-supplied file paths are not a validated trust
 * boundary, and a partial CI file write has no meaningful recovery here, so
 * no transaction or rollback is added. A validation failure writes
 * `::error::<message>` and exits unsuccessfully without touching either file.
 *
 * `--recheck` reads `VERSION` and `GH_TOKEN` and repeats only npm
 * classification. It writes `skip='true'` when the version is already
 * published and appends the single line `already published at publish time`
 * to the summary. When the version is not yet published, it writes
 * `skip='false'` so the downstream `npm publish` step runs, and appends no
 * summary line. Classification failure writes `::error::<message>` and exits
 * with a non-zero status, as in default mode.
 *
 * @returns {Promise<void>} Completion after writing mode-specific outputs and summary, or setting a failure exit status.
 */
export async function main() {
  const isRecheck = process.argv.includes('--recheck');

  const exec = ({ cmd, args }) => {
    const result = spawnSync(cmd, args, { encoding: 'utf8' });
    // A failed launch has no process exit status.
    const code = result.error ? null : result.status;
    return {
      code,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  };

  if (!isRecheck) {
    const tag = process.env.TAG;
    const ref = process.env.GITHUB_REF;
    const dryRun = process.env.DRY_RUN === 'true';

    const verifyResult = await verifyRelease({ tag, ref, exec });
    if (!verifyResult.ok) {
      console.log(`::error::${verifyResult.message}`);
      process.exitCode = 1;
      return;
    }

    const npmResult = exec({ cmd: 'npm', args: ['view', `ambercast@${verifyResult.version}`, 'version', '--json', '--registry', 'https://registry.npmjs.org'] });
    const classification = classifyNpmView(npmResult, verifyResult.version);
    if (!classification.ok) {
      console.log(`::error::${classification.message}`);
      process.exitCode = 1;
      return;
    }

    const output = process.env.GITHUB_OUTPUT;
    appendFileSync(output, `tag=${tag}\nsha=${verifyResult.sha}\nversion=${verifyResult.version}\npublish_needed=${classification.publishNeeded ? 'true' : 'false'}\ndeploy=${dryRun ? 'false' : 'true'}\n`);

    const summary = process.env.GITHUB_STEP_SUMMARY;
    appendFileSync(summary, renderSummary({ ok: true, tag, version: verifyResult.version, dryRun, publishNeeded: classification.publishNeeded }) + '\n');
  } else {
    const version = process.env.VERSION;

    const npmResult = exec({ cmd: 'npm', args: ['view', `ambercast@${version}`, 'version', '--json', '--registry', 'https://registry.npmjs.org'] });
    const classification = classifyNpmView(npmResult, version);
    if (!classification.ok) {
      console.log(`::error::${classification.message}`);
      process.exitCode = 1;
      return;
    }

    const output = process.env.GITHUB_OUTPUT;
    appendFileSync(output, `skip=${classification.publishNeeded ? 'false' : 'true'}\n`);

    if (!classification.publishNeeded) {
      const summary = process.env.GITHUB_STEP_SUMMARY;
      appendFileSync(summary, 'already published at publish time\n');
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
