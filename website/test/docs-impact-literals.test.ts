import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const canonical = readFileSync(join(repoRoot, '.claude/skills/implement/SKILL.md'), 'utf8');

// JS `String.split(sep, limit)` truncates the result array, unlike Python's
// `str.split(sep, maxsplit)`, which returns the remainder as the last element.
const stepLine = (text: string, anchor: string) => {
  const idx = text.indexOf(anchor);
  return anchor + text.slice(idx + anchor.length).split('\n', 1)[0];
};
const extractPath = (line: string) => [...line.matchAll(/node (scripts\/docs-impact\.mjs)/g)];

it.each(['3. **Plan**', '12. **Code review**'])('keeps the docs-impact path in %s valid', (anchor) => {
  const matches = extractPath(stepLine(canonical, anchor));
  expect(matches).toHaveLength(1);
  const path = join(repoRoot, 'website', matches[0][1]);
  expect(existsSync(path) && statSync(path).isFile()).toBe(true);
});
