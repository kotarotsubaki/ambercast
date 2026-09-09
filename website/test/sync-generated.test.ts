import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDocsFixture, runEntryPoint } from './cli-fixture.ts';

const fixtures: ReturnType<typeof createDocsFixture>[] = [];
const initialSyncOptional = process.env.SYNC_OPTIONAL;

afterEach(() => {
  fixtures.splice(0).forEach((fixture) => fixture.dispose());
  if (initialSyncOptional === undefined) delete process.env.SYNC_OPTIONAL;
  else process.env.SYNC_OPTIONAL = initialSyncOptional;
});

const requiredSources = {
  'dist/schema/config.schema.json': '{"schema":"config","unicode":"雪"}\n',
  'dist/schema/plan.schema.json': '{"schema":"plan"}\n',
  'dist/schema/grounding.schema.json': '{"schema":"grounding"}\n',
  'dist/schema/report.schema.json': '{"schema":"report"}\n',
  'dist/manifest/capabilities.json': '{"commands":["generate"]}\n',
  'dist/manifest/cli.json': '{"version":"0.3.1"}\n',
};

const publications: ReadonlyArray<readonly [string, string]> = [
  ['dist/schema/config.schema.json', 'website/public/schemas/config.schema.json'],
  ['dist/schema/plan.schema.json', 'website/public/schemas/plan.v2.schema.json'],
  ['dist/schema/grounding.schema.json', 'website/public/schemas/grounding.v1.schema.json'],
  ['dist/schema/report.schema.json', 'website/public/schemas/report.v3.schema.json'],
  ['dist/manifest/capabilities.json', 'website/public/capabilities.json'],
  ['dist/manifest/cli.json', 'website/public/manifest/cli.json'],
];

function fixtureFor(files: Record<string, string>) {
  const fixture = createDocsFixture({ 'website/.fixture': '', ...files });
  fixtures.push(fixture);
  return fixture;
}

function withSyncOptional<T>(value: string | undefined, action: () => T): T {
  if (value === undefined) delete process.env.SYNC_OPTIONAL;
  else process.env.SYNC_OPTIONAL = value;
  return action();
}

function writeStaleOutputs(root: string) {
  for (const [path, contents] of Object.entries({
    'website/public/schemas/old.json': 'old schema\n',
    'website/public/capabilities.json': 'old capabilities\n',
    'website/public/manifest/old.json': 'old manifest\n',
  })) {
    const file = join(root, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, contents);
  }
}

function expectNoPublishedOutputs(root: string) {
  expect(existsSync(join(root, 'website/public/schemas'))).toBe(false);
  expect(existsSync(join(root, 'website/public/capabilities.json'))).toBe(false);
  expect(existsSync(join(root, 'website/public/manifest'))).toBe(false);
}

describe('sync-generated CLI entry point', () => {
  it('copies every public generated artifact byte-for-byte without diagnostics', () => {
    const fixture = fixtureFor({
      ...requiredSources,
      'dist/manifest/config-defaults.json': '{"private":"must-not-publish"}\n',
    });

    const result = runEntryPoint(new URL('../scripts/sync-generated.mjs', import.meta.url), fixture.website);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    for (const [source, destination] of publications) {
      expect(readFileSync(join(fixture.root, destination))).toStrictEqual(readFileSync(join(fixture.root, source)));
    }
    expect(existsSync(join(fixture.root, 'website/public/manifest/config-defaults.json'))).toBe(false);
  });

  it('removes stale outputs and warns successfully when the root build is optionally absent', () => {
    const fixture = fixtureFor({});
    writeStaleOutputs(fixture.root);

    const result = withSyncOptional('1', () => runEntryPoint(new URL('../scripts/sync-generated.mjs', import.meta.url), fixture.website));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toBe('');
    expectNoPublishedOutputs(fixture.root);
    expect(existsSync(join(fixture.root, 'website/public/schemas/old.json'))).toBe(false);
  });

  it('rejects an absent root build unless SYNC_OPTIONAL is exactly 1 with one stable diagnostic', () => {
    const fixture = fixtureFor({});
    const diagnostics: string[] = [];

    for (const value of [undefined, '0', '']) {
      writeStaleOutputs(fixture.root);
      const result = withSyncOptional(value, () => runEntryPoint(new URL('../scripts/sync-generated.mjs', import.meta.url), fixture.website));
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toBe('');
      expectNoPublishedOutputs(fixture.root);
      diagnostics.push(result.stderr);
    }

    expect(new Set(diagnostics).size).toBe(1);
  });

  for (const missing of ['dist/schema/report.schema.json', 'dist/manifest/cli.json']) {
    it(`rejects a present but incomplete build missing ${missing} without any partial publication`, () => {
      const files = { ...requiredSources };
      delete files[missing as keyof typeof requiredSources];
      const fixture = fixtureFor(files);

      const result = withSyncOptional('1', () => runEntryPoint(new URL('../scripts/sync-generated.mjs', import.meta.url), fixture.website));

      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toBe('');
      expectNoPublishedOutputs(fixture.root);
    });
  }

  it('removes stale outputs before rejecting a present but incomplete build', () => {
    const files = { ...requiredSources };
    delete files['dist/schema/report.schema.json'];
    const fixture = fixtureFor(files);
    writeStaleOutputs(fixture.root);

    const result = withSyncOptional('1', () => runEntryPoint(new URL('../scripts/sync-generated.mjs', import.meta.url), fixture.website));

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toBe('');
    expectNoPublishedOutputs(fixture.root);
    expect(existsSync(join(fixture.root, 'website/public/schemas/old.json'))).toBe(false);
  });

  it('rejects a root build path that is a regular file regardless of SYNC_OPTIONAL', () => {
    const fixture = fixtureFor({ dist: 'not a directory\n' });

    for (const value of [undefined, '1', '0', '']) {
      writeStaleOutputs(fixture.root);
      const result = withSyncOptional(value, () => runEntryPoint(new URL('../scripts/sync-generated.mjs', import.meta.url), fixture.website));

      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/not a directory/i);
      expectNoPublishedOutputs(fixture.root);
    }
  });
});
