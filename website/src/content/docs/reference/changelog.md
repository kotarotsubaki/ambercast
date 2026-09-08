---
title: Changelog
description: User-visible product behavior and public-contract changes across ambercast releases, with breaking changes listed first.
---

This reference tracks user-visible product behavior and public-contract changes across ambercast releases, ordering breaking changes before fixes. Release 0.2.0 introduces one declared breaking change to the provider request schema that updates `producerBundleFingerprint` and each prompt's `inputsDigest`, alongside fixes for provider generation handling and report output.

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

This release section excludes changelog entries that only change repository architecture scanners, agent hooks, worktree lifecycle, lint configuration, or project workflow; it does not silently omit product behavior or public-contract entries.

## Related

Links:
- [Compatibility](/ambercast/reference/compatibility/#compatibility-table)
- [Compatibility](/ambercast/reference/compatibility/#regeneration-boundary)
- [Upgrade between versions](/ambercast/how-to/upgrade/)
- [Specification changelog](/ambercast/spec/changelog/)
