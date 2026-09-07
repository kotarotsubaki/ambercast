/**
 * Pins the distributable skill to the approved public contract. The test keeps
 * its small parsers local because they validate a fixed Markdown artifact,
 * rather than introducing production parsing behavior or a YAML dependency.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);
const skillPath = new URL('../../../skills/ambercast/SKILL.md', import.meta.url);
const skillText = readFileSync(skillPath, 'utf8');

const DESCRIPTION = 'Write and run ambercast prompt-only E2E tests for a web app. Author <name>.test.md prompts, drive generate / run / check / heal through the ambercast CLI, read the --json report and process exit code, and choose the next safe action. Use when the user asks for an E2E or browser test, mentions ambercast or a .test.md file, or wants an end-to-end check of a web app change.';
const COMPATIBILITY = 'Requires the ambercast CLI (npx ambercast), Node.js 22.14 or newer, a Chromium binary installed with playwright-core, and an authenticated claude or codex CLI for the AI calls.';
const HEADINGS = [
  '## When to use this skill',
  '## Project facts come from the project',
  '## Writing a prompt',
  '## The loop',
  '## Reading results',
  '## What to commit',
  '## Never do this',
  '## Learn more',
];
const URLS = [
  'https://kotarotsubaki.github.io/ambercast/guides/getting-started/',
  'https://kotarotsubaki.github.io/ambercast/guides/writing-prompts/',
  'https://kotarotsubaki.github.io/ambercast/guides/commands/',
  'https://kotarotsubaki.github.io/ambercast/guides/exit-codes/',
  'https://kotarotsubaki.github.io/ambercast/guides/artifacts/',
  'https://kotarotsubaki.github.io/ambercast/guides/secrets/',
  'https://kotarotsubaki.github.io/ambercast/guides/ci/',
  'https://kotarotsubaki.github.io/ambercast/reference/configuration/',
];
const REQUIRED_SECTION_TEXT = [
  ['Node.js', '22.14', 'npx playwright-core install chromium', 'claude', 'codex', 'http://localhost:3000', 'ambercast.config.json'],
  ['ambercast.config.json', 'testDir', 'tests/ambercast', 'runsDir', 'baseUrl', 'defaultTarget', '--target', 'npx ambercast generate --list --json', 'AMBERCAST_SECRET_'],
  ['.test.md', '{{secrets.', '@ambercast-secret', 'AMBERCAST_SECRET_', '### Good example', '### Bad example'],
  ['npx ambercast generate', 'npx ambercast run --json', 'npx ambercast check', 'npx ambercast heal --dry-run', '--cache-only', '--update-cache', 'grounding.localWriteBack', '--yes'],
  ['2 > 3 > 4 > 1 > 5 > 0', 'summary', 'results[]', 'errors[].code', '--strict', 'testIgnore', 'stderr'],
  ['.ambercast.plan.json', '.ambercast.grounding.json', 'grounding.repositoryPolicy', 'runsDir', 'tests/ambercast/.runs'],
  ['ci.heal', '--cache-only', '--force', '--yes', 'secret'],
  URLS,
];

/**
 * Preserves frontmatter declaration order because object equality cannot prove
 * that a publisher kept an externally specified order. The parser reads only
 * the deliberately narrow plain-scalar grammar needed by this fixed artifact.
 */
function parseFrontmatter(file: string): { pairs: Array<[string, string]>; body: string } {
  const lines = file.split('\n');
  if (lines[0] !== '---') throw new Error('frontmatter must begin with ---');

  const closingIndex = lines.indexOf('---', 1);
  if (closingIndex === -1) throw new Error('frontmatter must end with ---');

  const pairs: Array<[string, string]> = [];
  const keys = new Set<string>();
  for (const line of lines.slice(1, closingIndex)) {
    const delimiter = line.indexOf(': ');
    if (delimiter === -1) throw new Error(`invalid frontmatter line: ${line}`);

    const key = line.slice(0, delimiter).trim();
    const value = line.slice(delimiter + 2).trim();
    if (keys.has(key)) throw new Error(`duplicate frontmatter key: ${key}`);
    keys.add(key);
    pairs.push([key, value]);
  }

  return { pairs, body: lines.slice(closingIndex + 1).join('\n') };
}

/**
 * Uses one fence-aware scan for headings and section bounds so a Markdown
 * example cannot become a fictional document section.
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

/**
 * Rejects prefix matches such as `--json2`, while still accepting punctuation
 * after a real flag such as `--yes,`.
 */
