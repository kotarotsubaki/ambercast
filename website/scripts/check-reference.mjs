import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitByCodeRegions } from './lib/wikilinks.mjs';

/**
 * Checks that reference tables describe the generated CLI, configuration, and error vocabulary
 * that the site publishes.
 *
 * The checker reads public CLI, configuration-schema, and capabilities artifacts plus the private
 * defaults artifact. It compares CLI flags, the command matrix, configuration keys/defaults, and
 * code vocabularies. Markdown parsing excludes code regions, preserves protected pipes, and
 * normalizes aliases; violations are stable `{ check, page, rule, expected, actual }` records.
 *
 * @typedef {{ check: string, page: string, rule: string, expected: string, actual: string }} Violation
 * @typedef {{ name: string, alias: string | null }} FlagIdentifier
 * @typedef {{ lines: string[], startLine: number }} MarkdownTable
 * @typedef {{ docsRoot?: string, publicRoot?: string, configDefaultsPath?: string }} CheckReferenceOptions
 */

/**
 * Collects all generated-artifact/reference inconsistencies without deciding how to present them.
 *
 * Structured collection keeps presentation separate from validation. Omitted paths resolve from
 * the website working directory, and artifact failures remain hard failures rather than drift.
 *
 * @param {CheckReferenceOptions} [options] Optional fixture roots or defaults-artifact path.
 * @returns {Promise<Violation[]>} Every detected reference violation in deterministic order.
 */
export async function checkReference(options = {}) {
  const websiteRoot = process.cwd();
  const docsRoot = options.docsRoot ?? resolve(websiteRoot, 'src/content/docs');
  const publicRoot = options.publicRoot ?? resolve(websiteRoot, 'public');
  const configDefaultsPath = options.configDefaultsPath ?? resolve(websiteRoot, '../dist/manifest/config-defaults.json');
  const [cliManifest, configSchema, capabilities, configDefaults] = await Promise.all([
    readGeneratedJson(join(publicRoot, 'manifest/cli.json')),
    readGeneratedJson(join(publicRoot, 'schemas/config.schema.json')),
    readGeneratedJson(join(publicRoot, 'capabilities.json')),
    readGeneratedJson(configDefaultsPath),
  ]);
  const violations = (await Promise.all([
    checkCliFlagTables(docsRoot, cliManifest),
    checkCommandFlagMatrix(docsRoot, cliManifest),
    checkConfigurationReference(docsRoot, configSchema, configDefaults),
    checkCodeVocabularies(docsRoot, capabilities),
  ])).flat();
  return violations.sort(compareViolations);
}

/**
 * Reads and decodes one generated JSON artifact while preserving missing or invalid input as a
 * hard checker failure.
 *
 * Silent fallbacks would incorrectly report documentation drift when a producer artifact is
 * unavailable, so read and parse errors identify the missing input directly.
 *
 * @param {string} path Absolute path to the generated JSON artifact.
 * @returns {Promise<unknown>} The parsed artifact value.
 */
async function readGeneratedJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/**
 * Finds the first reference table governed by a named anchored H2.
 *
 * Code regions are masked before heading and separator detection, so examples cannot masquerade
 * as reference structure. The explicit H2 anchor governs the first following GFM table before
 * the next H2, allowing intervening prose.
 *
 * @param {string} markdown Complete Markdown source for one reference page.
 * @param {string} anchor Explicit anchor identifier expected on the governing H2.
 * @returns {MarkdownTable | undefined} The anchored table, or `undefined` when its anchor or
 * table is absent.
 */
