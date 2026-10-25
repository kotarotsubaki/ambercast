# Contributing

Thanks for your interest in ambercast!

## Current state

ambercast is published on npm (pre-1.0; the exact version is in `package.json`). The CLI (`init`, `generate`, `run`, `check`, `heal`, `view`, `mcp`) is functional, but breaking changes can still land in a minor release. Contributions to code, tests, docs (README in three locales, the docs site under `website/`), and toolchain are all welcome. Please open an issue before large changes.

## Development

Requires Node.js >= 22.14.

- `npm run build` — compile `src/` to `dist/` (tsdown) and regenerate the schemas and CLI/capabilities manifests
- `npm test` — build then run the Vitest suite
- `npm run typecheck` / `npm run lint`
- Docs site (Astro/Starlight): the website build reads the generated schemas and the CLI/capabilities manifests that the root build writes to `dist/`, so build the root package first, then the site:
  1. `npm ci && npm run build`
  2. `cd website && npm ci && npm run build`

  Run `npm run dev` in `website/` for a local preview.

## Testing an unpublished build in another project

Run `node scripts/pack-install.mjs pack` from this checkout, then run the printed
`node scripts/pack-install.mjs install <project-dir> --manifest <path>` command
from this checkout, with `<project-dir>` pointing to the downstream project.
By default, packs live under `~/.cache/ambercast-pack`.
Old commit keys are never deleted automatically; remove them manually when no
longer needed. The pack command refuses changes in shipped files unless you pass
`--allow-dirty`. It rebuilds this repository's `dist/`, so never run pack
concurrently with `npm test` or another pack run.

Each `manifest.json` records `schemaVersion` (manifest format), `name` and
`version` (packed package identity), `sha` (checkout commit), `dirty` and
`dirtyPaths` (whether shipped inputs changed and which paths), `tarball`
(absolute local archive path), and `integrity` (archive content hash). Install
checks the archive and installed package against this manifest. It changes the
target project's `package.json` and lockfile, including on failure; do not
commit those changes.

Use this flow to try an unpublished upstream build in the dogfood downstream project. Do not commit a development build's generated `plan` or `grounding` there. For a release, follow the Release checklist below; before merging the release PR, also follow the compatibility-table/glossary/spec-overview update procedure in AGENTS.md's Branching & releases section.

## Release checklist

The middle verification layer, a pinned Memos instance driven by `npm run verify:memos`, is the pre-release check. Dogfooding in a downstream product (the upper layer) is optional and never blocks a release.

1. Before merging the release PR, check out the release PR head and run `npm run verify:memos` and then `npm run verify:memos -- --heal-check`. Both need Docker and a local Chromium; `--heal-check` also calls Claude through the local Claude Code CLI. Each run must end with a `PASS` line. Paste both final lines, including `sha=`, into the release PR.
2. If either run fails, do not merge the release PR. Fix the cause through the normal issue flow first.
3. After npm publication, run `npm run verify:memos -- --published <version>` against the published package and confirm it ends with `PASS`.

`--case <id>` (repeatable) replays only the named cases, still with zero AI calls, and a selection narrower than the default makes the final line start with `PASS-PARTIAL` and carry `cases=<id>,<id>` (naming every case still selects the default set and keeps the plain `PASS` line). A `PASS-PARTIAL` line is not a whole-set pass. A trailing `known=<id>#<n>` lists a case that is left out because a product bug (issue `#<n>`) stops its fixture from being generated; it is never verified, and the release PR must name it with its issue.

The middle-layer scenario fixture is generated in #624. Until the plan and grounding of every unmarked case are committed, `HEAL_STEP_ID` is set, and both the plain run and `--heal-check` pass, run the one-case smoke in place of steps 1 and 3: `npm run verify:memos -- --case memos-sign-in-create-memo` before merging, and `npm run verify:memos -- --published <version> --case memos-sign-in-create-memo` after publication. Paste each `PASS-PARTIAL` line into the release PR and list the case ids that were not run. This is an interim smoke, not a complete pre-release verification. If the smoke fails, do not merge the release PR, as in step 2. Do not run `--heal-check` until the whole fixture is committed: its heal case has no fixture yet and the settings-entry step id is unset.

If `npm run verify:memos` reports stale plans, regenerate the fixture with `npm run verify:memos -- --regenerate` in a normal issue PR before the release. It calls a real AI provider and may ask for secret consent, so run it locally. Before resolve, regeneration checks the plan's `confirms` without calling the AI and stops if an action has no confirming assertion.

## How to contribute

1. **Open an issue first** describing the problem or proposal.
2. Fork and branch. Branch names are free-form for external contributors
   (the `issues/<N>` convention is maintainer automation, not a requirement).
3. Open a pull request. **The PR title must be a Conventional Commit**
   (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, optional scope,
   `!` for breaking changes). This repository squash-merges with the PR title
   as the commit subject, and releases are derived from those subjects by
   release-please — a malformed title breaks versioning, so CI enforces it.
4. All review conversations must be resolved before merge; CodeRabbit reviews
   every PR automatically.
5. If your change fixes a `generate` or `heal` defect that a real provider
   response triggered, add that response to the provider-output corpus as
   described in `AGENTS.md` (Testing conventions).

## About AGENTS.md and .claude/

`AGENTS.md` and the `.claude/` directory describe the maintainer's AI-agent
automation (a 17-step implement flow with local hooks). They are **not** a
prerequisite for external contributions — the checks that matter for your PR
run in CI.

## Security

Report vulnerabilities privately via GitHub Security Advisories rather than
public issues — see [SECURITY.md](SECURITY.md) for the submission link and
what to include.
