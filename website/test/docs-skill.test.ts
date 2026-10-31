import { mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, lstatSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * TEST-19 checks the structural contract SPEC-17〜19 fix for the docs-writing skill: frontmatter
 * and section shape, the no-digit-duplication rule, the reference set and its cross-links, the
 * repo-local symlink, the AGENTS.md pointer, and a standalone regression guard for the
 * workflow-control-surface path list. It does not — and cannot, as a machine oracle — verify that
 * SKILL.md's prose is factually accurate; that is the step-12 code review's job, the same split
 * this spec's own contract-test coverage note already draws for SPEC-14's sample page.
 */

const skillDir = fileURLToPath(new URL('../../.agents/skills/docs-writing', import.meta.url));
const skillPath = join(skillDir, 'SKILL.md');
const referencesDir = join(skillDir, 'references');
const agentsPath = fileURLToPath(new URL('../../AGENTS.md', import.meta.url));
const symlinkPath = fileURLToPath(new URL('../../.claude/skills/docs-writing', import.meta.url));

const REQUIRED_HEADINGS = ['Workflow', 'Sentence rules', 'Tone (da-dearu)', 'Page skeletons and required anchors', 'Limits', 'Blocks', 'Diagrams', 'Terminology', 'Three-locale workflow', 'Moving details', 'Self-check'];
const repoFile = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

function section(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line === `## ${heading}`);
  expect(start, `Missing section: ${heading}`).toBeGreaterThanOrEqual(0);
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, next < 0 ? undefined : next).join('\n');
}

function tools(value: unknown): string[] {
  const entries = typeof value === 'string' ? value.split(',').map((entry) => entry.trim()) : value;
  expect(Array.isArray(entries)).toBe(true);
  expect((entries as unknown[]).every((entry) => typeof entry === 'string')).toBe(true);
  return [...new Set(entries as string[])].sort();
}

/** Splits a leading `---`-delimited frontmatter block from the rest of a Markdown file, matching
 * the same leading-block convention `scripts/lib/frontmatter.mjs` uses elsewhere in this
 * package — reused here directly rather than through that module, since its `parseFrontmatter`
 * requires a `title` field this skill's `name`/`description` frontmatter does not have. */
function splitFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) throw new Error('Missing leading frontmatter block');
  return { frontmatter: load(match[1]) as Record<string, unknown>, body: markdown.slice(match[0].length) };
}

/** Extracts level-2 headings in document order, skipping any line inside a fenced code block so
 * an example fence containing `## ` is never mistaken for a real section heading. */
function extractH2Headings(markdown: string): string[] {
  const headings: string[] = [];
  let openFence: { char: string; length: number } | null = null;
  for (const line of markdown.split('\n')) {
    // CommonMark fences tolerate at most three leading spaces; four or more is an indented code
    // block instead, so a fence marker must be anchored within that allowance, not after an
    // unconditional trim (which would misread an indented literal "```" as a real fence).
    const fenceMatch = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const [, , marker, rest] = fenceMatch;
      if (!openFence) {
        openFence = { char: marker[0], length: marker.length };
      } else if (marker[0] === openFence.char && marker.length >= openFence.length && rest.trim() === '') {
        openFence = null;
      }
      continue;
    }
    if (!openFence && line.startsWith('## ')) headings.push(line.slice(3).trim());
  }
  return headings;
}

/** A proxy for "this table has rows," not for "these rows are correct" -- content accuracy is a
 * step-12 code-review concern, not a machine oracle this test can provide. */
function countTableDataRows(markdown: string): number {
  const pipeRows = markdown.split('\n').filter((line) => line.trim().startsWith('|') && !/^\|[\s|:-]+\|$/.test(line.trim()));
  return Math.max(pipeRows.length - 1, 0);
}

const WORKFLOW_CONTROL_SURFACE = ['.claude/hooks/', '.claude/settings.json', '.claude/skills/implement/', '.claude/rules/implementation-flow.md', '.codex/', '.agents/skills/ambercast-implementation/', '.github/workflows/'];

/** A literal copy of `AGENTS.md`'s own workflow-control-surface path list (see its "Development
 * workflow (enforced)" section), not a value derived from that file. If a future PR adds an
 * eighth entry there, this list needs the same edit — the same obligation every acceptance-gate
 * `--allowed-paths` invocation in this repository already carries for its own explicit glob
 * list. */
