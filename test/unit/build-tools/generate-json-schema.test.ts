import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flattenDefaults, writeGeneratedArtifacts } from '../../../src/build-tools/generate-json-schema.js';
import { getConfigJsonSchema } from '../../../src/core/config/json-schema.js';
import { getGroundingJsonSchema, getPlanJsonSchema } from '../../../src/core/ir/json-schema.js';
import { getReportJsonSchema } from '../../../src/report/json-schema.js';
import { ReportErrorCode } from '../../../src/report/schema.js';

interface CapturedWrite {
  path: string;
  content: string;
}

const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

/**
 * Composes the manifest this test expects with the version a release PR is
 * free to change, rather than freezing it inside the fixture. `cli.json`'s
 * only version-dependent field is `version` itself (createCliManifest spreads
 * the static CLI_MANIFEST after it), so overriding just that key keeps every
 * other field fixture-pinned while tracking whatever package.json currently
 * says — matching how the generator derives its own output.
 */
function withLiveVersion(manifestLike: { version: string }, version: string) {
  return { ...manifestLike, version };
}

const fixtureCliManifest = JSON.parse(
  readFileSync(new URL('../../fixtures/cli-manifest.json', import.meta.url), 'utf8'),
);
const expectedCliManifest = withLiveVersion(fixtureCliManifest, pkg.version);

const EXPECTED_REPORT_ERROR_CODES = [
  'CONFIG_INVALID',
  'SECRET_UNRESOLVED',
  'TARGET_UNRESOLVED',
  'PROMPT_PATH_INVALID',
  'MISSING_PLAN',
  'STALE_PLAN',
  'INTEGRITY_VIOLATION',
  'SECRET_LITERAL_REJECTED',
  'SECRET_GRANT_UNATTRIBUTABLE',
  'BROWSER_LAUNCH_FAILED',
  'AI_EXECUTOR_UNAVAILABLE',
  'AI_RESPONSE_INVALID',
  'FS_IO_ERROR',
  'UNEXPECTED_CRASH',
  'INTERRUPTED',
] as const;

function captureGeneratedArtifactWrites(): CapturedWrite[] {
  const writes: CapturedWrite[] = [];

  writeGeneratedArtifacts({
    outDir: '/dist-output',
    writeFile: (path, content) => {
      writes.push({ path, content });
    },
  });

  return writes;
}

function artifactContent(writes: readonly CapturedWrite[], suffix: string): string {
  const artifact = writes.find(({ path }) => path.endsWith(suffix));

  if (artifact === undefined) {
    throw new Error(`Expected generated artifact ${suffix}.`);
  }

  return artifact.content;
}

