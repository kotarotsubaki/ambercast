/**
 * Produces the static JSON Schema files that ambercast publishes for tooling
 * outside its TypeScript runtime.
 *
 * This build-tool entry point owns filesystem I/O so core schema modules
 * remain pure. Package export subpaths expose the static outputs to IDEs and
 * non-JavaScript consumers without making this executable public API.
 *
 * Imports remain free of filesystem side effects. The main-program guard
 * confines writes to direct execution, while the injected writer lets tests
 * compare output bytes without touching disk.
 *
 * The writer treats `outDir` as the `dist` root, separating JSON Schemas from
 * manifest artifacts beneath its `schema/` and `manifest/` directories.
 * Every artifact uses compact `JSON.stringify` output so consumers receive
 * the producer's bytes without a re-serialization surprise. `cli.json` uses
 * the same build-time version constant as the bundled CLI, avoiding a
 * source-path-dependent `package.json` read.
 *
 * Config defaults become dotted paths for lookup while retaining arrays,
 * `null`, primitives, and empty objects as their original leaf values.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as url from 'node:url';
import { DEFAULT_RAW_CONFIG } from '#config/defaults.js';
import { CLI_MANIFEST, createCliManifest } from '#core/cli/manifest.js';
import { getConfigJsonSchema } from '#core/config/json-schema.js';
import { EXIT_CODES } from '#core/errors/exit-codes.js';
import { getGroundingJsonSchema, getPlanJsonSchema } from '#core/ir/json-schema.js';
import { FINGERPRINT_ALGORITHM, GROUNDING_SCHEMA_VERSION, PLAN_SCHEMA_VERSION } from '#core/ir/schema.js';
import { getReportJsonSchema } from '#report/json-schema.js';
import { ReportErrorCode, REPORT_SCHEMA_VERSION } from '#report/schema.js';

function isNonEmptyPlainObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

export function flattenDefaults(value: object): Record<string, unknown> {
  const flattened: Record<string, unknown> = {};

  const visit = (container: object, prefix: string): void => {
    for (const [key, nestedValue] of Object.entries(container)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      if (isNonEmptyPlainObject(nestedValue)) {
        visit(nestedValue, path);
      } else {
        flattened[path] = nestedValue;
      }
    }
  };

  visit(value, '');
  return flattened;
}

/**
 * Writes the generated schema and manifest artifact set through an injected
 * file writer.
 *
 * Writer injection keeps byte-level output tests independent of the
 * filesystem while direct execution supplies the synchronous file writer.
 *
 * @param deps - The output directory and synchronous writer supplied by the
 * build entry point or a test double.
 */
export function writeGeneratedArtifacts(deps: {
  writeFile: (path: string, content: string) => void;
  outDir: string;
}): void {
  deps.writeFile(join(deps.outDir, 'schema', 'plan.schema.json'), JSON.stringify(getPlanJsonSchema()));
  deps.writeFile(join(deps.outDir, 'schema', 'grounding.schema.json'), JSON.stringify(getGroundingJsonSchema()));
  deps.writeFile(join(deps.outDir, 'schema', 'config.schema.json'), JSON.stringify(getConfigJsonSchema()));
  deps.writeFile(join(deps.outDir, 'schema', 'report.schema.json'), JSON.stringify(getReportJsonSchema()));
  deps.writeFile(join(deps.outDir, 'manifest', 'cli.json'), JSON.stringify(createCliManifest(__VERSION__)));
  deps.writeFile(join(deps.outDir, 'manifest', 'capabilities.json'), JSON.stringify({
    commands: CLI_MANIFEST.commands.map(({ name }) => name),
    planned: ['init', 'view', 'review', 'mcp', 'baseline', 'restore'],
    schemaVersions: {
      plan: PLAN_SCHEMA_VERSION,
      grounding: GROUNDING_SCHEMA_VERSION,
      report: REPORT_SCHEMA_VERSION,
    },
    fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
    exitCodes: EXIT_CODES,
    errorCodes: ReportErrorCode.options,
  }));
  deps.writeFile(join(deps.outDir, 'manifest', 'config-defaults.json'), JSON.stringify(flattenDefaults(DEFAULT_RAW_CONFIG)));
}

/**
 * Only direct execution writes generated files, keeping imports side-effect
 * free and output independent of the caller's directory.
 */
if (import.meta.url === url.pathToFileURL(process.argv[1] ?? '').href) {
  const outDir = url.fileURLToPath(new URL('./', import.meta.url));
  mkdirSync(join(outDir, 'schema'), { recursive: true });
  mkdirSync(join(outDir, 'manifest'), { recursive: true });
  writeGeneratedArtifacts({
    outDir,
    writeFile: writeFileSync,
  });
}
