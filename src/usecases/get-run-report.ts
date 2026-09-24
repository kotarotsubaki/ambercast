/**
 * Classifies persisted run evidence for the local results viewer.
 *
 * The viewer reads existing artifacts through a narrow storage capability;
 * classification does not repair reports or infer why an absent report was
 * never persisted.
 */
import type { StorageAdapter } from '#ports/storage.js';
import { ReportEnvelope } from '#report/schema.js';
import { LenientRunReportEnvelope } from '#report/lenient-run-report.js';
export { REPORT_SCHEMA_VERSION } from '#report/schema.js';
import { RUN_ID_PATTERN } from '#core/layout/resolve.js';
import { joinPath } from '#core/paths.js';
import { z } from 'zod';

/**
 * Read-only storage and absolute roots used to classify run artifacts.
 *
 * @remarks
 * Keeping both roots explicit lets screenshot retrieval check the resolved
 * artifact against its run directory without granting this usecase write or
 * browser capabilities.
 */
export type GetRunReportDeps = {
  readonly storage: Pick<StorageAdapter, 'listDirectories' | 'readText' | 'readBinary' | 'realPath'>;
  readonly runsDir: string;
  readonly projectRoot: string;
};

type RunReportEnvelope = z.infer<typeof LenientRunReportEnvelope>;

/**
 * A run directory's report state for list and detail consumers.
 *
 * @remarks
 * `readable` contains a validated run envelope and its schemaVersion for detail
 * display. `exact` records whether the first strict 3.7 parse succeeded; it
 * is not a version comparison. `no-report` means the report
 * read returned ENOENT; evidence from heal, interrupted persistence, and a
 * failed write cannot be distinguished from that absence. `unreadable` retains
 * a row when bytes exist but JSON parsing fails (`invalid-json`), envelope
 * validation fails (`schema-mismatch`), or the valid envelope belongs to a
 * different command (`not-run-report`), or a string version is unsupported
 * (`unsupported-version`, with that version retained). A non-ENOENT report read failure is
 * `read-error`, including permission denial. These reasons keep malformed
 * data distinct from an unavailable file without suppressing other runs.
 */
export type RunListing =
  | { readonly kind: 'readable'; readonly runId: string; readonly envelope: RunReportEnvelope; readonly schemaVersion: string; readonly exact: boolean }
  | { readonly kind: 'no-report'; readonly runId: string }
  | { readonly kind: 'unreadable'; readonly runId: string; readonly reason: 'invalid-json' | 'schema-mismatch' | 'not-run-report' | 'read-error' }
  | { readonly kind: 'unreadable'; readonly runId: string; readonly reason: 'unsupported-version'; readonly version: string };

/**
 * Lists valid run directories and classifies each report independently.
 *
 * @param deps - Storage and roots for persisted runs.
 * @returns Listings sorted by run ID in descending code-unit order; a missing
 * runs directory yields an empty list.
 * @throws A directory-enumeration error other than ENOENT.
 * @remarks
 * Nonmatching directory names are excluded. A report `readText` failure is
 * confined to its row: ENOENT becomes `no-report`, while other failures become
 * `unreadable` with `read-error`. By contrast, `listDirectories` failure other
 * than ENOENT is re-thrown for the HTTP error boundary rather than disguised
 * as an empty list or a broken individual report.
 */
export async function listRunReports(deps: GetRunReportDeps): Promise<readonly RunListing[]> {
  const runIds = await listRunIds(deps);
  const listings = await Promise.all(runIds.filter((runId) => RUN_ID_PATTERN.test(runId)).map((runId) => classifyReport(deps, runId)));
  return listings.sort((a, b) => b.runId < a.runId ? -1 : b.runId > a.runId ? 1 : 0);
}

/**
 * Classifies one existing run directory's report.
 *
 * @param deps - Storage and roots for persisted runs.
 * @param runId - Candidate run directory name.
 * @returns `not-found` for an invalid ID or a name absent from the directory
 * listing; otherwise the same classification used by the list view.
 * @throws A directory-enumeration error other than ENOENT.
 * @remarks
 * Directory membership rules out a regular file or symlink with a plausible
 * name. Once membership is established, `readText` EACCES and other non-ENOENT
 * failures become `unreadable`/`read-error`; `listDirectories` failures instead
 * propagate to the router's server-error path.
 */
export async function getRunReport(deps: GetRunReportDeps, runId: string): Promise<RunListing | { readonly kind: 'not-found' }> {
  if (!await hasRunDirectory(deps, runId)) return { kind: 'not-found' };
  return classifyReport(deps, runId);
}

/**
 * Retrieves the persisted report bytes without reserializing its envelope.
 *
 * @param deps - Storage and roots for persisted runs.
 * @param runId - Candidate run directory name.
 * @returns Original bytes, or `not-found` for an invalid ID, missing run
 * directory, or missing report.
 * @throws Non-ENOENT storage failures, including directory enumeration errors.
 * @remarks
 * Raw access preserves malformed reports for diagnosis. The caller decides
 * the response media type from report classification, not from these bytes.
 */
export async function getRunReportBytes(deps: GetRunReportDeps, runId: string): Promise<{ readonly kind: 'found'; readonly bytes: Uint8Array } | { readonly kind: 'not-found' }> {
  if (!await hasRunDirectory(deps, runId)) return { kind: 'not-found' };
  try {
    return { kind: 'found', bytes: await deps.storage.readBinary(reportPath(deps, runId)) };
  } catch (error) {
    if (isMissingPathError(error)) return { kind: 'not-found' };
    throw error;
  }
}

