---
title: Changelog
description: User-visible product behavior and public-contract changes across ambercast releases, with breaking changes listed first.
---

This page lists product behavior and public-contract entries only. It leaves out repository architecture scanners, agent hooks, worktree lifecycle, lint configuration, CI, tests, the documentation site, and project workflow.

Releases 0.3.0 and 0.3.1 have no section because they have no product entries. Release 0.4.0 has no section because it made existing Plans stale through three producer-bundle revisions. Those revisions are `generatorSecretPolicy` 2 → 3 → 4 and `instructionCoveragePolicy` 1 → 2, so Plans from earlier releases are regenerated with `ambercast generate`. The repository's `CHANGELOG.md` also lists the other entries of those releases.

## Release 0.9.0 {#release-090}

Release date: 2026-10-08. Report schema 3.10.

| Class | User-visible entry |
| --- | --- |
| BREAKING | Report schema 3.10 adds the case-scoped error codes `CASE_ABORTED` (with `reason` and `stepId`) and `PROMPT_AMBIGUOUS` (with `ambiguities`). A `generate` or `heal` failure caused by an ambiguous prompt exits 2 with `PROMPT_AMBIGUOUS` instead of exiting 3 with a run-scoped `UNEXPECTED_CRASH`. Run rows that used to end without an error code carry `CASE_ABORTED`, `AGENTIC_STEP_FAILED`, or a case-scoped `UNEXPECTED_CRASH`. `heal` reports Stage 3 and final-replay failures as case errors, so the summary counts those rows as errored, and exit codes are unchanged. `ambercast view` shows error hints and details. |
| Feature | Every failure path yields a coded, diagnosable report error. |

Version 0.9.0 has one declared breaking change.

## Release 0.8.0 {#release-080}

Release date: 2026-10-06. Report schema 3.9.

| Class | User-visible entry |
| --- | --- |
| Feature | Report schema 3.9 adds `AGENTIC_STEP_FAILED` to case-scoped environment errors. It also adds the confirmation issue codes `confirms-unknown-step`, `confirms-not-earlier`, `confirms-not-action`, and `confirms-duplicate` to `AiResponseIssueCode`. |
| Fix | `generate` checks provider step IDs for secret literals before building diagnostics. |
| Fix | `generate` drops `confirms` references on `navigate` steps and reports violations by code. |
| Fix | `run` always reports `confirmed: true` for a binding from a confirmed grounding entry. |
| Fix | The runner classifies agentic step failures and polls AI-directed asserts until the deadline. |

Version 0.8.0 declares no breaking change.

## Release 0.7.0 {#release-070}

Release date: 2026-10-02. Report schema 3.8.

| Class | User-visible entry |
| --- | --- |
| BREAKING | Plan v3 → v4 adds required step Target names and removes Plan browser selection. Regenerate v3 Plans. |
| BREAKING | Plan v4 → v5 adds source-backed `intent` and `confirms` and Target-scoped `locale`. Grounding v2 → v3 replaces bare fingerprints with locator, fingerprint, intent digest, and provenance. Regenerate v4 Plans and their Grounding. |
| BREAKING | Target configuration moves from `targets.<name>.browser` to `targets.<name>.executor`, and the loader rejects the old key. The report gains `EXECUTOR_UNSUPPORTED` and `sessions[name].executor`. |
| BREAKING | The UI executor kind vocabulary is unified. An element step's grounding miss without `--resolve` reports `GROUNDING_UNRESOLVED` with exit 4 instead of exit 3 without a code. |
| Feature | Report schema moves to 3.8. Version 3.7 adds step Target names and per-Target sessions, and 3.8 adds heal Stage 1 `binding` diagnostics. |
| Feature | `ambercast init` scaffolds the configuration, a sample prompt, `.gitignore`, and `AGENTS.md`. |
| Feature | `ambercast view` is a read-only local viewer for `.runs` reports. |
| Feature | `targets.<name>.locale` sets the locale of browser contexts. |
| Feature | A UI executor abstraction adds capability preflight. |
| Feature | Heal Stage 1 rebinds element intents through `confirms`. |
| Feature | Element intent, quote matching, and intent digest primitives are added. |
| Feature | Plan IR v4 carries a per-step Target and one session per Target. |
| Feature | The MCP stdio server is added. |
| Feature | The MCP job model adds `ambercast_job_status` and `ambercast_job_cancel`. |
| Feature | The MCP heal apply takes two steps, with token issuance and elicitation. |
| Feature | Runtime event fan-out serves MCP, and heal preparation has two phases. |
| Fix | `init` adds a browser to the scaffolded configuration, plans BOM-safely, and aborts before applying on failure. |
| Fix | The MCP server emits `AMBERCAST_DEBUG` diagnostics for failed jobs and heal apply crashes. |
| Fix | The MCP server waits for heal apply confirmation and in-flight tool responses during shutdown. |
| Fix | The MCP server writes a stderr line when a progress notification fails to send. |
| Fix | Reports keep generation issue details in `AI_RESPONSE_INVALID`. |
| Fix | `run` recovers agentic target-resolution failures with diagnostics. |
| Fix | `run` takes the final poll sample at the deadline for assertions and binding. |
| Fix | `view` reads run reports from every 3.x schema version leniently. |
| Fix | `view` rejects default-port and non-authority `Host` headers and escapes `runId` in attributes. |
| Fix | `view` keeps screenshots and long text from overflowing the step table. |
| Fix | `view` applies the design system's dark tokens, status badges in the step table, and zero-omitted totals. |

