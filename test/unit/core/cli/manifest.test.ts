import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLI_MANIFEST,
  createCliManifest,
  flagLookup,
  renderUsage,
} from '../../../../src/core/cli/manifest.js';
import type {
  CliManifest,
  VersionlessCliManifest,
} from '../../../../src/core/cli/manifest.js';

const fixtureDirectory = new URL('../../../fixtures/', import.meta.url);
// SPEC-9 removes target selection from replay commands; the v3 fixture stays frozen.
const expectedUsage = readFileSync(new URL('cli-usage.txt', fixtureDirectory), 'utf8')
  .replace('  --grep <pattern>  --target <name>  --headed', '  --grep <pattern>  --headed')
  .replace('Check options:\n  --target <name>  --allow-empty', 'Check options:\n  --allow-empty')
  .replace('  --dry-run  --yes, -y  --target <name>  --ai', '  --dry-run  --yes, -y  --ai');
const fixtureManifest = JSON.parse(readFileSync(new URL('cli-manifest.json', fixtureDirectory), 'utf8')) as CliManifest;
const fixtureUsageManifest: VersionlessCliManifest = {
  // SPEC-9: retain the v3 captured fixture while projecting removed replay flags.
  commands: fixtureManifest.commands.map((command) => ['run', 'check', 'heal'].includes(command.name)
    ? { ...command, flags: command.flags.filter((flag) => flag.name !== 'target') }
    : command),
  helpFooter: fixtureManifest.helpFooter,
};

