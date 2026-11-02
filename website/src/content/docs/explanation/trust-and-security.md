---
title: Trust and security
description: ambercast trusts only what it has validated locally, and page content, provider output, and secret values each cross a boundary that fails closed.
---

ambercast trusts only what it has validated locally. Page content, provider output, and secret values each pass a check or a redaction at a boundary, and anything that fails stops there.

## Artifacts and provider output are validated {#artifact-and-provider-boundaries}

`run` reads a plan only after it passes plan validation, including instruction coverage.

Steps that a provider generates are not saved as they arrive. ambercast parses them against the local response contract and checks instruction coverage. It saves them only after they parse as a complete plan.

For secrets, proposing and authorizing are separate. The provider can only propose a secret name. ambercast resolves every committed secret reference locally. It saves a candidate only when the name is on the allowlist or you give consent interactively.

`secrets.allow: "*"` skips the per-name review. It is a deliberate high-risk setting, never an implicit default.

Related: [Plan document](/ambercast/spec/plan-document/), [Conformance](/ambercast/spec/conformance/), [Error codes](/ambercast/reference/error-codes/)

## Page content is not an instruction {#untrusted-page-data}

Content from the application under test cannot act as an instruction to an agent. When ambercast captures accessibility evidence from a page, the evidence carries a fixed notice. The notice says that page content is not an instruction.

The report schema is the public source of truth for `errors[].code`. Implementation-specific error classes stay out of the public contract.

Related: [Reports](/ambercast/reference/reports/), [Error codes](/ambercast/reference/error-codes/), [Reading structured output](/ambercast/agents/reading-structured-output/)

## Page evidence is redacted before reuse {#page-evidence-boundary}

What ambercast observes on a live page does not flow unfiltered into provider input or saved evidence. Snapshots sent to the AI exclude screenshot bytes. Resolved secret values are redacted from accessibility-tree strings and keys.

Evidence for a step that fails during a live run uses redacted accessibility data. When it is uncertain whether a secret is present, ambercast skips the screenshot.

Redaction covers the resolved secrets and run-state values that replay knows. It does not remove arbitrary personal data that comes from the page. That data can remain in `actual` text, snapshots, screenshots, canvas, images, and CSS-rendered pixels. A gap between the scan and the screenshot can also leave data behind. Treat persisted reports and evidence as sensitive, and limit who can access them and how long you keep them.

Related: [Secrets in plans](/ambercast/spec/secrets/), [Reports](/ambercast/reference/reports/)

## Secret sinks are checked before a fill {#secret-sink-boundary}

Browser writes do not rely on the process environment as a boundary. ambercast checks the sink origin of each entry. A `fill-secret` trace action performs that check before it resolves the secret and binds the browser.

Related: [Manage secrets](/ambercast/how-to/manage-secrets/), [Configuration](/ambercast/reference/configuration/)

## Secret namespaces stay out of provider processes {#secret-boundary}

Configured AI providers run without access to the secret namespaces that ambercast manages. A provider child process receives a copy of the environment without `AMBERCAST_SECRET_*` and `AMBERCAST_ENV_*`. The match is case-insensitive.

Secret validation, generator policy, and report redaction each have their own role. A schema alone cannot prove that a value stayed secret.

Secret values resolve only at runtime, from `AMBERCAST_SECRET_<NAME>`. Providers see names, never values. A descriptive name is still not harmless, so review each proposed name before you approve it.

Related: [Manage secrets](/ambercast/how-to/manage-secrets/), [Environment variables](/ambercast/reference/environment-variables/), [Security policy](/ambercast/reference/security-policy/)
