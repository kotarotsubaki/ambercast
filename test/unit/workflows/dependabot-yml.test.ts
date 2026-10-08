import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readWorkflowText } from './workflow-text.js';

const dependabotYaml = readWorkflowText(fileURLToPath(new URL('../../../.github/dependabot.yml', import.meta.url)));

describe('dependabot.yml', () => {
  it('keeps the ownership comment immediately above version 2', () => {
    const lines = dependabotYaml.split('\n');
    const versionIndex = lines.indexOf('version: 2');
    expect(versionIndex).toBeGreaterThanOrEqual(4);
    expect(lines.slice(versionIndex - 4, versionIndex)).toEqual([
      "# Dependabot owns PR metadata here: the labels:/assignees: below set this repo's",
      '# triage labels and assignee for every Dependabot PR (version and security',
      '# updates); pr-label.yml skips Dependabot and never sets them itself. Dependabot',
      '# may still add further labels of its own (e.g. semver-level) on top of these.',
    ]);
  });

  it('has exactly three updates entries with unique ecosystem and directory keys', () => {
    const lines = dependabotYaml.split('\n');
    const updates = lines.slice(lines.indexOf('updates:') + 1);
    const starts = updates.flatMap((line, index) => line.startsWith('  - package-ecosystem:') ? [index] : []);
    const keys = starts.map((start) => JSON.stringify([
      updates[start]!.slice('  - package-ecosystem: '.length),
      updates[start + 1]!.slice('    directory: '.length),
    ]));

    expect(starts).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    expect(new Set(keys)).toEqual(new Set([
      JSON.stringify(['github-actions', '/']),
      JSON.stringify(['npm', '/']),
      JSON.stringify(['npm', '/website']),
    ]));
  });

  it.each([
    { ecosystem: 'github-actions', directory: '/', ecosystemLabel: 'github_actions' },
    { ecosystem: 'npm', directory: '/', ecosystemLabel: 'javascript' },
    { ecosystem: 'npm', directory: '/website', ecosystemLabel: 'javascript' },
  ])('sets labels and assignee for $ecosystem in $directory', ({ ecosystem, directory, ecosystemLabel }) => {
    const lines = dependabotYaml.split('\n');
    const starts = lines.flatMap((line, index) =>
      line === `  - package-ecosystem: ${ecosystem}` && lines[index + 1] === `    directory: ${directory}` ? [index] : [],
    );
    expect(starts).toHaveLength(1);
    const start = starts[0]!;
    const nextEntry = lines.findIndex((line, index) => index > start && line.startsWith('  - package-ecosystem:'));
    const entry = lines.slice(start, nextEntry === -1 ? undefined : nextEntry);

    const section = (key: string) => {
      const index = entry.indexOf(`    ${key}:`);
      expect(entry.filter((line) => line === `    ${key}:`)).toHaveLength(1);
      if (index === -1) return [];
      let end = index + 1;
      while (end < entry.length && !/^ {4}\S/.test(entry[end]!)) end += 1;
      return entry.slice(index + 1, end);
    };

    const labels = section('labels');
    const labelValues = labels.map((line) => line.trim().replace(/^- /, '').replace(/^"(.*)"$/, '$1'));
    expect(new Set(labelValues)).toEqual(new Set(['dependencies', ecosystemLabel, 'type: chore', 'area: infra']));
    expect(labels).toContain('      - "type: chore"');
    expect(labels).toContain('      - "area: infra"');
    expect(section('assignees')).toEqual(['      - kotarotsubaki']);
  });

  it('adds typescript and tsdown to the root npm entry\'s ignore list, per SPEC-1/SPEC-4 (TEST-1)', () => {
    const lines = dependabotYaml.split('\n');
    const rootNpmEntries = lines.flatMap((line, index) =>
      line === '  - package-ecosystem: npm' && lines[index + 1] === '    directory: /' ? [index] : [],
    );
    expect(rootNpmEntries).toHaveLength(1);

    const start = rootNpmEntries[0]!;
    const nextEntry = lines.findIndex((line, index) => index > start && line.startsWith('  - package-ecosystem:'));
    const entry = lines.slice(start, nextEntry === -1 ? undefined : nextEntry);
    const ignoreBlock = [
      '    ignore:',
      '      # TypeScript 7.0 ships no JS compiler API, which typescript-eslint (peer <6.1.0),',
      '      # dependency-cruiser (<7) and tools/ scanners need. Revisit when 7.1 ships one (#516).',
      '      - dependency-name: "typescript"',
      '        versions: [">=6.1.0"]',
      '      # tsdown >=0.22 requires Node ^22.18, above the engines/CI floor of 22.14.',
      '      # Revisit when that floor reaches 22.18 (#516).',
      '      - dependency-name: "tsdown"',
      '        versions: [">=0.22.0"]',
    ];

    const ignoreIndex = entry.indexOf('    ignore:');
    expect(entry.filter((line) => line === '    ignore:')).toHaveLength(1);
    expect(ignoreIndex).toBeGreaterThan(entry.indexOf('    schedule:'));
    expect(ignoreIndex).toBeLessThan(entry.indexOf('    groups:'));

    let ignoreSectionEnd = ignoreIndex + 1;
    while (ignoreSectionEnd < entry.length && !/^ {4}\S/.test(entry[ignoreSectionEnd]!)) {
      ignoreSectionEnd += 1;
    }
    expect(entry.slice(ignoreIndex, ignoreSectionEnd)).toEqual(ignoreBlock);
  });
});