describe('CLI manifest', () => {
  it('composes sentinel versions without changing the static declaration', () => {
    const before = structuredClone(CLI_MANIFEST);
    const first = createCliManifest('9.9.9-test');
    const second = createCliManifest('8.8.8-test');

    expect(first.version).toBe('9.9.9-test');
    expect(first.commands).toStrictEqual(CLI_MANIFEST.commands);
    expect(first.helpFooter).toStrictEqual(CLI_MANIFEST.helpFooter);
    expect(second.version).toBe('8.8.8-test');
    expect(second.commands).toStrictEqual(CLI_MANIFEST.commands);
    expect(second.helpFooter).toStrictEqual(CLI_MANIFEST.helpFooter);
    expect(CLI_MANIFEST).toStrictEqual(before);
  });

  it('renders the declared manifest byte-for-byte as the captured usage contract', () => {
    expect(renderUsage(CLI_MANIFEST)).toBe(expectedUsage);
  });

  it('renders the independently parsed golden declaration byte-for-byte as the captured usage contract', () => {
    expect(renderUsage(fixtureUsageManifest)).toBe(expectedUsage);
  });

  it('renders hidden, positional-free, empty, boolean, aliased, fallback-value, split, and aligned synthetic commands', () => {
    const widestCommandSyntax = 'longer [argument...]';
    const commandColumnWidth = widestCommandSyntax.length + 2;
    expect(commandColumnWidth).toBe(22);

    const manifest: VersionlessCliManifest = {
      commands: [
        {
          name: 'alpha',
          summary: 'No positional arguments',
          positional: null,
          flags: [],
        },
        {
          name: 'longer',
          summary: 'Has a longer positional syntax',
          positional: { name: 'argument', variadic: true, description: 'synthetic positional' },
          flags: [
            {
              name: 'hidden',
              alias: null,
              value: null,
              hidden: true,
              acceptedValues: null,
              shownValue: null,
              effect: 'hidden synthetic flag',
              default: null,
              lineBreakAfter: false,
            },
            {
              name: 'bool',
              alias: null,
              value: null,
              hidden: false,
              acceptedValues: null,
              shownValue: null,
              effect: 'boolean synthetic flag',
              default: null,
              lineBreakAfter: false,
            },
            {
              name: 'x',
              alias: 'y',
              value: null,
              hidden: false,
              acceptedValues: null,
              shownValue: null,
              effect: 'aliased synthetic flag',
              default: null,
              lineBreakAfter: false,
            },
            {
              name: 'shown',
              alias: null,
              value: '<value>',
              hidden: false,
              acceptedValues: null,
              shownValue: null,
              effect: 'fallback-value synthetic flag',
              default: null,
              lineBreakAfter: false,
            },
            {
              name: 'split',
              alias: null,
              value: '<split>',
              hidden: false,
              acceptedValues: null,
              shownValue: null,
              effect: 'split synthetic flag',
              default: null,
              lineBreakAfter: true,
            },
            {
              name: 'after',
              alias: null,
              value: null,
              hidden: false,
              acceptedValues: null,
              shownValue: null,
              effect: 'post-split synthetic flag',
              default: null,
              lineBreakAfter: false,
            },
          ],
        },
      ],
      helpFooter: 'Footer\n',
    };

    const rendered = renderUsage(manifest);

    expect(rendered).not.toContain('--hidden');
    expect(rendered).toBe(
      'Usage: ambercast <command> [options]\n\n'
      + 'Commands:\n'
      + '  alpha                 No positional arguments\n'
      + '  longer [argument...]  Has a longer positional syntax\n\n'
      + 'Alpha options:\n\n\n'
      + 'Longer options:\n'
      + '  --bool  --x, -y  --shown <value>  --split <split>\n'
      + '  --after\n\n'
      + 'Footer\n',
    );
  });

  it('records stale and AI value presentation and acceptance grammar from the golden manifest', () => {
    const run = fixtureUsageManifest.commands.find((command) => command.name === 'run');
    if (run === undefined) {
      throw new Error('The CLI manifest fixture must declare run.');
    }

    expect(run.flags.find((flag) => flag.name === 'stale')).toMatchObject({
      value: '<fail|regenerate>',
      shownValue: '<fail>',
      acceptedValues: ['fail', 'regenerate'],
    });
    expect(
      fixtureUsageManifest.commands.flatMap((command) => command.flags
        .filter((flag) => flag.name === 'ai')
        .map((flag) => ({
          command: command.name,
          value: flag.value,
          shownValue: flag.shownValue,
          acceptedValues: flag.acceptedValues,
        }))),
    ).toStrictEqual([
      { command: 'generate', value: '<claude|codex>', shownValue: null, acceptedValues: ['claude', 'codex'] },
      { command: 'run', value: '<claude|codex>', shownValue: null, acceptedValues: ['claude', 'codex'] },
      { command: 'heal', value: '<claude|codex>', shownValue: null, acceptedValues: ['claude', 'codex'] },
    ]);
  });

  it('keeps every finite value grammar synchronized with its accepted values', () => {
    for (const command of fixtureUsageManifest.commands) {
      for (const flag of command.flags) {
        if (flag.acceptedValues !== null) {
          expect(flag.value).toBe(`<${flag.acceptedValues.join('|')}>`);
        }
      }
    }
  });

  it('keeps every real manifest finite value grammar non-empty and synchronized with its accepted values', () => {
    for (const command of CLI_MANIFEST.commands) {
      for (const flag of command.flags) {
        if (flag.acceptedValues !== null) {
          expect(flag.acceptedValues.length).toBeGreaterThan(0);
          expect(flag.value).toBe(`<${flag.acceptedValues.join('|')}>`);
        }
      }
    }
  });

  it('declares init first with its complete fixed descriptor literal', () => {
    expect(CLI_MANIFEST.commands.map((command) => command.name)).toStrictEqual(['init', 'generate', 'run', 'check', 'heal', 'view', 'mcp']);
    expect(CLI_MANIFEST.commands[0]).toStrictEqual({
      name: 'init',
      summary: 'Scaffold config and a sample prompt',
      positional: null,
      flags: [
        { name: 'dir', alias: null, value: '<path>', hidden: false, acceptedValues: null, shownValue: null, effect: 'project root to scaffold into', default: 'cwd', lineBreakAfter: false },
        { name: 'yes', alias: 'y', value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'skip the confirmation prompt', default: 'false', lineBreakAfter: false },
        { name: 'force', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'replace an existing ambercast.config.json', default: 'false', lineBreakAfter: false },
        { name: 'no-color', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'disable ANSI', default: 'false', lineBreakAfter: false },
      ],
    });
  });

  it('declares the independently transcribed command-local flag and alias sets', () => {
    expect(CLI_MANIFEST.commands.map((command) => ({
      name: command.name,
      flags: command.flags.map((flag) => ({ name: flag.name, alias: flag.alias })),
    }))).toStrictEqual([
      {
        name: 'init',
        flags: [
          { name: 'dir', alias: null },
          { name: 'yes', alias: 'y' },
          { name: 'force', alias: null },
          { name: 'no-color', alias: null },
        ],
      },
      {
        name: 'generate',
        flags: [
          { name: 'strict', alias: null },
          { name: 'force', alias: null },
          { name: 'dry-run', alias: null },
          { name: 'target', alias: null },
          { name: 'ai', alias: null },
          { name: 'allow-empty', alias: null },
          { name: 'list', alias: null },
          { name: 'json', alias: null },
          { name: 'config', alias: null },
          { name: 'no-color', alias: null },
        ],
      },
      {
        name: 'run',
        flags: [
          { name: 'grep', alias: null },
          { name: 'headed', alias: null },
          { name: 'resolve', alias: null },
          { name: 'update-cache', alias: null },
          { name: 'allow-empty', alias: null },
          { name: 'list', alias: null },
          { name: 'stale', alias: null },
          { name: 'ai', alias: null },
          { name: 'json', alias: null },
          { name: 'no-color', alias: null },
        ],
      },
      {
        name: 'check',
        flags: [
          { name: 'allow-empty', alias: null },
          { name: 'list', alias: null },
          { name: 'json', alias: null },
          { name: 'config', alias: null },
          { name: 'no-color', alias: null },
        ],
      },
      {
        name: 'heal',
        flags: [
          { name: 'dry-run', alias: null },
          { name: 'yes', alias: 'y' },
          { name: 'ai', alias: null },
          { name: 'allow-empty', alias: null },
          { name: 'list', alias: null },
          { name: 'json', alias: null },
          { name: 'no-color', alias: null },
        ],
      },
      {
        name: 'view',
        flags: [
          { name: 'port', alias: null },
          { name: 'host', alias: null },
          { name: 'allow-headless', alias: null },
          { name: 'config', alias: null },
          { name: 'no-color', alias: null },
        ],
      },
      {
        name: 'mcp',
        flags: [
          { name: 'dir', alias: null },
          { name: 'sync-wait-ms', alias: null },
        ],
      },
    ]);
  });

  it('maps declared long names and aliases to their shared flag references only', () => {
    const heal = fixtureUsageManifest.commands.find((command) => command.name === 'heal');
    const generate = fixtureUsageManifest.commands.find((command) => command.name === 'generate');
    if (heal === undefined || generate === undefined) {
      throw new Error('The CLI manifest fixture must declare heal and generate.');
    }

    const healLookup = flagLookup(heal);
    const yes = heal.flags.find((flag) => flag.name === 'yes');
    expect(yes).toBeDefined();
    expect(healLookup.get('--yes')).toBe(yes);
    expect(healLookup.get('-y')).toBe(yes);

    const generateLookup = flagLookup(generate);
    expect([...generateLookup.keys()]).toStrictEqual(generate.flags.map((flag) => `--${flag.name}`));
    expect([...generateLookup.keys()].filter((key) => key.startsWith('-') && !key.startsWith('--'))).toStrictEqual([]);
  });
});
