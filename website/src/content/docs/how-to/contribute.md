---
title: Contribute
description: Repository contribution recipe for submitting changes and reporting vulnerabilities.
---

This recipe guides you through contributing to the repository, centered on the `npm test`, `npm run typecheck`, and `npm run lint` scripts declared in the package.

## Prerequisites {#prerequisites}

The package declares `npm test`, `npm run typecheck`, and `npm run lint` scripts.

## Steps {#steps}

### External contributor path

1. Open an issue describing the problem or proposal, then fork and create a branch.
2. Run `npm test`, `npm run typecheck`, and `npm run lint`, then open a pull request with a Conventional Commit title and resolve its review conversations.
3. Report a vulnerability through GitHub Security Advisories rather than a public issue. Submit a private report with version, reproduction, and impact.

### Maintainer and agent workflow

- `AGENTS.md` and `.claude/` describe maintainer AI-agent automation and are not prerequisites for external contributors; external PR checks run in CI.
- A maintainer or repository agent follows the development workflow in `AGENTS.md`, including its behavior-change test order.

## Verification {#verification}

The three package commands exit `0`, or their failure is documented before handoff.

## Related {#related}

Links: [Security policy](/ambercast/reference/security-policy/), [Changelog](/ambercast/reference/changelog/).