function isWorkflowControlPath(path: string): boolean {
  return WORKFLOW_CONTROL_SURFACE.some((prefix) => path === prefix || path.startsWith(prefix));
}

function git(root: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}

function commitAll(root: string, message: string) {
  git(root, 'add', '-A');
  git(root, '-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', 'commit', '-m', message);
}

function changedPaths(root: string): string[] {
  return git(root, 'diff', '--name-only', 'HEAD~1', 'HEAD').trim().split('\n').filter(Boolean);
}

const tempRoots: string[] = [];
afterEach(() => tempRoots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function tempGitRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ambercast-docs-skill-test-'));
  tempRoots.push(root);
  writeFileSync(join(root, 'base.txt'), 'base');
  git(root, 'init');
  commitAll(root, 'base');
  return root;
}

describe('docs-writing skill frontmatter and section order', () => {
  it('declares name: docs-writing, a non-empty description, and the required sections in order', () => {
    const markdown = readFileSync(skillPath, 'utf8');
    const { frontmatter, body } = splitFrontmatter(markdown);
    expect(frontmatter.name).toBe('docs-writing');
    expect(typeof frontmatter.description).toBe('string');
    expect((frontmatter.description as string).length).toBeGreaterThan(0);
    expect(extractH2Headings(body)).toEqual(REQUIRED_HEADINGS);
  });

  it('does not count a `## ` line inside a fenced code block as a section heading', () => {
    const markdown = '---\nname: x\ndescription: y\n---\n\n## Sentence rules\n\n```md\n## Not a real heading\n```\n\n## Tone (da-dearu)\n';
    expect(extractH2Headings(splitFrontmatter(markdown).body)).toEqual(['Sentence rules', 'Tone (da-dearu)']);
  });

  it('requires a matching fence character and at least the opening length to close, not any fence line', () => {
    const markdown = '---\nname: x\ndescription: y\n---\n\n## Sentence rules\n\n````md\n```\n## Still fenced\n````\n\n## Tone (da-dearu)\n';
    expect(extractH2Headings(splitFrontmatter(markdown).body)).toEqual(['Sentence rules', 'Tone (da-dearu)']);
  });

  it('does not treat a four-space-indented ``` as a fence, per CommonMark\'s three-space allowance', () => {
    const markdown = '---\nname: x\ndescription: y\n---\n\n## Sentence rules\n\n    ```\n\n## Tone (da-dearu)\n';
    expect(extractH2Headings(splitFrontmatter(markdown).body)).toEqual(['Sentence rules', 'Tone (da-dearu)']);
  });
});

describe('docs-writing skill limits are referenced, never duplicated', () => {
  it('contains no ASCII digit in the body and points to prose-lint.json', () => {
    const { body } = splitFrontmatter(readFileSync(skillPath, 'utf8'));
    expect(body).not.toMatch(/[0-9]/);
    expect(body).toContain('prose-lint.json');
  });
});

describe('docs-writing skill reference set', () => {
  it('contains exactly blocks.mdx, the three style files, and workflow.md', () => {
    expect(readdirSync(referencesDir).sort()).toEqual(['blocks.mdx', 'style-en.md', 'style-ja.md', 'style-zh.md', 'workflow.md']);
  });

  it('style-ja.md attributes humanizer-ja and carries at least twenty table rows', () => {
    const content = readFileSync(join(referencesDir, 'style-ja.md'), 'utf8');
    expect(content).toContain('humanizer-ja');
    expect(countTableDataRows(content)).toBeGreaterThanOrEqual(20);
  });

  it('style-en.md names both Google and humanizer as sources', () => {
    const content = readFileSync(join(referencesDir, 'style-en.md'), 'utf8');
    expect(content).toContain('Google');
    expect(content).toContain('humanizer');
  });

  it('style-zh.md attributes a URL and its own license to each of the two source repositories', () => {
    const content = readFileSync(join(referencesDir, 'style-zh.md'), 'utf8');
    const paragraphFor = (marker: string) => content.split(/\n\s*\n/).find((block) => block.includes(marker));
    const ruanyf = paragraphFor('document-style-guide');
    const sparanoid = paragraphFor('chinese-copywriting-guidelines');
    expect(ruanyf).toBeDefined();
    expect(ruanyf).toContain('http');
    expect(ruanyf).toMatch(/public domain/i);
    expect(sparanoid).toBeDefined();
    expect(sparanoid).toContain('http');
    expect(sparanoid).toContain('MIT');
  });

  it('links to each reference file by name from SKILL.md', () => {
    const { body } = splitFrontmatter(readFileSync(skillPath, 'utf8'));
    expect(body).toContain('style-ja.md');
    expect(body).toContain('style-en.md');
    expect(body).toContain('style-zh.md');
    expect(body).toContain('workflow.md');
  });
});

