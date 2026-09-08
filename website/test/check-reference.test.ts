import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkReference } from '../scripts/check-reference.mjs';
import { createDocsFixture, runEntryPoint } from './cli-fixture.ts';

type Violation = { check: string, page: string, rule: string, expected: string, actual: string };
type FixtureOptions = {
  docs?: Record<string, string>;
  cliManifest?: object;
  configSchema?: object;
  defaults?: Record<string, unknown>;
  capabilities?: object;
  omit?: string[];
};

const fixtures: ReturnType<typeof createDocsFixture>[] = [];

afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.dispose()));

const cliManifest = {
  version: '0.3.1',
  commands: [
    { name: 'generate', positional: { name: 'files', variadic: true }, flags: [{ name: 'strict', alias: null }] },
    { name: 'run', positional: { name: 'files', variadic: true }, flags: [{ name: 'headed', alias: null }] },
    { name: 'check', positional: { name: 'files', variadic: true }, flags: [{ name: 'json', alias: null }] },
    { name: 'heal', positional: { name: 'files', variadic: true }, flags: [{ name: 'yes', alias: 'y' }] },
  ],
};

const configSchema = {
  type: 'object',
  properties: {
    testDir: { type: 'string' },
    defaultTarget: { type: 'string' },
    targets: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          baseUrl: { type: 'string' },
        },
      },
    },
  },
};

const defaults = {
  testDir: 'tests/ambercast',
  defaultTarget: 'web-user',
  'targets.web-user.baseUrl': 'http://localhost:3000',
};

const capabilities = {
  exitCodes: [0, 1],
  errorCodes: ['CONFIG_INVALID', 'FS_IO_ERROR'],
};

const flagTable = (rows: string[], anchored = true, prose = '') => [
  `## Flags${anchored ? ' {#flags}' : ''}`,
  '',
  prose,
  prose ? '' : undefined,
  '| flag | value | effect | default |',
  '| --- | --- | --- | --- |',
  '| files | path[] | literal paths | discovery |',
  ...rows,
].filter((line): line is string => line !== undefined).join('\n') + '\n';

const referenceDocs = {
  'reference/cli/generate.md': flagTable(['| --strict | boolean | strict mode | false |']),
  'reference/cli/run.md': flagTable(['| --headed | boolean | headed browser | false |']),
  'reference/cli/check.md': flagTable(['| --json | boolean | JSON output | false |']),
  'reference/cli/heal.md': flagTable(['| --yes, -y | boolean | authorize | false |']),
  'reference/cli/overview.md': [
    '## Command-flag matrix {#command-flag-matrix}',
    '',
    '| command | positional | accepted options | configuration path |',
    '| --- | --- | --- | --- |',
    '| generate | paths | strict | defaults |',
    '| run | paths | headed | defaults |',
    '| check | paths | json | defaults |',
    '| heal | paths | yes/-y | defaults |',
    '',
  ].join('\n'),
  'reference/configuration.md': [
    '## Key table {#key-table}',
    '',
    '| Key path | Type | Default |',
    '| --- | --- | --- |',
    '| `testDir` | string | tests/ambercast |',
    '| `targets.<name>.baseUrl` | string | http://localhost:3000 |',
    '| `defaultTarget` | string | web-user |',
    '',
  ].join('\n'),
  'reference/exit-codes.md': [
    '## Exit-code table {#exit-code-table}',
    '',
    '| code | meaning |',
    '| --- | --- |',
    '| 0 | success |',
    '| 1 | failure |',
    '',
  ].join('\n'),
  'reference/error-codes.md': [
    '## Code vocabulary {#code-vocabulary}',
    '',
    '| code | meaning |',
    '| --- | --- |',
    '| CONFIG_INVALID | invalid configuration |',
    '| FS_IO_ERROR | filesystem error |',
    '',
  ].join('\n'),
};