function anchoredTable(markdown, anchor) {
  const sourceLines = markdown.split('\n');
  const maskedLines = maskCodeRegions(markdown).split('\n');
  const heading = new RegExp(`^##(?!#)\\s+.*\\{#${escapeRegExp(anchor)}\\}\\s*$`);
  const headingLine = maskedLines.findIndex((line) => heading.test(line));
  if (headingLine < 0) return undefined;

  for (let index = headingLine + 1; index + 1 < maskedLines.length; index += 1) {
    if (/^##(?!#)(?:\s|$)/.test(maskedLines[index])) return undefined;
    if (!isGfmTableStart(maskedLines[index], maskedLines[index + 1])) continue;
    const startLine = index;
    const lines = [sourceLines[index], sourceLines[index + 1]];
    while (index + 2 < maskedLines.length && maskedLines[index + 2].includes('|')) {
      lines.push(sourceLines[index + 2]);
      index += 1;
    }
    return { lines, startLine };
  }
  return undefined;
}

/**
 * Splits a GFM table row without mistaking content pipes for column delimiters.
 *
 * A pipe is structural only outside a matched inline-code span and when an even number of
 * backslashes precedes it. This preserves Markdown content for later normalization.
 *
 * @param {string} row One physical Markdown table row.
 * @returns {string[]} Cells in source order without the optional outer delimiters.
 */
function tableCells(row) {
  const start = row.search(/\S/);
  if (start < 0) return [''];
  const end = row.length - row.match(/\s*$/)[0].length;
  const boundaries = [];
  let codeDelimiter = 0;

  for (let index = start; index < end; index += 1) {
    if (row[index] === '`') {
      const length = backtickRunLength(row, index);
      if (codeDelimiter === length) codeDelimiter = 0;
      else if (codeDelimiter === 0 && hasMatchingDelimiter(row, index + length, length, end)) codeDelimiter = length;
      index += length - 1;
      continue;
    }
    if (row[index] === '|' && codeDelimiter === 0 && !isEscapedPipe(row, index)) boundaries.push(index);
  }

  const first = boundaries[0] === start ? 1 : 0;
  const last = boundaries.at(-1) === end - 1 ? boundaries.length - 1 : boundaries.length;
  const cells = [];
  let cellStart = first ? start + 1 : start;
  for (const boundary of boundaries.slice(first, last)) {
    cells.push(row.slice(cellStart, boundary));
    cellStart = boundary + 1;
  }
  cells.push(row.slice(cellStart, last < boundaries.length ? end - 1 : end));
  return cells;
}

/**
 * Extracts a canonical identifier from the first cell of a reference-table row.
 *
 * Inline-code content takes precedence over visible cell text, matching the site's established
 * table-identifier rule.
 *
 * @param {string} row One data row from a Markdown table.
 * @returns {string} The first-cell identifier after Markdown normalization.
 */
function firstCellIdentifier(row) {
  const cell = tableCells(row)[0]?.trim() ?? '';
  const codeSpan = splitByCodeRegions(cell).find((region) => region.isCode && /^`+/.test(region.text));
  return codeSpan ? codeSpan.text.replace(/^`+|`+$/g, '').trim() : cell;
}

/**
 * Normalizes a documented long option and optional short alias into the manifest's comparison
 * form.
 *
 * Comma- and slash-separated spellings normalize to the manifest's long-name and optional-alias
 * shape, so tables and the command matrix compare punctuation-independently.
 *
 * @param {string} identifier Documented option spelling from a table cell.
 * @returns {FlagIdentifier} Canonical long name and optional short alias.
 */
function normalizeFlagIdentifier(identifier) {
  const parts = identifier.split(/[,/]/).map((part) => part.trim().replace(/^`+|`+$/g, '').replace(/^-+/, '')).filter(Boolean);
  return {
    name: parts.find((part) => part.length !== 1) ?? '',
    alias: parts.find((part) => part.length === 1) ?? null,
  };
}

/**
 * Converts a documented configuration key into the corresponding schema property path.
 *
 * Ordinary dot paths map through nested `properties` objects. The documented target placeholder
 * maps through `additionalProperties`, checking the target-record contract without enumerating a
 * concrete target.
 *
 * @param {string} keyPath First-cell key path from the configuration table.
 * @returns {string} Canonical traversal path within `config.schema.json`.
 */
function configSchemaPath(keyPath) {
  const parts = keyPath.split('.');
  if (parts[0] === 'targets' && parts[1] === '<name>') {
    return ['properties', 'targets', 'additionalProperties', ...parts.slice(2).flatMap((part) => ['properties', part])].join('.');
  }
  return parts.flatMap((part) => ['properties', part]).join('.');
}

/**
 * Resolves the configuration table's target placeholder to the concrete flattened-default key.
 *
 * Documentation names target fields with `targets.<name>.*`, while the defaults artifact uses
 * concrete target keys. `defaultTarget` resolves that placeholder without embedding a target name.
 *
 * @param {string} keyPath Documented configuration key path.
 * @param {Record<string, unknown>} defaults Flattened generated defaults artifact.
 * @returns {string} Key used to look up the documented default in the artifact.
 */
function defaultArtifactKey(keyPath, defaults) {
  return keyPath.replace(/^targets\.<name>(?=\.|$)/, `targets.${String(defaults.defaultTarget)}`);
}

/**
 * Tests one documented Default cell against both the presence and value of a flattened default.
 *
 * A leading `absent`, `—`, or `none` asserts that the artifact key does not exist. Present arrays
 * and plain objects compare as JSON, while scalar values compare as strings.
 *
 * @param {Record<string, unknown>} defaults Flattened generated defaults artifact.
 * @param {string} key Artifact key after target-placeholder resolution.
 * @param {string} cellText Default-column Markdown cell text.
 * @returns {boolean} Whether the artifact's presence and value satisfy the documented default.
 */
function matchesDocumentedDefault(defaults, key, cellText) {
  const documented = documentedCellValue(cellText);
  const absent = /^(absent|—|none)$/i.test(documented);
  const present = Object.hasOwn(defaults, key);
  if (absent) return !present;
  if (!present) return false;
  const actual = defaults[key];
  return (Array.isArray(actual) || isPlainObject(actual) ? JSON.stringify(actual) : String(actual)) === documented;
}

/**
 * Compares each command's `{#flags}` table with its CLI-manifest descriptor.
 *
 * Each command page isolates its positional row and compares its remaining normalized options to
 * the manifest. Row order and descriptive columns are outside this generated-interface contract.
 *
 * @param {string} docsRoot Root directory containing the site reference Markdown pages.
 * @param {unknown} cliManifest Parsed public CLI manifest artifact.
 * @returns {Promise<Violation[]>} Flag-table violations for all implemented CLI commands.
 */
async function checkCliFlagTables(docsRoot, cliManifest) {
  const violations = [];
  for (const command of cliManifest.commands ?? []) {
    const page = `reference/cli/${command.name}`;
    const table = anchoredTable(await readFile(join(docsRoot, `${page}.md`), 'utf8'), 'flags');
    const identifiers = (table?.lines.slice(2) ?? []).map(firstCellIdentifier).filter(Boolean);
    const expectedPositional = command.positional?.name ?? 'absent';
    const actualPositional = identifiers.includes(expectedPositional) ? expectedPositional : 'absent';
    if (expectedPositional !== actualPositional) {
      violations.push({ check: 'cli-flag-tables', page, rule: 'positional', expected: expectedPositional, actual: actualPositional });
    }
    addSetViolation(
      violations,
      'cli-flag-tables',
      page,
      'flag-set',
      flagSet(command.flags ?? []),
      flagSet(identifiers.filter((identifier) => identifier !== expectedPositional).map(normalizeFlagIdentifier)),
    );
  }
  return violations;
}

/**
 * Compares the overview command-flag matrix with each command's manifest flags.
 *
 * The command matrix's accepted-options column uses the same alias normalization as command
 * pages. Its positional column is intentionally outside this comparison.
 *
 * @param {string} docsRoot Root directory containing the site reference Markdown pages.
 * @param {unknown} cliManifest Parsed public CLI manifest artifact.
 * @returns {Promise<Violation[]>} Command-matrix flag violations.
 */
async function checkCommandFlagMatrix(docsRoot, cliManifest) {
  const page = 'reference/cli/overview';
  const table = anchoredTable(await readFile(join(docsRoot, `${page}.md`), 'utf8'), 'command-flag-matrix');
  const rows = table?.lines.slice(2) ?? [];
  const violations = [];
  for (const command of cliManifest.commands ?? []) {
    const row = rows.find((candidate) => firstCellIdentifier(candidate) === command.name);
    const identifiers = (tableCells(row ?? '')[2] ?? '').split(',').map((identifier) => identifier.trim()).filter(Boolean);
    addSetViolation(violations, 'command-flag-matrix', page, `flag-set:${command.name}`, flagSet(command.flags ?? []), flagSet(identifiers.map(normalizeFlagIdentifier)));
  }
  return violations;
}

/**
 * Compares configuration keys and defaults with the generated schema and private defaults map.
 *
 * The key table compares documented paths with schema leaf paths and validates every Default cell
 * against the private flattened defaults artifact, which never enters `website/public`.
 *
 * @param {string} docsRoot Root directory containing the site reference Markdown pages.
 * @param {unknown} configSchema Parsed public configuration JSON Schema.
 * @param {Record<string, unknown>} configDefaults Parsed private flattened defaults artifact.
 * @returns {Promise<Violation[]>} Configuration key and default-value violations.
 */
async function checkConfigurationReference(docsRoot, configSchema, configDefaults) {
  const page = 'reference/configuration';
  const table = anchoredTable(await readFile(join(docsRoot, `${page}.md`), 'utf8'), 'key-table');
  const rows = table?.lines.slice(2) ?? [];
  const violations = [];
  addSetViolation(
    violations,
    'configuration',
    page,
    'schema-key-set',
    schemaPropertyPaths(configSchema),
    new Set(rows.map(firstCellIdentifier).filter(Boolean).map(configSchemaPath)),
  );
  for (const row of rows) {
    const keyPath = firstCellIdentifier(row);
    if (!keyPath) continue;
    const key = defaultArtifactKey(keyPath, configDefaults);
    const documented = documentedCellValue(tableCells(row)[2] ?? '');
    if (!matchesDocumentedDefault(configDefaults, key, documented)) {
      violations.push({
        check: 'configuration',
        page,
        rule: `default:${keyPath}`,
        expected: `${key}: ${defaultValue(configDefaults, key)}`,
        actual: `${key}: ${documented}`,
      });
    }
  }
  return violations;
}

/**
 * Compares the documented exit and error code vocabularies with generated capabilities.
 *
 * The two capability vocabularies compare their first-column sets against the same generated
 * capability snapshot, stringifying numeric exit codes.
 *
 * @param {string} docsRoot Root directory containing the site reference Markdown pages.
 * @param {unknown} capabilities Parsed public capabilities artifact.
 * @returns {Promise<Violation[]>} Exit-code and error-code vocabulary violations.
 */
async function checkCodeVocabularies(docsRoot, capabilities) {
  const violations = [];
  for (const [page, anchor, rule, expected] of [
    ['reference/exit-codes', 'exit-code-table', 'exit-code-set', (capabilities.exitCodes ?? []).map(String)],
    ['reference/error-codes', 'code-vocabulary', 'error-code-set', capabilities.errorCodes ?? []],
  ]) {
    const table = anchoredTable(await readFile(join(docsRoot, `${page}.md`), 'utf8'), anchor);
    addSetViolation(violations, 'code-vocabularies', page, rule, new Set(expected), new Set((table?.lines.slice(2) ?? []).map(firstCellIdentifier).filter(Boolean)));
  }
  return violations;
}

function maskCodeRegions(markdown) {
  return splitByCodeRegions(markdown).map((region) => region.isCode ? region.text.replace(/[^\n]/g, ' ') : region.text).join('');
}

function isGfmTableStart(header, separator) {
  return header.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function backtickRunLength(value, index) {
  let length = 0;
  while (value[index + length] === '`') length += 1;
  return length;
}

function hasMatchingDelimiter(value, start, length, end) {
  for (let index = start; index < end; index += 1) {
    if (value[index] === '\n') return false;
    if (value[index] !== '`') continue;
    const candidateLength = backtickRunLength(value, index);
    if (candidateLength === length) return true;
    index += candidateLength - 1;
  }
  return false;
}

function isEscapedPipe(value, index) {
  let backslashes = 0;
  for (let cursor = index - 1; value[cursor] === '\\'; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function documentedCellValue(cellText) {
  const codeSpan = splitByCodeRegions(cellText).find((region) => region.isCode && /^`+/.test(region.text));
  if (codeSpan) return codeSpan.text.replace(/^`+|`+$/g, '').trim();
  return cellText.trim().split(/\s+/)[0] ?? '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function defaultValue(defaults, key) {
  if (!Object.hasOwn(defaults, key)) return 'absent';
  const value = defaults[key];
  return Array.isArray(value) || isPlainObject(value) ? JSON.stringify(value) : String(value);
}

function flagSet(flags) {
  return new Set(flags.map(({ name, alias }) => `${name}\u0000${alias ?? ''}`));
}

function schemaPropertyPaths(schema) {
  const paths = new Set();
  const visit = (node, path) => {
    const properties = node?.properties;
    if (!properties || typeof properties !== 'object' || Object.keys(properties).length === 0) {
      paths.add(path.join('.'));
      return;
    }
    for (const [name, property] of Object.entries(properties)) {
      if (name === 'targets' && property?.additionalProperties) {
        visit(property.additionalProperties, [...path, 'properties', name, 'additionalProperties']);
      } else {
        visit(property, [...path, 'properties', name]);
      }
    }
  };
  const properties = schema?.properties;
  if (!properties || typeof properties !== 'object') return paths;
  for (const [name, property] of Object.entries(properties)) {
    if (name === 'targets' && property?.additionalProperties) visit(property.additionalProperties, ['properties', 'targets', 'additionalProperties']);
    else visit(property, ['properties', name]);
  }
  return paths;
}

function addSetViolation(violations, check, page, rule, expected, actual) {
  if (sameSet(expected, actual)) return;
  violations.push({ check, page, rule, expected: formatSet(expected), actual: formatSet(actual) });
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function formatSet(values) {
  return [...values].sort().map((value) => {
    const [name, alias] = value.split('\u0000');
    return alias ? `${name}/${alias}` : name;
  }).join('\n');
}

function compareViolations(left, right) {
  return left.check.localeCompare(right.check) || left.page.localeCompare(right.page) || left.rule.localeCompare(right.rule);
}

/**
 * Projects structured reference violations to JSON Lines and signals documentation drift.
 *
 * The command wrapper writes one complete collector violation per stdout line and sets a non-zero
 * exit code only for documented drift. Artifact read failures remain thrown errors.
 *
 * @returns {Promise<void>} Resolves after reporting the complete checker result.
 */
export async function main() {
  const violations = await checkReference();
  for (const violation of violations) process.stdout.write(`${JSON.stringify(violation)}\n`);
  if (violations.length > 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
