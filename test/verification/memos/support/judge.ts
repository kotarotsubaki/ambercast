/**
 * judge.ts — TypeScript judge wrapper around #547's helpers
 *
 * Run through vitest from verify-memos.mjs as a child process.
 * The harness script (plain Node, no transpile) cannot import TS directly,
 * so verify-memos.mjs shells out to vitest instead.
 */

import { deepStrictEqual } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ReportEnvelope } from '#report/schema.js';
import * as reportAssertions from '../../../support/report-assertions.js';
import { createFsStorage } from '#adapters/storage/fs-storage.js';

/**
 * Parses judge configuration without reading the report or storage artifacts.
 *
 * @returns The configuration, or undefined when no report path is supplied.
 * @throws When the mode, full-mode case count, or supplied JSON is invalid.
 */
export function parseJudgeEnv(env: NodeJS.ProcessEnv) {
  const reportFile = env.AMBERCAST_VERIFY_MEMOS_REPORT;
  if (!reportFile) return undefined;

  const mode = env.AMBERCAST_VERIFY_MEMOS_MODE ?? 'full';
  if (mode !== 'full' && mode !== 'disclosure-only' && mode !== 'heal-report') {
    throw new Error('Invalid AMBERCAST_VERIFY_MEMOS_MODE');
  }
  let expectedCases: number | undefined;
  if (mode === 'full') {
    const value = env.AMBERCAST_VERIFY_MEMOS_EXPECTED_CASES;
    if (value === undefined || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new Error('AMBERCAST_VERIFY_MEMOS_EXPECTED_CASES must be a safe positive decimal integer');
    }
    expectedCases = Number(value);
  }
  return {
    reportFile,
    artifactRoots: env.AMBERCAST_VERIFY_MEMOS_ARTIFACT_ROOTS === undefined
      ? undefined : JSON.parse(env.AMBERCAST_VERIFY_MEMOS_ARTIFACT_ROOTS) as string[],
    secrets: env.AMBERCAST_VERIFY_MEMOS_SECRETS === undefined
      ? undefined : JSON.parse(env.AMBERCAST_VERIFY_MEMOS_SECRETS) as Record<string, string>,
    mode: mode as NonNullable<JudgeSmokeReportInput['mode']>,
    ...(expectedCases === undefined ? {} : { expectedCases }),
  };
}

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
   * Full mode requires a .runs directory path containing persisted replay reports.
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
   * storage artifacts). `'heal-report'` checks only the heal envelope,
   * diagnosability, and disclosure in the report itself.
   */
  mode?: 'full' | 'disclosure-only' | 'heal-report';
  /** The positive integer number of passing replay cases expected; defaults to 1. */
  expectedCases?: number;
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
 * The function supports replay, artifact-disclosure, and heal-report checks.
 *
 * In `full` mode (the default), the supplied report must match the latest persisted
 * report. ReportEnvelope carries no `runId`, so modification time determines
 * identity. A missing persisted report is an identity violation. Acceptance also
 * requires diagnosable evidence, zero AI calls, the expected passing case count,
 * and no secret disclosure in the report or collected artifacts.
 * Only an identity violation skips artifact collection and disclosure detection;
 * diagnostic, AI-call, and summary violations still accumulate with disclosure violations.
 *
 * In `disclosure-only` mode, the function skips identity verification, `assertDiagnosable`,
 * `assertZeroAiCalls`, and the summary/count checks entirely. It still collects artifacts
 * and runs `assertNoSecretDisclosure` only. This enables secret-leak detection even when
 * prior assertions have already failed, so a non-zero replay still reveals whether any
 * secrets leaked into storage snapshots.
 *
 * In `heal-report` mode, storage is not read. The report must conform to
 * ReportEnvelope with command `heal`, be diagnosable, and disclose no secrets.
 * Invalid `expectedCases` throws TypeError for nonnumbers or RangeError for
 * numbers that are not positive integers, before any report or storage checks.
 *
 * All violations are accumulated and reported together in a single aggregated error with
 * the shared format used by #547's assertion helpers. Storage adapter read failures are
 * wrapped with the `judgeSmokeReport: cannot read <path>: <message>` prefix to distinguish
 * them from assertion violations.
 */