function describesCiGate(text: string): boolean {
  return !text.includes('pending a separate workflow change') && text.split(/[.!?]+(?:\s+|$)|\n\s*\n/).some((sentence) =>
    /\bCI\s+`website`\s+job\s+runs\s+`npm run check:changed`/.test(sentence)
    && /\bpull requests?\b/i.test(sentence)
    && !/\b(?:not|never|will|pending|planned)\b|n['’]t\b/i.test(sentence));
}

describe('docs-writing workflow contracts', () => {
  it('documents CI running the changed-prose check', () => {
    const workflow = readFileSync(join(referencesDir, 'workflow.md'), 'utf8');
    expect(describesCiGate(workflow)).toBe(true);
  });

  it('rejects deleting only the pending CI sentence', () => {
    const fixture = 'Run it locally before finishing. Mechanical checks cannot judge meaning, facts, or reader usefulness; use the reviews above.';
    expect(describesCiGate(fixture)).toBe(false);
  });

  it.each([
    'The CI `website` job does not run `npm run check:changed` on pull requests.',
    'The CI `website` job will run `npm run check:changed` on pull requests.',
    'The CI `website` job never runs `npm run check:changed` on pull requests.',
    "The CI `website` job doesn't run `npm run check:changed` on pull requests.",
    'The CI `website` job runs `npm run check:changed` on pull requests as planned work.',
    'The CI `website` job runs `npm run check:changed` on pull requests, pending implementation.',
  ])('rejects a negated or planned CI statement: %s', (fixture) => {
    expect(describesCiGate(fixture)).toBe(false);
  });

  it('accepts a paragraph describing the CI website gate', () => {
    expect(describesCiGate('The CI `website` job runs `npm run check:changed` on every pull request against its base branch.')).toBe(true);
  });

  it('links the Workflow section to its procedure and names the blocking and report checks in Self-check', () => {
    const { body } = splitFrontmatter(readFileSync(skillPath, 'utf8'));
    expect(section(body, 'Workflow')).toMatch(/\[[^\]]+\]\(references\/workflow\.md\)/);
    const selfCheck = section(body, 'Self-check');
    for (const command of ['check:changed', '--page', '--report']) expect(selfCheck).toContain(command);
  });

  it('gives the workflow sections in order without restating numeric prose limits', () => {
    const workflow = readFileSync(join(referencesDir, 'workflow.md'), 'utf8');
    expect(extractH2Headings(workflow)).toEqual(['Brief', 'Drafting', 'Review and revision', 'Three locales', 'Light path', 'Generated pages', 'Check commands and exit codes']);
    for (const name of ['docs-fact-reviewer', 'docs-reader', 'npm run check:changed', '--page']) expect(workflow).toContain(name);
    expect(workflow).not.toMatch(/\b\d+(?:\.\d+)?\s+(?:words?|characters?|sentences?|headings?|callouts?)\b/i);
  });

  it('limits the entry rule to docs paths and a short six-bullet skill pointer', () => {
    const { frontmatter, body } = splitFrontmatter(readFileSync(repoFile('.claude/rules/docs-writing.md'), 'utf8'));
    expect(Object.keys(frontmatter)).toEqual(['paths']);
    expect(Array.isArray(frontmatter.paths)).toBe(true);
    expect([...new Set(frontmatter.paths as string[])].sort()).toEqual(['docs/spec/**/*.md', 'website/src/content/docs/**/*.md', 'website/src/content/docs/**/*.mdx']);
    for (const path of frontmatter.paths as string[]) expect(path).toMatch(/^(?:website\/src\/content\/docs\/|docs\/spec\/)/);
    expect(body).toContain('.agents/skills/docs-writing/SKILL.md');
    expect(body.split('\n').filter((line) => line.trim()).length).toBeLessThanOrEqual(15);
    expect(body.split('\n').filter((line) => /^[-*+] /.test(line))).toHaveLength(6);
    const scopeNote = body.split('\n').find((line) => /plans/i.test(line) && /PR bodies/i.test(line) && /code comments/i.test(line));
    expect(scopeNote).toBeDefined();
    expect(scopeNote).not.toMatch(/^\s*[-*+] /);
  });

  it.each([
    { name: 'docs-fact-reviewer', allowedKeys: ['description', 'name', 'tools'], allowedTools: ['Glob', 'Grep', 'Read'] },
    { name: 'docs-reader', allowedKeys: ['description', 'name', 'omitClaudeMd', 'tools'], allowedTools: ['Read'] },
  ])('keeps $name parseable and read-only with an explicit frontmatter allowlist', ({ name, allowedKeys, allowedTools }) => {
    const { frontmatter } = splitFrontmatter(readFileSync(repoFile(`.claude/agents/${name}.md`), 'utf8'));
    expect(Object.keys(frontmatter).sort()).toEqual(allowedKeys);
    expect(frontmatter.name).toBe(name);
    expect(typeof frontmatter.description).toBe('string');
    expect((frontmatter.description as string).trim().length).toBeGreaterThan(0);
    expect(tools(frontmatter.tools)).toEqual(allowedTools);
    for (const forbidden of ['model', 'effort', 'memory', 'skills', 'permissionMode', 'mcpServers', 'hooks', 'isolation', 'background']) expect(frontmatter).not.toHaveProperty(forbidden);
    for (const forbidden of ['Agent', 'Bash', 'Edit', 'Write']) expect(tools(frontmatter.tools)).not.toContain(forbidden);
    if (name === 'docs-reader') expect(frontmatter.omitClaudeMd).toBe(true);
  });

  it('requires evidence-bearing findings and explicitly marked unverifiable claims from the fact reviewer', () => {
    const { body } = splitFrontmatter(readFileSync(repoFile('.claude/agents/docs-fact-reviewer.md'), 'utf8'));
    for (const field of ['location', 'problem', 'evidence', 'direction']) expect(body).toMatch(new RegExp(`\\b${field}\\b`, 'i'));
    expect(body).toMatch(/unverifiable[^.!?\n]*(?:mark|label)|(?:mark|label)[^.!?\n]*unverifiable/i);
  });

  it('gives the reader a bundle and prohibits reporting unperformed commands or browser actions', () => {
    const { body } = splitFrontmatter(readFileSync(repoFile('.claude/agents/docs-reader.md'), 'utf8'));
    expect(body).toMatch(/\bbundle\b/i);
    const statement = body.split(/(?<=[.!?])\s+|\n/).find((sentence) => /never (claim|report)/i.test(sentence) && /command/i.test(sentence) && /browser/i.test(sentence));
    expect(statement).toBeDefined();
    expect(statement).toMatch(/(?:did not|not actually|have not|has not|unperformed|never performed)/i);
  });

  it.each([
    '.agents/skills/docs-writing/SKILL.md',
    '.agents/skills/docs-writing/references/workflow.md',
    '.claude/rules/docs-writing.md',
    '.claude/agents/docs-fact-reviewer.md',
    '.claude/agents/docs-reader.md',
    '.claude/CLAUDE.md',
  ])('keeps model and effort selection out of %s', (path) => {
    const markdown = readFileSync(repoFile(path), 'utf8');
    expect(markdown).not.toMatch(/^\s*(?:model|effort)\s*:/im);
    expect(markdown).not.toMatch(/\b(opus|sonnet|haiku|fable|gpt-\d)/i);
  });
});

describe('docs-writing skill symlink', () => {
  it('is a symlink pointing at the repository-local Agent Skill', () => {
    expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(symlinkPath)).toBe('../../.agents/skills/docs-writing');
  });
});

