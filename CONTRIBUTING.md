# Contributing

Thanks for your interest in ambercast!

## Current state

ambercast is published on npm (v0.3.1, pre-1.0). The CLI (`generate`, `run`, `check`, `heal`) is functional, but breaking changes can still land in a minor release. Contributions to code, tests, docs (README in three locales, the docs site under `website/`), and toolchain are all welcome. Please open an issue before large changes.

## Development

Requires Node.js >= 22.14.

- `npm run build` — compile `src/` to `dist/` (tsdown) and regenerate the schemas and CLI/capabilities manifests
- `npm test` — build then run the Vitest suite
- `npm run typecheck` / `npm run lint`
- Docs site (Astro/Starlight): the website build reads the generated schemas and the CLI/capabilities manifests that the root build writes to `dist/`, so build the root package first, then the site:
  1. `npm ci && npm run build`
  2. `cd website && npm ci && npm run build`

  Run `npm run dev` in `website/` for a local preview.

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

## About AGENTS.md and .claude/

`AGENTS.md` and the `.claude/` directory describe the maintainer's AI-agent
automation (a 17-step implement flow with local hooks). They are **not** a
prerequisite for external contributions — the checks that matter for your PR
run in CI.

## Security

Report vulnerabilities privately via GitHub Security Advisories rather than
public issues — see [SECURITY.md](SECURITY.md) for the submission link and
what to include.
