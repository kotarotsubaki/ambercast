/**
 * Pins CONTRIBUTING.md's version, CLI-availability, verification-script,
 * docs-site build-order, and vulnerability-reporting facts (issue #299) so a
 * future edit cannot silently drift from them. The file is a fixed,
 * hand-authored artifact (not generated), so this test pins literal content
 * rather than parsing Markdown generically — mirroring the fence-aware
 * section-pinning approach already used for the skill contract in
 * `test/unit/skills/official-skill.test.ts`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CONTRIBUTING_PATH = new URL('../../../CONTRIBUTING.md', import.meta.url);

const HEADINGS = ['## Current state', '## Development', '## How to contribute', '## About AGENTS.md and .claude/', '## Security'];

/** One literal-substring list per heading in `HEADINGS`, checked against that heading's own section body only. */
const REQUIRED_SECTION_TEXT = [
  ['v0.3.1', 'The CLI (`generate`, `run`, `check`, `heal`) is functional'],
  ['npm test', 'npm run typecheck', 'npm run lint', 'the website build reads the generated schemas and the CLI/capabilities manifests that the root build writes to `dist/`'],
  [],
  [],
  ['GitHub Security Advisories', 'SECURITY.md'],
];

/**
 * Splits on top-level `## ` headings while ignoring lines that merely look
 * like a heading inside a fenced code block, so an embedded Markdown example
 * can never be mistaken for a real document section (same approach as
 * `official-skill.test.ts`'s `splitSections`, duplicated locally because it
 * is not exported production code — it exists only to validate this one
 * fixed artifact).
 */
function splitSections(body: string): Array<{ heading: string; lines: string[] }> {
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let inFence = false;

  for (const line of body.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    if (!inFence && line.startsWith('## ')) {
      sections.push({ heading: line, lines: [line] });
    } else {
      sections.at(-1)?.lines.push(line);
    }
  }

  return sections;
}

describe('CONTRIBUTING.md', () => {
  it('exists', () => {
    expect(existsSync(CONTRIBUTING_PATH)).toBe(true);
  });

  it('SPEC-F2 has no fenced code blocks, so heading detection needs no fence-awareness', () => {
    const text = readFileSync(CONTRIBUTING_PATH, 'utf8');
    expect(text).not.toContain('```');
  });

  it('SPEC-F2 keeps headings and required content within their own sections', () => {
    const text = readFileSync(CONTRIBUTING_PATH, 'utf8');
    const sections = splitSections(text);

    expect(sections.map(({ heading }) => heading)).toStrictEqual(HEADINGS);
    for (const [index, requiredText] of REQUIRED_SECTION_TEXT.entries()) {
      const section = sections[index]!.lines.join('\n');
      for (const text of requiredText) expect(section).toContain(text);
    }
  });

  it('SPEC-F2 documents the root-build-then-website-build order as the two inline-code commands, in order', () => {
    const text = readFileSync(CONTRIBUTING_PATH, 'utf8');
    const sections = splitSections(text);
    const development = sections[1]!.lines.join('\n');

    const commands = [...development.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const rootBuildIndex = commands.indexOf('npm ci && npm run build');
    const websiteBuildIndex = commands.indexOf('cd website && npm ci && npm run build');

    expect(rootBuildIndex).toBeGreaterThan(-1);
    expect(websiteBuildIndex).toBeGreaterThan(-1);
    expect(rootBuildIndex).toBeLessThan(websiteBuildIndex);
  });

  it('SPEC-F2 no longer states the pre-rewrite vague version phrasing', () => {
    const text = readFileSync(CONTRIBUTING_PATH, 'utf8');
    expect(text).not.toContain('0.x, pre-1.0');
  });
});