describe('AGENTS.md references the docs-writing skill', () => {
  it('ties documentation-site writing to the docs-writing skill inside the Conventions section', () => {
    const agents = readFileSync(agentsPath, 'utf8');
    // No `m` flag: with it, `$` in the lookahead would match before *any* newline (the blank
    // line separating the heading from its first bullet included), truncating the capture to
    // nothing. `(?:^|\n)` anchors the heading instead, so `$` here means true end-of-string.
    const match = /(?:^|\n)## Conventions\r?\n([\s\S]*?)(?=\n## |$)/.exec(agents);
    expect(match).not.toBeNull();
    const conventions = match![1];
    // A whole-section substring check for the skill's name alone would pass even if it appeared
    // in an unrelated mention or a negated sentence; this phrase is the actual directive this
    // layer's AGENTS.md edit adds, so matching it confirms the tie, not just the name.
    expect(conventions).toMatch(/documentation-site body (?:writing|content)[^.]*follows the `docs-writing` skill/i);
  });
});

describe('workflow-control-surface path classifier', () => {
  it('matches every entry AGENTS.md itself names as the workflow-control surface', () => {
    expect(isWorkflowControlPath('.claude/hooks/guard_git.py')).toBe(true);
    expect(isWorkflowControlPath('.claude/settings.json')).toBe(true);
    expect(isWorkflowControlPath('.claude/skills/implement/SKILL.md')).toBe(true);
    expect(isWorkflowControlPath('.claude/rules/implementation-flow.md')).toBe(true);
    expect(isWorkflowControlPath('.codex/config.toml')).toBe(true);
    expect(isWorkflowControlPath('.agents/skills/ambercast-implementation/SKILL.md')).toBe(true);
    expect(isWorkflowControlPath('.github/workflows/ci.yml')).toBe(true);
  });

  it('does not match this layer\'s own files, including the sibling docs-writing skill directory', () => {
    expect(isWorkflowControlPath('.agents/skills/docs-writing/SKILL.md')).toBe(false);
    expect(isWorkflowControlPath('.agents/skills/docs-writing/references/style-ja.md')).toBe(false);
    expect(isWorkflowControlPath('.claude/skills/docs-writing')).toBe(false);
    expect(isWorkflowControlPath('AGENTS.md')).toBe(false);
    expect(isWorkflowControlPath('website/test/docs-skill.test.ts')).toBe(false);
    for (const path of ['.claude/rules/docs-writing.md', '.claude/agents/docs-fact-reviewer.md', '.claude/agents/docs-reader.md', '.agents/skills/docs-writing/references/workflow.md', 'website/scripts/lib/changed-pages.mjs']) expect(isWorkflowControlPath(path)).toBe(false);
  });

  // This synthetic diff mirrors layer 3's own file set, not the real #500 layer-3 commit
  // range (not a stable oracle to assert against from an arbitrary checkout depth); it
  // exercises isWorkflowControlPath's classification only.
  it('classifies a synthetic diff shaped like this layer\'s own file set as touching no workflow-control-surface path', () => {
    const root = tempGitRoot();
    mkdirSync(join(root, '.agents/skills/docs-writing/references'), { recursive: true });
    mkdirSync(join(root, '.claude/skills'), { recursive: true });
    writeFileSync(join(root, '.agents/skills/docs-writing/SKILL.md'), '# skill');
    writeFileSync(join(root, '.agents/skills/docs-writing/references/style-ja.md'), '# ja');
    writeFileSync(join(root, '.agents/skills/docs-writing/references/style-en.md'), '# en');
    writeFileSync(join(root, '.agents/skills/docs-writing/references/style-zh.md'), '# zh');
    writeFileSync(join(root, '.claude/skills/docs-writing'), 'placeholder for a symlink path string');
    writeFileSync(join(root, 'AGENTS.md'), '# agents');
    writeFileSync(join(root, 'docs-skill.test.ts'), '// test');
    commitAll(root, 'layer 3');
    const changed = changedPaths(root);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.filter(isWorkflowControlPath)).toEqual([]);
  });

  it('flags a synthetic diff touching any workflow-control-surface path', () => {
    const root = tempGitRoot();
    const candidatePaths = ['.claude/hooks/guard_git.py', '.claude/settings.json', '.claude/skills/implement/SKILL.md', '.claude/rules/implementation-flow.md', '.codex/config.toml', '.agents/skills/ambercast-implementation/SKILL.md', '.github/workflows/ci.yml'];
    for (const path of candidatePaths) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(join(root, path), 'x');
    }
    commitAll(root, 'touch workflow-control surface');
    const changed = changedPaths(root);
    for (const path of candidatePaths) {
      expect(changed).toContain(path);
      expect(isWorkflowControlPath(path)).toBe(true);
    }
  });
});