describe('writeGeneratedArtifacts', () => {
  it('writes the exact compact JSON from all schema and manifest producers', () => {
    const expectedWrites: CapturedWrite[] = [
      { path: join('/dist-output', 'schema', 'plan.schema.json'), content: JSON.stringify(getPlanJsonSchema()) },
      { path: join('/dist-output', 'schema', 'grounding.schema.json'), content: JSON.stringify(getGroundingJsonSchema()) },
      { path: join('/dist-output', 'schema', 'config.schema.json'), content: JSON.stringify(getConfigJsonSchema()) },
      { path: join('/dist-output', 'schema', 'report.schema.json'), content: JSON.stringify(getReportJsonSchema()) },
      { path: join('/dist-output', 'manifest', 'cli.json'), content: JSON.stringify(expectedCliManifest) },
      {
        path: join('/dist-output', 'manifest', 'capabilities.json'),
        content: JSON.stringify({
          commands: ['generate', 'run', 'check', 'heal'],
          planned: ['init', 'view', 'review', 'mcp', 'baseline', 'restore'],
          schemaVersions: { plan: 2, grounding: 1, report: '3.4' },
          fingerprintAlgorithm: 'a11y-neighborhood-v2',
          exitCodes: [0, 1, 2, 3, 4, 5],
          errorCodes: ReportErrorCode.options,
        }),
      },
      {
        path: join('/dist-output', 'manifest', 'config-defaults.json'),
        content: JSON.stringify({
          testDir: 'tests/ambercast',
          runsDir: 'tests/ambercast/.runs',
          testMatch: ['**/*.test.md'],
          testIgnore: ['**/.runs/**', '**/*.ambercast.plan.json', '**/*.ambercast.grounding.json'],
          'targets.web-user.baseUrl': 'http://localhost:3000',
          'targets.web-user.browser': 'chromium',
          'targets.web-user.healReplayIsolation': 'stateful',
          defaultTarget: 'web-user',
          'ai.provider': 'auto',
          'ai.timeoutMs': 600_000,
          'ai.maxGenerateAttempts': 2,
          'viewer.port': 4_600,
          'ci.heal': false,
          'ci.updateGroundingCache': false,
          'grounding.repositoryPolicy': 'committed',
          'grounding.localWriteBack': 'auto',
          'heal.caseTimeoutMs': 300_000,
        }),
      },
    ];

    expect(captureGeneratedArtifactWrites()).toEqual(expectedWrites);
  });

  it('produces byte-identical writes when generation is repeated', () => {
    expect(captureGeneratedArtifactWrites()).toEqual(captureGeneratedArtifactWrites());
  });

  it('writes the CLI manifest with fixture-equivalent data and compact bytes', () => {
    const cliText = artifactContent(captureGeneratedArtifactWrites(), 'manifest/cli.json');
    const cliManifest = JSON.parse(cliText);

    expect(cliManifest).toStrictEqual(expectedCliManifest);
    expect(cliText).toBe(JSON.stringify(cliManifest));
  });

  it('regression: withLiveVersion overrides the fixture\'s frozen version instead of tracking it', () => {
    const probe = { ...fixtureCliManifest, version: '9.9.9-regression-probe' };

    expect(withLiveVersion(probe, pkg.version).version).toBe(pkg.version);
    expect(withLiveVersion(probe, pkg.version).version).not.toBe(probe.version);
  });

  it('writes the exact capabilities vocabulary without coercing schema-version types', () => {
    const capabilities = JSON.parse(
      artifactContent(captureGeneratedArtifactWrites(), 'manifest/capabilities.json'),
    );

    expect(capabilities).toStrictEqual({
      commands: ['generate', 'run', 'check', 'heal'],
      planned: ['init', 'view', 'review', 'mcp', 'baseline', 'restore'],
      schemaVersions: { plan: 2, grounding: 1, report: '3.4' },
      fingerprintAlgorithm: 'a11y-neighborhood-v2',
      exitCodes: [0, 1, 2, 3, 4, 5],
      errorCodes: ReportErrorCode.options,
    });
    expect(Object.keys(capabilities)).toStrictEqual([
      'commands',
      'planned',
      'schemaVersions',
      'fingerprintAlgorithm',
      'exitCodes',
      'errorCodes',
    ]);
    expect(typeof capabilities.schemaVersions.plan).toBe('number');
    expect(typeof capabilities.schemaVersions.grounding).toBe('number');
    expect(typeof capabilities.schemaVersions.report).toBe('string');
    expect(capabilities.errorCodes).toStrictEqual(EXPECTED_REPORT_ERROR_CODES);
    expect(capabilities.errorCodes).toStrictEqual(ReportErrorCode.options);
  });

  it('flattens every current raw-config leaf without inventing absent defaults', () => {
    const configDefaults = JSON.parse(
      artifactContent(captureGeneratedArtifactWrites(), 'manifest/config-defaults.json'),
    );

    expect(configDefaults).toStrictEqual({
      testDir: 'tests/ambercast',
      runsDir: 'tests/ambercast/.runs',
      testMatch: ['**/*.test.md'],
      testIgnore: ['**/.runs/**', '**/*.ambercast.plan.json', '**/*.ambercast.grounding.json'],
      'targets.web-user.baseUrl': 'http://localhost:3000',
      'targets.web-user.browser': 'chromium',
      'targets.web-user.healReplayIsolation': 'stateful',
      defaultTarget: 'web-user',
      'ai.provider': 'auto',
      'ai.timeoutMs': 600_000,
      'ai.maxGenerateAttempts': 2,
      'viewer.port': 4_600,
      'ci.heal': false,
      'ci.updateGroundingCache': false,
      'grounding.repositoryPolicy': 'committed',
      'grounding.localWriteBack': 'auto',
      'heal.caseTimeoutMs': 300_000,
    });
    expect(Object.hasOwn(configDefaults, 'heal.maxStepRepairs')).toBe(false);
    expect(Object.hasOwn(configDefaults, 'targets.web-user.secretSinkOrigins')).toBe(false);
  });

  it('keeps array, null, and empty-object values as leaves while recursing into non-empty objects', () => {
    const syntheticDefaults = {
      arrayLeaf: ['one', 'two'],
      nullLeaf: null,
      nested: {
        primitiveLeaf: 'value',
        emptyObjectLeaf: {},
      },
    };

    expect(flattenDefaults(syntheticDefaults)).toStrictEqual({
      arrayLeaf: ['one', 'two'],
      nullLeaf: null,
      'nested.primitiveLeaf': 'value',
      'nested.emptyObjectLeaf': {},
    });
  });

  it('emits Plan-v2 required coverage and additive Grounding-v1 coverage fields', () => {
    const writes = captureGeneratedArtifactWrites();
    const planText = artifactContent(writes, 'schema/plan.schema.json');
    const groundingText = artifactContent(writes, 'schema/grounding.schema.json');

    expect(planText).toContain('instructionCoverage');
    expect(planText).toContain('sourceSpan');
    expect(planText).toContain('startColumn');
    expect(planText).toContain('endColumn');
    expect(planText).toMatch(/"const":2/);
    expect(groundingText).toContain('verificationCoverage');
    expect(groundingText).toMatch(/"const":1/);
  });
});
