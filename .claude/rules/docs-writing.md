---
paths:
  - "website/src/content/docs/**/*.md"
  - "website/src/content/docs/**/*.mdx"
  - "docs/spec/**/*.md"
---

# Documentation writing

- For documentation writing and revision, follow `.agents/skills/docs-writing/SKILL.md` and its `references/workflow.md`.
- Preserve facts, conditions, constraints, exceptions, defaults, and public APIs when changing style.
- Distinguish implemented behavior, plans, examples, recommendations, and requirements.
- Use fact review and a reader check according to the change, following the skill.
- Before finishing, check touched pages with `npm run check:changed` or `node scripts/check-prose.mjs --page <slug>` from `website/`.
- Check generated pages' sources; edit `docs/spec` for generated English spec pages, never generated output.

This rule does not apply to plans, PR bodies, or code comments.