export async function judgeSmokeReport(input: JudgeSmokeReportInput): Promise<void> {
  const { report, artifactRoots, secrets, mode = 'full', expectedCases = 1 } = input;
  if (typeof expectedCases !== 'number') {
    throw new TypeError('expectedCases must be a number');
  }
  if (!Number.isInteger(expectedCases) || expectedCases <= 0) {
    throw new RangeError('expectedCases must be a positive integer');
  }

  const violations: string[] = [];
  let identityViolation: string | null = null;

  if (mode === 'heal-report') {
    const parsed = ReportEnvelope.safeParse(report);
    if (!parsed.success) {
      violations.push('report does not conform to ReportEnvelope');
    } else if (parsed.data.command !== 'heal') {
      violations.push('report command must be heal');
    }
    try {
      reportAssertions.assertDiagnosable(report);
    } catch (e) {
      violations.push(e instanceof Error ? e.message : String(e));
    }
    try {
      reportAssertions.assertNoSecretDisclosure({ secrets, report, artifacts: [] });
    } catch (e) {
      violations.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (mode === 'full') {
    identityViolation = findAndCompareLatestReport(report, artifactRoots);
    if (identityViolation !== null) {
      violations.push(identityViolation);
    }

    try {
      reportAssertions.assertDiagnosable(report);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      violations.push(message);
    }

    try {
      reportAssertions.assertZeroAiCalls(report);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      violations.push(message);
    }

    const parseResult = ReportEnvelope.safeParse(report);
    if (parseResult.success) {
      const parsed = parseResult.data;
      const summary = parsed.summary;

      if (summary.total !== expectedCases) {
        violations.push(`summary.total is ${summary.total}, expected ${expectedCases}`);
      }
      if (summary.passed !== expectedCases) {
        violations.push(`summary.passed is ${summary.passed}, expected ${expectedCases}`);
      }

      const passedResults = parsed.results.filter(r => 'status' in r && r.status === 'passed');
      if (passedResults.length !== expectedCases) {
        violations.push(`${expectedCases === 1 ? 'exactly one' : `exactly ${expectedCases}`} result with status:'passed' expected, found ${passedResults.length}`);
      }
      if (parsed.results.length !== expectedCases) {
        violations.push(`results.length is ${parsed.results.length}, expected ${expectedCases}`);
      }
    } else {
      // assertDiagnosable owns schema diagnostics, avoiding duplicate violations.
    }
  }

  // Identity alone gates disclosure checks so unrelated violations do not hide leaks.
  if (mode !== 'heal-report' && identityViolation === null) {
    let artifacts: reportAssertions.ScannedArtifact[] = [];
    try {
      artifacts = await reportAssertions.collectStorageArtifacts(createFsStorage(), artifactRoots);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`judgeSmokeReport: cannot read <path>: ${message}`);
    }

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
 * Finds the latest-mtime report.json in the .runs directory roots and compares it to the given report.
 * Returns a violation message or null if identity is verified.
 */
function findAndCompareLatestReport(report: unknown, artifactRoots: readonly string[]): string | null {
  const reportFiles: { path: string; mtime: number }[] = [];

  for (const root of artifactRoots) {
    // Roots already identify artifacts; file roots have no run subdirectories.
    const runsDir = root;
    if (!existsSync(runsDir)) {
      continue;
    }

    const entries = readDirSync(runsDir);
    for (const entry of entries) {
      const entryPath = join(runsDir, entry);
      const reportPath = join(entryPath, 'report.json');

      if (existsSync(reportPath)) {
        try {
          const mtime = statSync(reportPath).mtimeMs;
          reportFiles.push({ path: reportPath, mtime });
        } catch {
        }
      }
    }
  }

  if (reportFiles.length === 0) {
    return 'no persisted report found in .runs directory';
  }

  reportFiles.sort((a, b) => b.mtime - a.mtime);
  const latest = reportFiles[0]!;

  let persistedReport: unknown;
  try {
    const content = readFileSync(latest.path, 'utf8');
    persistedReport = JSON.parse(content);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return `cannot read ${JSON.stringify(latest.path)}: ${message}`;
  }

  try {
    deepStrictEqual(report, persistedReport);
  } catch {
    return `persisted report differs from provided report`;
  }

  return null;
}

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