function createReferenceFixture(options: FixtureOptions = {}) {
  const docs = { ...referenceDocs, ...options.docs };
  const generated = {
    'website/public/manifest/cli.json': JSON.stringify(options.cliManifest ?? cliManifest),
    'website/public/schemas/config.schema.json': JSON.stringify(options.configSchema ?? configSchema),
    'website/public/capabilities.json': JSON.stringify(options.capabilities ?? capabilities),
    'dist/manifest/config-defaults.json': JSON.stringify(options.defaults ?? defaults),
  };
  for (const path of options.omit ?? []) delete generated[path as keyof typeof generated];
  const fixture = createDocsFixture({
    'website/.fixture': '',
    ...Object.fromEntries(Object.entries(docs).map(([path, markdown]) => [`website/src/content/docs/${path}`, markdown])),
    ...generated,
  });
  fixtures.push(fixture);
  return fixture;
}

function checkFixture(fixture: ReturnType<typeof createDocsFixture>) {
  return checkReference({
    docsRoot: join(fixture.website, 'src/content/docs'),
    publicRoot: join(fixture.website, 'public'),
    configDefaultsPath: join(fixture.root, 'dist/manifest/config-defaults.json'),
  }) as Promise<Violation[]>;
}

function replaceDoc(path: keyof typeof referenceDocs, search: string | RegExp, replacement: string) {
  return { [path]: referenceDocs[path].replace(search, replacement) };
}

function expectDifference(violations: Violation[], pageEnd: string, values: string[]) {
  const violation = violations.find((candidate) => candidate.page.endsWith(pageEnd));
  expect(violation).toEqual(expect.objectContaining({
    check: expect.any(String),
    page: expect.any(String),
    rule: expect.any(String),
    expected: expect.any(String),
    actual: expect.any(String),
  }));
  expect(violation?.expected).not.toBe(violation?.actual);
  const comparison = `${violation?.expected}\n${violation?.actual}`;
  for (const value of values) expect(comparison).toContain(value);
}

