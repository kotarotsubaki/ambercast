import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Publishes generated artifacts for the documentation site without allowing stale or partial
 * output to appear current. `config-defaults.json` remains private because the reference checker
 * consumes it as validation input rather than as a published interface.
 *
 * @typedef {{ source: string, destination: string }} Publication
 */

/**
 * Publishes the current build interfaces alongside the committed Plan v2 snapshot. Build output
 * supplies schemas that evolve with the repository, while the snapshot preserves the exact
 * historical bytes emitted immediately before Plan v3 (commit
 * c391a59604a81da0e294f265ce5f47fba7344a02, SHA-256
 * 123a3e3b22570ddbe6fa1886a9d91a7ddfc97e31a5b05b124a829e20f27b9325) so consumers of the
 * retired contract keep a stable URL even though the current build no longer creates it.
 * `SYNC_OPTIONAL=1` permits only
 * an entirely absent root build so local development can deliberately serve 404s instead of
 * obsolete generated artifacts.
 *
 * @returns {Promise<void>} Resolves after a complete publication or an allowed missing-build
 * outcome; rejects for a required or malformed build input.
 */
export async function main() {
  const websiteRoot = process.cwd();
  const repositoryRoot = join(websiteRoot, '..');
  const publicRoot = join(websiteRoot, 'public');
  const distRoot = join(repositoryRoot, 'dist');
  const frozenSchemaRoot = join(websiteRoot, 'src', 'schemas-frozen');

  await removePublishedOutputs(publicRoot);
  if (!await hasBuildDirectory(distRoot)) {
    if (process.env.SYNC_OPTIONAL === '1') {
      process.stderr.write(`Generated artifacts are unavailable because ${distRoot} does not exist.\n`);
      return;
    }
    throw new Error(`Generated artifacts are unavailable because ${distRoot} does not exist.`);
  }

  await publishArtifacts(await preflightPublications(distRoot, publicRoot, frozenSchemaRoot));
}

/**
 * Removes all generated public outputs before examining the current build so a development server
 * cannot retain artifacts from an earlier synchronization.
 *
 * @param {string} publicRoot Absolute `website/public` directory containing generated outputs.
 * @returns {Promise<void>} Resolves after each stale output is absent.
 */
async function removePublishedOutputs(publicRoot) {
  await Promise.all([
    rm(join(publicRoot, 'schemas'), { recursive: true, force: true }),
    rm(join(publicRoot, 'capabilities.json'), { force: true }),
    rm(join(publicRoot, 'manifest'), { recursive: true, force: true }),
  ]);
}

/**
 * Classifies the root build without broadening the optional-sync escape hatch: only `ENOENT`
 * means absent, and a present path must be a directory.
 *
 * @param {string} distRoot Absolute path to the repository's root `dist` directory.
 * @returns {Promise<boolean>} Whether the root build directory is present and usable.
 */
async function hasBuildDirectory(distRoot) {
  let details;
  try {
    details = await stat(distRoot);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!details.isDirectory()) throw new Error(`Generated artifact root is not a directory: ${distRoot}`);
  return true;
}

/**
 * Verifies the complete public artifact surface from both source roots before the first
 * destination write. The frozen Plan v2 schema remains a committed historical snapshot rather
 * than generated output because it is pinned to the exact bytes from immediately before Plan v3
 * at commit c391a59604a81da0e294f265ce5f47fba7344a02 with SHA-256
 * 123a3e3b22570ddbe6fa1886a9d91a7ddfc97e31a5b05b124a829e20f27b9325; treating it as part of
 * the same preflight prevents a v3-only publication when that contract artifact is unavailable.
 *
 * @param {string} distRoot Absolute path to the already-validated root `dist` directory.
 * @param {string} publicRoot Absolute `website/public` directory for the copied artifacts.
 * @param {string} frozenSchemaRoot Absolute directory containing committed frozen schemas.
 * @returns {Promise<Publication[]>} The complete, preflighted copy plan in deterministic order.
 */
async function preflightPublications(distRoot, publicRoot, frozenSchemaRoot) {
  const publications = [
    ['schema/config.schema.json', 'schemas/config.schema.json'],
    ['schema/plan.schema.json', 'schemas/plan.v3.schema.json'],
    ['schema/grounding.schema.json', 'schemas/grounding.v1.schema.json'],
    ['schema/report.schema.json', 'schemas/report.v3.schema.json'],
    ['manifest/capabilities.json', 'capabilities.json'],
    ['manifest/cli.json', 'manifest/cli.json'],
  ].map(([source, destination]) => ({ source: join(distRoot, source), destination: join(publicRoot, destination) }));
  publications.push({
    source: join(frozenSchemaRoot, 'plan.v2.schema.json'),
    destination: join(publicRoot, 'schemas/plan.v2.schema.json'),
  });

  await Promise.all(publications.map(async ({ source }) => {
    const details = await stat(source);
    if (!details.isFile()) throw new Error(`Generated artifact is not a file: ${source}`);
  }));
  return publications;
}

/**
 * Creates destination parents and copies a fully preflighted artifact set verbatim so producer
 * bytes, including whitespace and encoding, remain unchanged.
 *
 * @param {Publication[]} publications Complete source-to-destination copy plan from preflight.
 * @returns {Promise<void>} Resolves after every artifact has been copied byte-for-byte.
 */
async function publishArtifacts(publications) {
  await Promise.all(publications.map(async ({ source, destination }) => {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
