import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readWorkflowText } from './workflow-text.js';

const dependabotYaml = readWorkflowText(fileURLToPath(new URL('../../../.github/dependabot.yml', import.meta.url)));

describe('dependabot.yml', () => {
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