describe('checkReference', () => {
  it('returns no violations for a complete internally consistent reference fixture', async () => {
    expect(await checkFixture(createReferenceFixture())).toEqual([]);
  });

  it('finds a manifest flag missing from its command flag table', async () => {
    const violations = await checkFixture(createReferenceFixture({
      docs: replaceDoc('reference/cli/generate.md', '| --strict | boolean | strict mode | false |\n', ''),
    }));

    expectDifference(violations, 'reference/cli/generate', ['strict']);
  });

  it('finds a command flag table identifier absent from the manifest', async () => {
    const violations = await checkFixture(createReferenceFixture({
      docs: replaceDoc('reference/cli/generate.md', '| --strict | boolean | strict mode | false |', '| --invented | boolean | invented | false |'),
    }));

    expectDifference(violations, 'reference/cli/generate', ['invented', 'strict']);
  });

  it('finds a flag missing from a command-flag matrix row', async () => {
    const violations = await checkFixture(createReferenceFixture({
      docs: replaceDoc('reference/cli/overview.md', '| generate | paths | strict | defaults |', '| generate | paths |  | defaults |'),
    }));

    expectDifference(violations, 'reference/cli/overview', ['strict']);
  });

  it('finds an extra flag in a command-flag matrix row', async () => {
    const violations = await checkFixture(createReferenceFixture({
      docs: replaceDoc('reference/cli/overview.md', '| generate | paths | strict | defaults |', '| generate | paths | strict, invented | defaults |'),
    }));

    expectDifference(violations, 'reference/cli/overview', ['strict', 'invented']);
  });

  it('finds a schema configuration key missing from the key table', async () => {
    const violations = await checkFixture(createReferenceFixture({
      docs: replaceDoc('reference/configuration.md', '| `defaultTarget` | string | web-user |\n', ''),
    }));

    expectDifference(violations, 'reference/configuration', ['defaultTarget']);
  });

  it('finds a documented configuration key absent from the schema', async () => {
    const violations = await checkFixture(createReferenceFixture({
      docs: replaceDoc('reference/configuration.md', '| `defaultTarget` | string | web-user |', '| `defaultTarget` | string | web-user |\n| `ghost` | string | absent |'),
    }));

    expectDifference(violations, 'reference/configuration', ['ghost']);
  });

  it('finds a wrong documented configuration default', async () => {
    const violations = await checkFixture(createReferenceFixture({
      docs: replaceDoc('reference/configuration.md', '| `testDir` | string | tests/ambercast |', '| `testDir` | string | wrong-directory |'),
    }));

    expectDifference(violations, 'reference/configuration', ['testDir', 'wrong-directory', 'tests/ambercast']);
  });

  it('resolves targets.<name> defaults through the generated web-user default target', async () => {
    expect(await checkFixture(createReferenceFixture())).toEqual([]);
  });

  it('resolves targets.<name> defaults through a different generated default target', async () => {
    const alternateDefaults = {
      ...defaults,
      defaultTarget: 'alternate',
      'targets.alternate.baseUrl': 'https://alternate.test',
    };
    delete alternateDefaults['targets.web-user.baseUrl'];

    const documentation = referenceDocs['reference/configuration.md']
      .replace('http://localhost:3000', 'https://alternate.test')
      .replace('| `defaultTarget` | string | web-user |', '| `defaultTarget` | string | alternate |');

    expect(await checkFixture(createReferenceFixture({
      defaults: alternateDefaults,
      docs: { 'reference/configuration.md': documentation },
    }))).toEqual([]);
  });

  it('finds a wrong target-scoped configuration default', async () => {
    const violations = await checkFixture(createReferenceFixture({
      docs: replaceDoc('reference/configuration.md', 'http://localhost:3000', 'http://wrong.test'),
    }));

    expectDifference(violations, 'reference/configuration', ['targets.web-user.baseUrl', 'http://wrong.test', 'http://localhost:3000']);
  });

  it('finds an absent-default assertion contradicted by the defaults artifact', async () => {
    const extendedSchema = {
      ...configSchema,
      properties: { ...configSchema.properties, newlyDefaulted: { type: 'string' } },
    };
    const violations = await checkFixture(createReferenceFixture({
      configSchema: extendedSchema,
      defaults: { ...defaults, newlyDefaulted: 'surprise' },
      docs: replaceDoc('reference/configuration.md', '| `defaultTarget` | string | web-user |', '| `defaultTarget` | string | web-user |\n| `newlyDefaulted` | string | absent |'),
    }));

    expectDifference(violations, 'reference/configuration', ['newlyDefaulted', 'absent', 'surprise']);
  });

  it('finds a wrong exit-code vocabulary', async () => {
    const violations = await checkFixture(createReferenceFixture({
      docs: replaceDoc('reference/exit-codes.md', '| 1 | failure |', '| 7 | failure |'),
    }));

    expectDifference(violations, 'reference/exit-codes', ['1', '7']);
  });

  it('finds a wrong error-code vocabulary', async () => {
    const violations = await checkFixture(createReferenceFixture({
      docs: replaceDoc('reference/error-codes.md', '| FS_IO_ERROR | filesystem error |', '| OTHER_ERROR | filesystem error |'),
    }));

    expectDifference(violations, 'reference/error-codes', ['FS_IO_ERROR', 'OTHER_ERROR']);
  });

  it('treats --yes, -y and yes/-y as the same canonical manifest flag', async () => {
    expect(await checkFixture(createReferenceFixture())).toEqual([]);
  });

  it('reports an anchored-table failure when the H2 text is present but its explicit anchor is absent', async () => {
    const violations = await checkFixture(createReferenceFixture({
      docs: replaceDoc('reference/cli/generate.md', '## Flags {#flags}', '## Flags'),
    }));

    expect(violations.filter((violation) => violation.page.endsWith('reference/cli/generate'))).not.toEqual([]);
  });

  it('finds a governing table after prose before the next H2', async () => {
    const violations = await checkFixture(createReferenceFixture({
      docs: replaceDoc('reference/cli/generate.md', '## Flags {#flags}\n\n|', '## Flags {#flags}\n\nThis prose does not govern the table.\n\n|'),
    }));

    expect(violations).toEqual([]);
  });

  it('rejects a missing generated artifact without mutating documentation pages', async () => {
    const fixture = createReferenceFixture({ omit: ['website/public/manifest/cli.json'] });
    const page = 'website/src/content/docs/reference/configuration.md';
    const before = fixture.read(page);

    await expect(checkFixture(fixture)).rejects.toThrow(/cli/i);
    expect(fixture.read(page)).toBe(before);
    expect(existsSync(join(fixture.root, page))).toBe(true);
  });

  it('returns multi-check violations sorted by check, page, then rule', async () => {
    const violations = await checkFixture(createReferenceFixture({
      docs: {
        ...replaceDoc('reference/cli/generate.md', '| --strict | boolean | strict mode | false |\n', ''),
        ...replaceDoc('reference/cli/overview.md', '| generate | paths | strict | defaults |', '| generate | paths | strict, invented | defaults |'),
        ...replaceDoc('reference/configuration.md', '| `testDir` | string | tests/ambercast |', '| `testDir` | string | wrong-directory |'),
        ...replaceDoc('reference/exit-codes.md', '| 1 | failure |', '| 7 | failure |'),
      },
    }));

    expect(violations.length).toBeGreaterThanOrEqual(3);
    expect(violations).toEqual([...violations].sort((left, right) => left.check.localeCompare(right.check) || left.page.localeCompare(right.page) || left.rule.localeCompare(right.rule)));
  });
});