Version 0.7.0 has four declared breaking changes.

## Release 0.6.0 {#release-060}

Release date: 2026-09-18. Report schema 3.6.

| Class | User-visible entry |
| --- | --- |
| BREAKING | Agentic MCP tool calls that fail schema validation no longer latch `INTEGRITY_VIOLATION` on the first mismatch. Up to 3 consecutive rejections per case return a structured result with the remaining budget. The 4th ends the case with `AI_RESPONSE_INVALID` (kind `environment`, exit 3) instead of `INTEGRITY_VIOLATION` (kind `usage`, exit 4). This change does not move the report schema version. |
| Feature | Report schema 3.6 adds the optional `repairTrace` diagnostic to completed heal results, and dry-run and apply produce the same result. |
| Feature | `run` waits for element presence before resolution. |

Version 0.6.0 has one declared breaking change.

## Release 0.5.0 {#release-050}

Release date: 2026-09-15. Report schema 3.5.

| Class | User-visible entry |
| --- | --- |
| BREAKING | Plan v2 → v3 removes secret-grant provenance. Remove legacy grant lines, regenerate with `generate --force`, and approve the candidate secret names through the consent/`secrets.allow` model. Plan v2 is not migrated in place. Report schema 3.5 adds the secret-policy error codes `SECRET_ENV_VAR_COLLISION`, `SECRET_CONSENT_REQUIRED`, and `SECRET_SYNTAX_REJECTED`, the optional `GROUNDING_UNRESOLVED` details, and the optional `GenerateResult` `secrets` and `warnings` fields. When a Stage 3 candidate changes the secret-name set, `heal` returns the `secret-set-rejected` result with `stage3Rejection.reason` `secret-set-changed`, plus the `added` and `removed` names. The legacy `@ambercast-secret` grant line and `{{secrets.*}}` prompt syntax are rejected with exit 2. |
| BREAKING | Existing Plans become stale and are regenerated with `ambercast generate --force`. Instruction-coverage criteria carry `startAnchor`, `startColumn`, `endAnchor`, and `endColumn`, and the `instructionCoveragePolicy` revision moves from 2 to 3. |
| BREAKING | `generate` stops at a consent gate for every newly detected secret name. An interactive terminal asks `y / N / i`, and any other run exits 2 and lists the unallowed names. Consenting appends the names to `secrets.allow`. |
| BREAKING | `run` resolves grounding misses with AI only with `--resolve`. `--cache-only` is removed and exits 2. `GROUNDING_UNRESOLVED` maps to exit 4. |
| Feature | `run` gains an agentic executor over an in-process MCP server. |
| Feature | Instruction coverage matches by anchor IDs. |
| Feature | Heal Stages 2 and 3 run under the allowlist model with secret-set invariance. |
| Feature | Secret naming is deterministic, and the allowlist is verified. |
| Fix | `generate` retries a provider response rejected for an embedded secret reference. |
| Fix | `BROWSER_LAUNCH_FAILED` is classified with a hint and details (report schema 3.4). |

Version 0.5.0 has four declared breaking changes.

## Release 0.2.0 {#release-020}

Release date: 2026-09-04.

| Class | User-visible entry |
| --- | --- |
| BREAKING | The provider request schema changed `producerBundleFingerprint` and therefore every prompt's `inputsDigest`; regenerate every 0.1.0 Plan. `check` reports the old Plan stale with exit 4, and `generate` or `--force` creates a fresh Plan. |
| Fix | Generation now accepts an empty `verificationIntent` in the provider response. |
| Fix | `generate --list` resolves no AI provider unless generation actually needs one. |
| Fix | Human report output sanitizes control sequences. |

Version 0.2.0 has one declared breaking change, placed before fixes.

## Release 0.1.0 {#release-010}

Release date: 2026-09-03.