/**
 * Retrieves only a screenshot authorized by a readable run report.
 *
 * @param deps - Storage and roots for persisted runs.
 * @param runId - Candidate run directory name.
 * @param ref - Decoded screenshot reference from the request path.
 * @returns Screenshot bytes when every authorization and containment check
 * succeeds; otherwise `not-found`, without disclosing which check failed.
 * @throws Non-ENOENT storage failures from path resolution or binary reads.
 * @remarks
 * Four conditions form one safety invariant. The run must classify as
 * `readable`, so untrusted or missing reports cannot authorize files. The ref
 * must occur among its step screenshots, with no `screenshotOmitted` on any
 * step sharing that ref, so an omitted secret cannot be recovered through
 * another step. The ref must be POSIX relative, excluding backslashes,
 * absolute or drive-rooted paths, and `..` segments before path joining.
 * Finally both the candidate and run directory must resolve through
 * `realPath`, and the candidate must lie strictly below the resolved run
 * directory; this catches symlink escape and avoids a sibling-prefix match.
 * Missing paths and `joinPath` RangeError for a shape-valid ref fold into
 * `not-found`; other storage errors propagate to the HTTP error boundary.
 */
export async function getRunScreenshot(deps: GetRunReportDeps, runId: string, ref: string): Promise<{ readonly kind: 'found'; readonly bytes: Uint8Array } | { readonly kind: 'not-found' }> {
  const report = await getRunReport(deps, runId);
  if (report.kind !== 'readable') return { kind: 'not-found' };

  const matchingSteps = report.envelope.results.flatMap((result) => result.status === 'listed' || result.status === 'skipped' ? [] : result.steps).filter((step) => step.screenshot === ref);
  if (matchingSteps.length === 0 || matchingSteps.some((step) => step.screenshotOmitted !== undefined)) return { kind: 'not-found' };
  if (ref.includes('\\') || ref.startsWith('/') || /^[A-Za-z]:/.test(ref) || ref.split('/').includes('..')) return { kind: 'not-found' };

  let screenshotPath: string;
  let resolvedScreenshot: string | undefined;
  let resolvedRunDir: string | undefined;
  try {
    screenshotPath = joinPath(deps.projectRoot, ref);
    const runDir = joinPath(deps.runsDir, runId);
    resolvedScreenshot = await deps.storage.realPath(screenshotPath);
    resolvedRunDir = await deps.storage.realPath(runDir);
  } catch (error) {
    if (error instanceof RangeError || isMissingPathError(error)) return { kind: 'not-found' };
    throw error;
  }
  if (resolvedScreenshot === undefined || resolvedRunDir === undefined || !resolvedScreenshot.startsWith(`${resolvedRunDir}/`)) return { kind: 'not-found' };

  try {
    return { kind: 'found', bytes: await deps.storage.readBinary(resolvedScreenshot) };
  } catch (error) {
    if (isMissingPathError(error)) return { kind: 'not-found' };
    throw error;
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function listRunIds(deps: GetRunReportDeps): Promise<readonly string[]> {
  try {
    return await deps.storage.listDirectories(deps.runsDir);
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
}

async function hasRunDirectory(deps: GetRunReportDeps, runId: string): Promise<boolean> {
  return RUN_ID_PATTERN.test(runId) && (await listRunIds(deps)).includes(runId);
}

function reportPath(deps: GetRunReportDeps, runId: string): string {
  return joinPath(joinPath(deps.runsDir, runId), 'report.json');
}

/**
 * Classifies a run report's bytes without checking directory membership.
 *
 * @param deps - Storage and roots used to read the report.
 * @param runId - Run directory name used to locate the report.
 * @returns A `RunListing` classified as `no-report`, `unreadable`, or `readable`.
 * @remarks
 * Only a successful strict parse establishes `exact`; comparing version strings after
 * lenient parsing cannot recover that observation. Command identity takes precedence
 * over version compatibility so reports from other commands cannot enter the legacy
 * run-report path. Missing, non-string, or whitespace-only versions are schema
 * mismatches, preserving `unsupported-version` for readable but unsupported versions.
 */
async function classifyReport(deps: GetRunReportDeps, runId: string): Promise<RunListing> {
  let raw: string;
  try {
    raw = await deps.storage.readText(reportPath(deps, runId));
  } catch (error) {
    return isMissingPathError(error) ? { kind: 'no-report', runId } : { kind: 'unreadable', runId, reason: 'read-error' };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: 'unreadable', runId, reason: 'invalid-json' };
  }

  if (!isRecord(value) || typeof value.command !== 'string') return { kind: 'unreadable', runId, reason: 'schema-mismatch' };
  if (value.command !== 'run') return { kind: 'unreadable', runId, reason: 'not-run-report' };

  const exact = ReportEnvelope.safeParse(value);
  if (exact.success && exact.data.command === 'run') {
    return { kind: 'readable', runId, envelope: exact.data, schemaVersion: exact.data.schemaVersion, exact: true };
  }

  const version = value.schemaVersion;
  if (typeof version !== 'string' || version.trim() === '') return { kind: 'unreadable', runId, reason: 'schema-mismatch' };
  if (!/^3\.\d+$/.test(version)) return { kind: 'unreadable', runId, reason: 'unsupported-version', version };

  const lenient = LenientRunReportEnvelope.safeParse(value);
  if (!lenient.success) return { kind: 'unreadable', runId, reason: 'schema-mismatch' };
  return { kind: 'readable', runId, envelope: lenient.data, schemaVersion: version, exact: false };
}

/** Provides the first classification guard so non-object JSON cannot supply command or version evidence. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