describe('check-reference CLI entry point', () => {
  it('exits successfully without stdout when every generated artifact and reference page agree', async () => {
    const fixture = createReferenceFixture();
    expect(await checkFixture(fixture)).toEqual([]);

    const result = runEntryPoint(new URL('../scripts/check-reference.mjs', import.meta.url), fixture.website);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('prints every collector violation as one JSON line and exits non-zero', async () => {
    const fixture = createReferenceFixture({
      docs: replaceDoc('reference/configuration.md', '| `testDir` | string | tests/ambercast |', '| `testDir` | string | wrong-directory |'),
    });
    const violations = await checkFixture(fixture);
    const result = runEntryPoint(new URL('../scripts/check-reference.mjs', import.meta.url), fixture.website);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))).toEqual(violations);
  });
});

describe('checkReference lexical and missing-input contracts', () => {
  it('ignores fenced fake flags tables and preserves inline-code and escaped pipes in configuration rows', async () => {
    const extendedSchema = {
      ...configSchema,
      properties: {
        ...configSchema.properties,
        ai: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
          },
        },
        escapedPipe: { type: 'string' },
      },
    };
    const fencedFakeFlags = [
      '```md',
      '## Flags {#flags}',
      '',
      '| flag | value | effect | default |',
      '| --- | --- | --- | --- |',
      '| --invented | boolean | fake fenced example | false |',
      '```',
      '',
    ].join('\n');
    const configurationWithLexicalEdges = referenceDocs['reference/configuration.md'].replace(
      '| `defaultTarget` | string | web-user |',
      [
        '| `defaultTarget` | string | web-user |',
        '| `ai.provider` | `claude|codex|auto` | auto |',
        '| `escapedPipe` | string \\| literal | escaped-pipe-default |',
      ].join('\n'),
    );

    const violations = await checkFixture(createReferenceFixture({
      docs: {
        'reference/cli/generate.md': `${fencedFakeFlags}${referenceDocs['reference/cli/generate.md']}`,
        'reference/configuration.md': configurationWithLexicalEdges,
      },
      configSchema: extendedSchema,
      defaults: {
        ...defaults,
        'ai.provider': 'auto',
        escapedPipe: 'escaped-pipe-default',
      },
    }));

    expect(violations).toEqual([]);
  });

  it('rejects a missing private defaults artifact without mutating documentation pages', async () => {
    const fixture = createReferenceFixture({ omit: ['dist/manifest/config-defaults.json'] });
    const page = 'website/src/content/docs/reference/configuration.md';
    const before = fixture.read(page);

    await expect(checkFixture(fixture)).rejects.toThrow(/config-defaults|defaults/i);
    expect(fixture.read(page)).toBe(before);
    expect(existsSync(join(fixture.root, page))).toBe(true);
  });
});