| Class | User-visible entry |
| --- | --- |
| BREAKING | The v1 fingerprint preimage changed to include normalized parent and adjacent-sibling identities; old grounding mismatches, normal replay gets one AI fallback, and cache-only/CI replay aborts on a clean miss. |
| BREAKING | The TypeScript build baseline requires Node.js 22.14 or newer. |
| Feature | Browser capture gained a single accessibility capture and three-channel OR secret detection. |
| Feature | Real storage and system adapters became available. |
| Feature | Generate was wired to Claude Code CLI and Codex CLI adapters. |
| Feature | Configuration loading and packaged JSON Schema were implemented. |
| Feature | Canonical JSON serialization and digest computation were implemented. |
| Feature | Grounding became the sole trace authority. |
| Feature | Plan/Grounding Zod schemas and JSON Schema generation were implemented. |
| Feature | AI grounding trace was reshaped into events and a verification record. |
| Feature | The layout resolver and shared configuration vocabulary were added. |
| Feature | `inputsDigest` gained the Plan producer-bundle fingerprint. |
| Feature | Secret references gained explicit grant lines and verbatim citation verification. |
| Feature | Grounding repository/write-back policy was unified with missing-grounding detection. |
| Feature | Heal gained commit-preimage integrity and `runsDir` write containment. |
| Feature | Heal gained frontier single-step Stage 2 iteration. |
| Feature | The three-stage heal state machine was implemented. |
| Feature | Heal CLI confirmation and command wiring were implemented. |
| Feature | Heal gained a case-scoped admission budget for real AI dispatches. |
| Feature | Heal gained a read-once validated snapshot preimage. |
| Feature | Run and heal share one grounding-recovery table. |
| Feature | Heal Stage 2 provider context became structured and includes the current Plan. |
| Feature | Plan schema version 2 requires instruction coverage. |
| Feature | Storage writes gained an atomic-write contract. |
| Feature | Configuration gained `secretSinkOrigins` and the browser port gained dedicated `fillSecret`. |
| Feature | Browser element resolution moved to a `BoundElement` live handle and dropped `.first()`. |
| Feature | Structured reports gained schema 2.0 interruption and normalization behavior. |
| Feature | Heal reports gained the listed branch and `dryRun`. |
| Feature | Report finalization became one typed boundary. |
| Feature | Report schema 3.0 separated heal `repairOutcome` from `application`; declining a repair exits 1. |
| Feature | Report schema 3.1 adds optional per-code error `details` and makes `hint` available for every report error. |
| Feature | Run gained Chromium grounding-hit replay with zero AI calls. |
| Feature | Run gained grounding-miss recovery and trace replay. |
| Feature | Run implemented `--allow-empty` and `--list`, while `--stale=regenerate` remained intentionally unsupported. |
| Feature | Run persists failure evidence and its RunReport under `.runs`. |
| Feature | Target selection was unified across commands. |
| Feature | Check became a read-only Plan/Grounding freshness gate. |
| Fix | Codex CLI non-completion keeps a stderr excerpt. |
| Fix | Secret-sink origin is reverified immediately before browser fill. |
| Fix | `fillSecret` is pinned to one element handle. |
| Fix | Check uses inverse-then-judge artifact scanning and discovery-only `--list`. |
| Fix | Check and run share canonical grounding verification. |
| Fix | Child-process teardown waits for the real close event after spawn failure. |
| Fix | The v1 fingerprint implementation was corrected and AI-supplied fingerprints are verified during fallback. |
| Fix | Schema regex handling was hardened against dotAll loss and a `baseUrl` secret gap. |
| Fix | Fingerprint parsing became fail-closed and the accepted algorithm changed to `a11y-neighborhood-v2`. |
| Fix | Heal confines repairable-navigation classification to case-outcome errors. |
| Fix | Heal arbitration and propagation fail closed on integrity violations. |
| Fix | Heal latches dispatch-protocol violations on the phase token. |
| Fix | Heal Stage 2 retains secret-grant seeds with typed rejection. |
| Fix | Heal supervises real CLI child-process teardown with fail-closed cleanup. |
| Fix | Heal synchronizes AI-call emission with dispatch-budget admission. |
| Fix | Atomic-write contract coverage and documentation were hardened. |
| Fix | Run report identity paths became project-root-relative. |
| Fix | Credential-heuristic literal detection applies symmetrically to `fill.value`. |
| Fix | Replay rejects `blob:` navigation as a cross-origin bypass. |
| Fix | Grounding-fallback AI timeouts are composed and classified. |
| Fix | Provider availability probing receives a fresh abort timeout. |
| Fix | Run screenshots are project-root-relative and report persistence has three states. |
| Fix | Accessibility snapshots are redacted and screenshots are withheld at the AI boundary. |
| Fix | Secret and run values are redacted at the report boundary. |
| Fix | Replay rejects cross-origin navigation. |
| Fix | Embedded secret references are rejected and grounding is reverified before persistence. |
| Fix | Resolved-secret scanning became iterative and fail-closed for traces. |
| Fix | Run enforces strict one-to-one secret-grant consumption and regenerates attribution-unsound fresh Plans. |
| Fix | AI CLI child environments are denied and unresponsive children are reaped on abort. |
| Fix | Generated and replayed secret references absent from the prompt are rejected. |
| Fix | Exit aggregation uses `2 > 3 > 4 > 1 > 5 > 0`. |
| Fix | Generate wires its event sink, strips `$schema` from Claude CLI requests, and fixes run step-start timing. |


## See also {#see-also}

- [Compatibility table](/ambercast/reference/compatibility/#compatibility-table)
- [Regeneration boundary](/ambercast/reference/compatibility/#regeneration-boundary)
- [Upgrade between versions](/ambercast/how-to/upgrade/)
- [Specification changelog](/ambercast/spec/changelog/)
