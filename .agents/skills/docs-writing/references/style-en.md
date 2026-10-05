# English style reference

Two independent sources. Each is attributed with its own license directly below.

## Google developer documentation style — key recommendations

Source: Google developer documentation style guide, "Highlights" page, https://developers.google.com/style/highlights (CC BY 4.0, Google Developers Site Policies).

- Write in second person ("you"), not "we."
- Use active voice and make clear who performs the action.
- Use sentence case for headings and document titles, not title case.
- Use a numbered list for a sequence of steps and a bulleted list for most other lists.
- Write descriptive link text instead of "click here."
- Provide alt text for every image.
- Use standard American spelling and punctuation, and serial commas in a list.
- Put a condition before the instruction it governs, not after.

## blader/humanizer — review procedure for a final pass

Source: blader/humanizer, https://github.com/blader/humanizer (MIT license). This repository does not vendor that skill — install it separately with `npx skills add blader/humanizer` and run it as a final pass over drafted English prose. Installing and running it executes third-party code, so follow this repository's dependency-authorization rule (AGENTS.md's "Codex autonomous execution and approvals" section): get prior exact maintainer authorization naming the install command and its network/filesystem side effects before running it, unless it is already part of the trusted fixed dependency base. What follows describes how to run that pass, not a copy of the skill's own pattern catalog, since that catalog lives upstream and would go stale here independently of it.

- Mark the tells: read the whole draft once and mark every AI-sounding pattern it finds, strongest first, including patterns that repeat at paragraph scale (the same closing sentence after every section, three parallel examples in a row).
- Draft the rewrite: keep every supported claim while removing the marked patterns; never add a fact, name, number, date, quote, or citation that was not already in the source material.
- Check the draft: read it aloud and confirm no fact, name, number, date, quote, or claim was added or dropped in the process of removing the patterns.
- Write the final version: state each point naturally instead of patching flagged phrases one at a time, and vary sentence length so the result reads like a person wrote it.
