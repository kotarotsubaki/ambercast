/*
 * Centralizes fixed viewer copy so the list, detail, and error templates use
 * one vocabulary that contract tests can compare with rendered output.
 * Report-derived text remains separate and must be HTML-escaped by renderers;
 * these constants are trusted copy, not a path for unescaped report content.
 */

/** Fixed English labels and messages for the viewer's deterministic UI. */
export const VIEW_COPY = {
  list: {
    title: 'Runs',
    columnHeaders: {
      status: 'Status',
      run: 'Run',
      started: 'Started (UTC)',
      duration: 'Duration',
      cases: 'Cases',
    },
    rowStatus: {
      failed: '✗ Failed',
      error: '! Error',
      passed: '✓ Passed',
      empty: '– Empty',
      noReport: '! No report',
      unreadable: '! Unreadable',
    },
    cases: {
      evidenceOnly: 'Evidence only',
      unreadableReasons: {
        invalidJson: 'Invalid JSON',
        schemaMismatch: 'Schema mismatch',
        notRunReport: 'Not a run report',
        readFailed: 'Read failed',
      },
    },
    runLinks: {
      openRun: 'Open run',
      rawJson: 'Raw JSON',
    },
    emptyState: {
      line1: 'No runs yet',
      line2: 'Run a test: ambercast run',
    },
  },
  detail: {
    header: {
      started: 'Started',
      duration: 'Duration',
      reportPersisted: 'Report: persisted',
      reportFailed: 'Report: failed',
      rawJson: 'Raw JSON',
    },
    runErrors: {
      headingPrefix: 'Errors (',
    },
    emptyCases: 'No cases were executed',
    case: {
      aiCallsSuffix: ' AI calls',
    },
    caseAuxiliary: {
      plan: 'Plan',
      id: 'Id',
      explanation: 'Explanation',
    },
    stepTable: {
      columnHeaderNumber: '#',
      columnHeaderStep: 'Step',
      columnHeaderType: 'Type',
      columnHeaderStatus: 'Status',
    },
    failedStep: {
      expected: 'Expected',
      actual: 'Actual',
      screenshotOmitted: 'Screenshot omitted: secret detected',
    },
    snapshotAltPrefix: 'Screenshot of step ',
    snapshotDetails: {
      summary: 'Snapshot',
    },
    listedSkipped: {
      listedPrefix: '· Listed ',
      skippedPrefix: '– Skipped ',
    },
    unreadable: {
      heading: 'Unreadable report',
      rawJson: 'Raw JSON',
    },
  },
  errorPages: {
    notFound: {
      title: 'Not found',
      noRunPrefix: 'No run "',
      noRunSuffix: '"',
      noSuchPage: 'No such page',
    },
    forbidden: {
      title: 'Forbidden',
      message: 'Host header not allowed',
    },
    methodNotAllowed: {
      title: 'Method not allowed',
      message: 'Use GET',
    },
    serverError: {
      title: 'Read failed',
      message: 'Reload to retry',
    },
  },
  cli: {
    startupPrefix: 'Listening on http://',
    startupSuffix: '/',
    warningPrefix: 'Warning: reachable without authentication at http://',
    warningSuffix: '/',
  },
  pageHeader: {
    brand: 'ambercast',
  },
} as const;