function extractFlagTokens(text: string): string[] {
  return text.match(/(?<![\w-])--[a-z][a-z-]*(?![\w-])/g) ?? [];
}

describe('official ambercast skill', () => {
  it('SPEC-1 keeps the skill last in verify-pack required files', () => {
    const verifyPack = readFileSync(new URL('../../../scripts/verify-pack.mjs', import.meta.url), 'utf8');
    const literal = verifyPack.match(/const REQUIRED_FILES = \[([\s\S]*?)\];/);

    expect(literal).not.toBeNull();
    const entries = [...literal![1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(entries.at(-1)).toBe('skills/ambercast/SKILL.md');
    expect(existsSync(skillPath)).toBe(true);
  });

  it('SPEC-2 permits only the files-list change in package.json', () => {
    const packageBytes = readFileSync(new URL('../../../package.json', import.meta.url));
    const pkg = JSON.parse(packageBytes.toString('utf8'));

    expect(pkg.files).toStrictEqual(['bin', 'dist', 'skills']);
    expect(createHash('sha256').update(packageBytes).digest('hex')).toBe('683825bc5f8f6e8fa26131fa8f5b45f926e3e0aea24b2d97d14e5734f412e86d');
  });

  it('SPEC-3 keeps the skill directory intentionally small', () => {
    expect(readdirSync(new URL('../../../skills/ambercast/', import.meta.url)).sort()).toStrictEqual(['.claude-plugin', 'SKILL.md']);
  });

  it('SPEC-4 does not add an npm agents field', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

    expect(pkg.agents).toBeUndefined();
  });

  it('SPEC-5 preserves the exact ordered frontmatter contract', () => {
    const { pairs } = parseFrontmatter(skillText);
    const frontmatter = Object.fromEntries(pairs);

    expect(pairs.map(([key]) => key)).toStrictEqual(['name', 'description', 'license', 'compatibility']);
    expect(frontmatter.name).toBe('ambercast');
    expect(frontmatter.name).toBe(basename(dirname(skillPath.pathname)));
    expect(frontmatter.description).toBe(DESCRIPTION);
    expect(frontmatter.license).toBe('MIT');
    expect(frontmatter.compatibility).toBe(COMPATIBILITY);
    for (const [, value] of pairs) {
      expect(value).not.toContain(': ');
      expect(value).not.toContain('#');
    }
  });

  it('SPEC-6 limits the skill to portable text and a bounded body', () => {
    const { body } = parseFrontmatter(skillText);
    const bodyLines = body.split('\n');
    while (bodyLines.at(-1) === '') bodyLines.pop();

    expect(skillText).toMatch(/^[\t\n\x20-\x7E]*$/);
    expect(skillText).not.toContain('\r');
    expect(bodyLines.length).toBeLessThanOrEqual(250);
  });

  it('SPEC-7 excludes paths, credential-shaped values, and the forbidden project name', () => {
    expect(skillText).not.toMatch(/\/Users\/|\/home\/|[A-Za-z]:\\|sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|AKIA[A-Z0-9]{8,}|astamup/i);
  });

  it('SPEC-8 keeps headings and required content within fence-aware sections', () => {
    const { body } = parseFrontmatter(skillText);
    const sections = splitSections(body);

    expect(sections.map(({ heading }) => heading)).toStrictEqual(HEADINGS);
    for (const [index, requiredText] of REQUIRED_SECTION_TEXT.entries()) {
      const section = sections[index]!.lines.join('\n');
      for (const text of requiredText) expect(section).toContain(text);
    }
    const writing = sections[2]!.lines;
    const subheadingIndexes = new Map<string, number[]>();
    let inFence = false;
    for (const [index, line] of writing.entries()) {
      if (line.startsWith('```')) inFence = !inFence;
      if (!inFence && (line === '### Good example' || line === '### Bad example')) {
        subheadingIndexes.set(line, [...(subheadingIndexes.get(line) ?? []), index]);
      }
    }
    for (const heading of ['### Good example', '### Bad example']) {
      const indexes = subheadingIndexes.get(heading) ?? [];
      expect(indexes).toHaveLength(1);
      const index = indexes[0]!;
      expect(writing[index + 1]).toBe('```markdown');
    }
  });

  it('SPEC-8 ignores apparent H2 headings inside fenced examples', () => {
    const sections = splitSections('## First\n```markdown\n## Example only\n```\n## Second');

    expect(sections.map(({ heading }) => heading)).toStrictEqual(['## First', '## Second']);
  });

  it('SPEC-8 preserves the approved draft byte-for-byte', () => {
    expect(createHash('sha256').update(readFileSync(skillPath)).digest('hex')).toBe('abdd7ba8d1cb65a60478e66ab8c27f1125ae7f4cd78851615fa8ad06fb2771ac');
  });

  it('SPEC-9 and SPEC-10 keep skill flags aligned with the CLI usage contract', () => {
    const main = readFileSync(new URL('../../../src/cli/main.ts', import.meta.url), 'utf8');
    const usage = main.match(/const USAGE = `([\s\S]*?)`;/)?.[1]?.replaceAll('\\n', '\n');

    expect(usage).toBeDefined();
    const sections = new Map([...usage!.matchAll(/^(Generate|Run|Check|Heal) options:\n([\s\S]*?)(?=\n\n|(?![\s\S]))/gm)]
      .map(([, command, options]) => [command!.toLowerCase(), new Set(extractFlagTokens(options!))]));
    expect(sections.get('run')).toContain('--ai');
    expect(usage!.match(/Run options:\n([^\n]+)\n([^\n]+)/)?.slice(1)).toStrictEqual([
      '  --grep <pattern>  --target <name>  --headed  --cache-only  --update-cache  --allow-empty  --list',
      '  --stale <fail>  --ai <claude|codex>  --json  --no-color',
    ]);

    const allAllowed = new Set([...sections.values()].flatMap((flags) => [...flags]));
    for (const match of skillText.matchAll(/npx ambercast (generate|run|check|heal)[^\n`]*/g)) {
      for (const flag of extractFlagTokens(match[0]!)) expect(sections.get(match[1]!)!).toContain(flag);
    }
    for (const flag of extractFlagTokens(skillText)) expect(allAllowed).toContain(flag);
    for (const flag of skillText.match(/(?<![\w-])-[a-zA-Z](?![\w-])/g) ?? []) expect(flag).toBe('-y');
    for (const match of parseFrontmatter(skillText).body.matchAll(/\bambercast ([a-z][a-z-]*)\b/g)) {
      expect(['generate', 'run', 'check', 'heal']).toContain(match[1]);
    }
  });

  it('SPEC-11 keeps documented exit codes within the CLI range', () => {
    const exitCodes = [...skillText.matchAll(/\bexit(?: code)? (\d+)/gi)].map((match) => Number(match[1]));

    for (const exitCode of exitCodes) expect(exitCode).toBeGreaterThanOrEqual(0);
    for (const exitCode of exitCodes) expect(exitCode).toBeLessThanOrEqual(5);
    expect(skillText).toContain('2 > 3 > 4 > 1 > 5 > 0');
  });

  it('SPEC-12 links to the seven unblocked documentation pages', () => {
    const urls = skillText.match(/https:\/\/kotarotsubaki\.github\.io\/ambercast\/[a-z0-9\/-]+\//g) ?? [];

    expect(urls).toStrictEqual(URLS);
    for (const url of urls.slice(0, -1)) {
      const path = new URL(url).pathname.replace(/^\/ambercast\//, '').replace(/\/$/, '');
      expect(existsSync(new URL(`../../../website/src/content/docs/${path}.md`, import.meta.url))).toBe(true);
    }
  });

  // See #292.
  it.skip('SPEC-12 links to the blocked configuration reference page', () => {
    const url = URLS.at(-1)!;
    const path = new URL(url).pathname.replace(/^\/ambercast\//, '').replace(/\/$/, '');

    expect(existsSync(new URL(`../../../website/src/content/docs/${path}.md`, import.meta.url))).toBe(true);
  });

  it('SPEC-13 gives every README one adjacent, four-row official-skill section', () => {
    const readmes = [
      ['README.md', '## Official skill', '## Learn more', '## Status'],
      ['README-ja.md', '## 公式スキル', '## もっと知る', '## ステータスと制限事項'],
      ['README-zh-CN.md', '## 官方技能', '## 了解更多', '## 状态与限制'],
    ] as const;
    const commands = [
      '/plugin marketplace add kotarotsubaki/ambercast',
      '/plugin install ambercast@ambercast',
      '$skill-installer install https://github.com/kotarotsubaki/ambercast/tree/main/skills/ambercast',
      'gh skill install kotarotsubaki/ambercast ambercast --agent <agent>',
      'npx skills add kotarotsubaki/ambercast --skill ambercast -y',
      'mkdir -p .claude/skills && cp -R node_modules/ambercast/skills/ambercast .claude/skills/ambercast',
    ];
    const commandCells: string[][] = [];
    const bashBlocks: string[] = [];

    for (const [file, heading, learnMore, status] of readmes) {
      const text = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
      const headings = text.split('\n').filter((line) => line.startsWith('## '));
      const headingIndex = headings.indexOf(heading);
      const sectionStart = text.indexOf(`${heading}\n`);
      const sectionEnd = text.indexOf(`\n${status}\n`, sectionStart);
      const section = text.slice(sectionStart, sectionEnd);

      expect(headings[headings.indexOf(learnMore) + 1]).toBe(heading);
      expect(headings[headingIndex + 1]).toBe(status);
      expect(section.match(/^\|.*\|$/gm)?.slice(2)).toHaveLength(4);
      for (const command of commands) expect(section.split(command)).toHaveLength(2);
      const tableCommandIndices = commands.slice(0, -1).map((command) => section.indexOf(command));
      for (let index = 1; index < tableCommandIndices.length; index += 1) {
        expect(tableCommandIndices[index]).toBeGreaterThan(tableCommandIndices[index - 1]!);
      }
      expect(section.match(/```bash\n[\s\S]*?\n```/g)).toHaveLength(1);
      expect(section.match(/```bash\n([\s\S]*?)\n```/)![1]!.trim()).toBe(commands.at(-1));
      expect(section.indexOf('```bash')).toBeGreaterThan(section.lastIndexOf('\n|'));
      commandCells.push(commands.map((command) => section.match(new RegExp(`\\\`${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\\``))?.[0] ?? command));
      bashBlocks.push(section.match(/```bash\n[\s\S]*?\n```/)![0]);
    }

    expect(commandCells[1]).toStrictEqual(commandCells[0]);
    expect(commandCells[2]).toStrictEqual(commandCells[0]);
    expect(bashBlocks[1]).toStrictEqual(bashBlocks[0]);
    expect(bashBlocks[2]).toStrictEqual(bashBlocks[0]);
  });

  it('SPEC-14 records the bundled skill in repository guidance', () => {
    const agents = readFileSync(new URL('../../../AGENTS.md', import.meta.url), 'utf8');
    const status = agents.slice(agents.indexOf('## Status'), agents.indexOf('## Repository layout'));
    const layout = agents.slice(agents.indexOf('## Repository layout'), agents.indexOf('## Core design decisions'));
    const commands = agents.slice(agents.indexOf('## Commands'));

    expect(status.split('\n')[2]).toBe("0.x (the exact version is package.json's). `generate`, `run`, `check`, and `heal` are implemented and exercised by the test suite. Chromium only, local execution only; the results viewer, `init`, and an MCP server are not implemented yet. The official agent skill is bundled at skills/ambercast/SKILL.md.");
    expect(layout).toContain('files: ["bin", "dist", "skills"]');
    expect(layout).toContain('- `src/` — TypeScript sources, compiled by `tsdown` to `dist/` (gitignored, built on demand)\n- `skills/` — the official Agent Skills bundle published with the package; see skills/ambercast/SKILL.md');
    expect(layout).toContain('- `.claude-plugin/marketplace.json` — Claude Code plugin marketplace that points at `skills/ambercast`');
    expect(commands).toContain('skills/ambercast/SKILL.md');
    expect(agents).not.toContain('files: ["bin", "dist"]');
  });

  it('SPEC-18 pins both plugin manifests and their skill root', () => {
    const description = 'Official ambercast skill: write prompt-only E2E tests and run the generate / run / check / heal loop';
    const marketplace = {
      name: 'ambercast',
      owner: { name: 'ambercast contributors', url: 'https://github.com/kotarotsubaki/ambercast' },
      plugins: [{ name: 'ambercast', source: './skills/ambercast', description }],
    };
    const plugin = {
      name: 'ambercast', description, author: { name: 'ambercast contributors' },
      repository: 'https://github.com/kotarotsubaki/ambercast', license: 'MIT',
    };

    expect(readFileSync(new URL('../../../.claude-plugin/marketplace.json', import.meta.url), 'utf8')).toBe(`${JSON.stringify(marketplace, null, 2)}\n`);
    expect(readFileSync(new URL('../../../skills/ambercast/.claude-plugin/plugin.json', import.meta.url), 'utf8')).toBe(`${JSON.stringify(plugin, null, 2)}\n`);
    expect(existsSync(resolve(ROOT.pathname, marketplace.plugins[0]!.source, 'SKILL.md'))).toBe(true);
  });
});
