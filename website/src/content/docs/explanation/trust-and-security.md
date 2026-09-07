---
title: Trust and security
description: Trust boundaries and fail-closed architectural choices across plan validation, page observations, evidence collection, and secret handling.
---

Ambercast defines explicit trust boundaries and fail-closed choices across plan validation, replay execution, page observations, and secret handling. During execution, run reads a plan only through its trusted instruction-covered-plan boundary before replay, establishing a strict separation between accepted execution inputs and unvalidated provider outputs.

## Artifacts and provider output are validated {#artifact-and-provider-boundaries}

Durable artifact validation and the provider-output acceptance boundary remain strictly separated. When executing a test, run reads a plan only through its trusted instruction-covered-plan boundary before replay.

Provider-generated steps are not trusted directly into persistent storage. When steps are produced, they are parsed against the local response contract, subjected to instruction-coverage checks, and then assembled into and parsed as a complete plan before persistence.

Links: [Plan document](/ambercast/spec/plan-document/), [Conformance](/ambercast/spec/conformance/), [Error codes](/ambercast/reference/error-codes/)

## Page observations are not instructions {#untrusted-page-data}

Content from a tested application cannot act as instructions for an agent. When ambercast captures structured accessibility evidence from a page, that evidence carries a fixed notice that page-derived content must not be interpreted as directives.

Public reporting contracts maintain this boundary at the interface level. The error design makes the report schema the external truth for `errors[].code`, keeping implementation-specific error classes out of the public contract.

Links: [Reports](/ambercast/reference/reports/), [Error codes](/ambercast/reference/error-codes/), [Reading structured output](/ambercast/agents/reading-structured-output/)

## Page evidence is redacted before it is reused {#page-evidence-boundary}

Live observations from a tested page do not become unrestricted provider inputs or durable evidence. Before data crosses into the AI adapter, AI-bound snapshots exclude screenshot bytes and redact resolved secret values from accessibility-tree strings and object keys.

When a step fails during live execution, failed-live-step evidence uses redacted accessibility data and treats uncertain secret presence as unsafe for screenshot capture.

Redaction covers resolved secrets and run-state values known to the replay, but it does not guarantee removal of arbitrary page-derived personal data from `actual` text, accessibility snapshots, screenshots, canvas, image, CSS-rendered pixels, or a scan-to-screenshot timing gap. Treat persisted reports and evidence as sensitive and restrict access and retention.

Links: [Secrets in plans](/ambercast/spec/secrets/), [Reports](/ambercast/reference/reports/)

## Secret sinks gate browser fills {#secret-sink-boundary}

Browser sink interactions apply origin-specific gating rather than relying on process environment boundaries. A `fill-secret` trace action applies its per-entry sink-origin gate before secret resolution and browser binding.

Links: [Manage secrets](/ambercast/how-to/manage-secrets/), [Configuration](/ambercast/reference/configuration/)

## Ambercast-managed secret namespaces stay out of provider children {#secret-boundary}

Configured AI providers run without access to ambercast-managed secret namespaces. When spawning child processes for a provider, provider child processes receive a copied environment that excludes `AMBERCAST_SECRET_*` and `AMBERCAST_ENV_*`, using case-insensitive matching.

The design assigns secret validation, generator policy, and report redaction distinct roles rather than trusting a schema alone to prove secrecy.

Links: [Manage secrets](/ambercast/how-to/manage-secrets/), [Environment variables](/ambercast/reference/environment-variables/), [Security policy](/ambercast/reference/security-policy/)
