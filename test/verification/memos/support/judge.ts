/**
 * judge.ts — TypeScript judge wrapper around #547's helpers
 *
 * Run through vitest from verify-memos.mjs as a child process.
 * The harness script (plain Node, no transpile) cannot import TS directly,
 * so verify-memos.mjs shells out to vitest instead.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ReportEnvelope } from '#report/schema.js';
import * as reportAssertions from '../../../support/report-assertions.js';
import { createFsStorage } from '#adapters/storage/fs-storage.js';

/**
 * Input to {@link judgeSmokeReport}.
 */
export interface JudgeSmokeReportInput {
  /**
   * The report envelope to judge, typically the run result from a smoke replay.
   */
  report: unknown;
  /**
   * Storage paths to scan for secret disclosure (directories or files).
   */
  artifactRoots: readonly string[];
  /**
   * Labeled secret values to detect in the report and artifacts.
   */
  secrets: Record<string, string>;
  /**
   * Execution mode: `'full'` (the default) performs all checks including identity
   * verification; `'disclosure-only'` skips identity and diagnostic checks,
   * running only artifact collection and secret disclosure detection (so a replay
   * that fails earlier assertions still reveals whether secrets leaked into
   * storage artifacts).
   */
  mode?: 'full' | 'disclosure-only';
}

/**
 * Judges a smoke-report envelope against the expected contract and secret constraints.
 *
 * @param input - The report and context to judge.
 * @returns void on success; throws an aggregated violation message otherwise.
 * @throws When `report` fails schema validation, lacks diagnosable evidence, contains
 *   nonzero AI calls, or discloses any secret in `secrets` (in report text or artifact
 *   bytes); also when storage reads fail. The error message format is
 *   `judgeSmokeReport: <n> violation(s)` followed by `- ` prefixed violation lines.
 * @remarks
 * The function implements two distinct execution modes selected by `mode`.
 *
 * In `full` mode (the default), the function first verifies report identity: it locates
 * the latest-mtime `report.json` under the `.runs/` paths in `artifactRoots`.
 * ReportEnvelope carries no `runId`, so only SPEC-10's latest-mtime fallback
 * is reachable. No persisted report is an identity violation. It then deep-equals
 * that persisted report against the passed `report` **before** collecting storage artifacts,
 * enforcing the required ordering for TEST-44. Only after identity verification does it
 * proceed through the assertion chain: `assertDiagnosable` (schema + evidence), `assertZeroAiCalls`,
 * summary counts (total 1, passed 1, exactly one `status: 'passed'`), and finally
 * `assertNoSecretDisclosure` over the collected artifacts.
 * Only an identity violation skips artifact collection and disclosure detection;
 * diagnostic, AI-call, and summary violations still accumulate with disclosure violations.
 *
 * In `disclosure-only` mode, the function skips identity verification, `assertDiagnosable`,
 * `assertZeroAiCalls`, and the summary/count checks entirely. It still collects artifacts
 * and runs `assertNoSecretDisclosure` only. This enables secret-leak detection even when
 * prior assertions have already failed, so a non-zero replay still reveals whether any
 * secrets leaked into storage snapshots.
 *
 * All violations are accumulated and reported together in a single aggregated error with
 * the shared format used by #547's assertion helpers. Storage adapter read failures are
 * wrapped with the `judgeSmokeReport: cannot read <path>: <message>` prefix to distinguish
 * them from assertion violations.
 */
export async function judgeSmokeReport(input: JudgeSmokeReportInput): Promise<void> {
  const { report, artifactRoots, secrets, mode = 'full' } = input;

  const violations: string[] = [];
  let identityViolation: string | null = null;

  if (mode === 'full') {
    // Identity verification: find latest-mtime report.json under .runs/
    identityViolation = findAndCompareLatestReport(report, artifactRoots);
    if (identityViolation !== null) {
      violations.push(identityViolation);
    }

    // assertDiagnosable
    try {
      reportAssertions.assertDiagnosable(report);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      violations.push(message);
    }

    // assertZeroAiCalls
    try {
      reportAssertions.assertZeroAiCalls(report);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      violations.push(message);
    }

    // Summary checks: total===1, passed===1, exactly one status:'passed'
    const parseResult = ReportEnvelope.safeParse(report);
    if (parseResult.success) {
      const parsed = parseResult.data;
      const summary = parsed.summary;

      if (summary.total !== 1) {
        violations.push(`summary.total is ${summary.total}, expected 1`);
      }
      if (summary.passed !== 1) {
        violations.push(`summary.passed is ${summary.passed}, expected 1`);
      }

      const passedResults = parsed.results.filter(r => 'status' in r && r.status === 'passed');
      if (passedResults.length !== 1) {
        violations.push(`exactly one result with status:'passed' expected, found ${passedResults.length}`);
      }
    } else {
      // Schema validation failed already handled by assertDiagnosable
    }
  }

  // Identity alone gates disclosure checks so unrelated violations do not hide leaks.
  if (identityViolation === null) {
    let artifacts: reportAssertions.ScannedArtifact[] = [];
    try {
      artifacts = await reportAssertions.collectStorageArtifacts(createFsStorage(), artifactRoots);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Storage read failures use the judge prefix directly
      throw new Error(`judgeSmokeReport: cannot read <path>: ${message}`);
    }

    // assertNoSecretDisclosure
    try {
      reportAssertions.assertNoSecretDisclosure({ secrets, report, artifacts });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      violations.push(message);
    }
  }

  if (violations.length > 0) {
    const message = `judgeSmokeReport: ${violations.length} violation(s)\n${violations.map(v => `- ${v}`).join('\n')}`;
    throw new Error(message);
  }
}

/**
 * Finds the latest-mtime report.json under .runs/ in artifactRoots and compares it to the given report.
 * Returns a violation message or null if identity is verified.
 */
function findAndCompareLatestReport(report: unknown, artifactRoots: readonly string[]): string | null {
  // Find all .runs directories and their report.json files
  const reportFiles: { path: string; mtime: number }[] = [];

  for (const root of artifactRoots) {
    // Walk the directory tree looking for .runs directories
    const runsDir = join(root, '.runs');
    if (!existsSync(runsDir)) {
      continue;
    }

    // List all subdirectories of .runs (each should contain a report.json)
    const entries = readDirSync(runsDir);
    for (const entry of entries) {
      const entryPath = join(runsDir, entry);
      const reportPath = join(entryPath, 'report.json');

      if (existsSync(reportPath)) {
        try {
          const mtime = statSync(reportPath).mtimeMs;
          reportFiles.push({ path: reportPath, mtime });
        } catch {
          // Skip files we can't stat
        }
      }
    }
  }

  if (reportFiles.length === 0) {
    return 'no persisted report found in .runs directory';
  }

  // Find the latest-mtime report
  reportFiles.sort((a, b) => b.mtime - a.mtime);
  const latest = reportFiles[0]!;

  // Read and parse the persisted report
  let persistedReport: unknown;
  try {
    const content = readFileSync(latest.path, 'utf8');
    persistedReport = JSON.parse(content);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return `cannot read ${JSON.stringify(latest.path)}: ${message}`;
  }

  // Deep equal comparison
  if (JSON.stringify(report) !== JSON.stringify(persistedReport)) {
    return `persisted report differs from provided report`;
  }

  return null;
}

// Node.js fs sync helpers
function existsSync(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function readDirSync(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
  } catch {
    return [];
  }
}
