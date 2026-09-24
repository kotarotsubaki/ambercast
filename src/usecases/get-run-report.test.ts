import { describe, expect, it } from 'vitest';
import { ReportEnvelope, REPORT_SCHEMA_VERSION } from '../report/schema.js';
import { createInMemoryStorage } from '../../test/doubles/create-in-memory-storage.js';
import type { StorageAdapter } from '../ports/storage.js';
import { getRunReport, getRunReportBytes, getRunScreenshot, listRunReports, type GetRunReportDeps } from './get-run-report.js';

const projectRoot = '/project';
const runsDir = '/project/.runs';
const encoder = new TextEncoder();

function runEnvelope(steps: readonly Record<string, unknown>[] = []) {
  return ReportEnvelope.parse({
    schemaVersion: REPORT_SCHEMA_VERSION,
    command: 'run',
    startedAt: '2026-09-23T06:40:12Z',
    durationMs: 42,
    summary: { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 },
    errors: [],
    reportPersistence: 'persisted',
    results: [{ id: 'case', file: 'case.test.md', planFile: 'case.ambercast.plan.json', status: 'passed', durationMs: 42, sessions: {}, steps: steps.map((step) => ({ target: 'default', ...step })), explanation: 'Replay completed successfully.' }],
  });
}

function deps(storage = createInMemoryStorage()): GetRunReportDeps {
  return { storage, runsDir, projectRoot };
}

async function putReport(storage: StorageAdapter, runId: string, text: string): Promise<void> {
  await storage.writeText(`${runsDir}/${runId}/report.json`, text);
}

describe('listRunReports', () => {
  it('classifies six compliant directories independently in descending code-unit runId order', async () => {
    const storage = createInMemoryStorage();
    const ids = {
      readableA: '20260923T064012Z-a',
      readableB: '20260923T064012Z-B',
      noReport: '20260923T064011Z-a',
      invalidJson: '20260923T064010Z-a',
      schemaMismatch: '20260923T064009Z-a',
      notRun: '20260923T064008Z-a',
    };
    const envelope = runEnvelope();
    await putReport(storage, ids.readableA, JSON.stringify(envelope));
    await putReport(storage, ids.readableB, JSON.stringify(envelope));
    await storage.ensureDir(`${runsDir}/${ids.noReport}`);
    await putReport(storage, ids.invalidJson, '{not json');
    await putReport(storage, ids.schemaMismatch, JSON.stringify({ command: 'run' }));
    const generate = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      command: 'generate',
      startedAt: '2026-09-23T06:40:12Z',
      durationMs: 42,
      summary: { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0 },
      errors: [],
      results: [],
    };
    expect(ReportEnvelope.safeParse(generate).success).toBe(true);
    await putReport(storage, ids.notRun, JSON.stringify(generate));
    for (const name of ['has_underscore', '.ambercast-tmp-x', '2026 bad']) {
      await putReport(storage, name, JSON.stringify(envelope));
    }

    const listings = await listRunReports(deps(storage));
    expect(listings).toHaveLength(6);
    expect(listings.map((item) => item.runId)).toEqual([
      ids.readableA, ids.readableB, ids.noReport, ids.invalidJson, ids.schemaMismatch, ids.notRun,
    ]);
    expect(listings).toEqual([
      { kind: 'readable', runId: ids.readableA, envelope },
      { kind: 'readable', runId: ids.readableB, envelope },
      { kind: 'no-report', runId: ids.noReport },
      { kind: 'unreadable', runId: ids.invalidJson, reason: 'invalid-json' },
      { kind: 'unreadable', runId: ids.schemaMismatch, reason: 'schema-mismatch' },
      { kind: 'unreadable', runId: ids.notRun, reason: 'not-run-report' },
    ]);
  });

  it('returns an empty list when the runs directory is absent', async () => {
    expect(await listRunReports(deps())).toEqual([]);
  });

  it('rethrows a non-ENOENT directory enumeration failure', async () => {
    const storage = createInMemoryStorage();
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const broken = { ...storage, listDirectories: async () => { throw failure; } };
    await expect(listRunReports(deps(broken))).rejects.toBe(failure);
  });

  it('confines a report read failure to its row', async () => {
    const storage = createInMemoryStorage();
    await putReport(storage, 'readable', JSON.stringify(runEnvelope()));
    await putReport(storage, 'denied', '{}');
    const broken = { ...storage, readText: async (path: string) => {
      if (path === `${runsDir}/denied/report.json`) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return storage.readText(path);
    } };
    expect(await listRunReports(deps(broken))).toEqual([
      { kind: 'readable', runId: 'readable', envelope: runEnvelope() },
      { kind: 'unreadable', runId: 'denied', reason: 'read-error' },
    ]);
  });

  it('treats a run with only a temporary report file as no-report', async () => {
    const storage = createInMemoryStorage();
    await storage.writeText(`${runsDir}/midwrite/.ambercast-tmp-random`, '{partial');
    expect(await listRunReports(deps(storage))).toEqual([{ kind: 'no-report', runId: 'midwrite' }]);
  });
});

describe('getRunReport and getRunReportBytes', () => {
  it.each(['../x', 'a b', 'x/y'])('rejects invalid runId %s before directory enumeration', async (runId) => {
    const storage = createInMemoryStorage();
    const broken = { ...storage, listDirectories: async () => { throw new Error('directory lookup attempted'); } };
    await expect(getRunReport(deps(broken), runId)).resolves.toEqual({ kind: 'not-found' });
    await expect(getRunReportBytes(deps(broken), runId)).resolves.toEqual({ kind: 'not-found' });
  });

  it('rejects an absent run and a regular file with a valid runId', async () => {
    const storage = createInMemoryStorage();
    await storage.writeText(`${runsDir}/file-run`, 'not a directory');
    for (const runId of ['absent-run', 'file-run']) {
      expect(await getRunReport(deps(storage), runId)).toEqual({ kind: 'not-found' });
      expect(await getRunReportBytes(deps(storage), runId)).toEqual({ kind: 'not-found' });
    }
  });

  it('classifies an empty run directory as no-report and its raw bytes as absent', async () => {
    const storage = createInMemoryStorage();
    await storage.ensureDir(`${runsDir}/empty-run`);
    expect(await getRunReport(deps(storage), 'empty-run')).toEqual({ kind: 'no-report', runId: 'empty-run' });
    expect(await getRunReportBytes(deps(storage), 'empty-run')).toEqual({ kind: 'not-found' });
  });

  it.each([
    ['readable', JSON.stringify(runEnvelope(), null, 2) + '\n'],
    ['unreadable', ' {not json\n'],
  ])('returns byte-identical persisted content for a %s report', async (runId, content) => {
    const storage = createInMemoryStorage();
    await putReport(storage, runId, content);
    const result = await getRunReportBytes(deps(storage), runId);
    expect(result).toEqual({ kind: 'found', bytes: encoder.encode(content) });
  });
});

describe('getRunScreenshot', () => {
  const runId = 'screenshots-run';
  const ref = `.runs/${runId}/case/step.png`;
  const imagePath = `${projectRoot}/${ref}`;
  const png = new Uint8Array([137, 80, 78, 71, 0, 255]);

  async function screenshotFixture(steps: readonly Record<string, unknown>[]) {
    const storage = createInMemoryStorage();
    await putReport(storage, runId, JSON.stringify(runEnvelope(steps)));
    await storage.writeBinary(imagePath, png);
    return deps(storage);
  }

  it('returns exact bytes for a referenced image strictly inside the run directory', async () => {
    const fixture = await screenshotFixture([{ id: 'step', type: 'capture', status: 'passed', screenshot: ref }]);
    expect(await getRunScreenshot(fixture, runId, ref)).toEqual({ kind: 'found', bytes: png });
  });

  it('rejects a ref absent from every step even if that image exists on disk', async () => {
    const fixture = await screenshotFixture([{ id: 'step', type: 'capture', status: 'passed' }]);
    expect(await getRunScreenshot(fixture, runId, ref)).toEqual({ kind: 'not-found' });
  });

  it('rejects a ref omitted on the same step', async () => {
    const fixture = await screenshotFixture([{ id: 'step', type: 'capture', status: 'passed', screenshot: ref, screenshotOmitted: 'secret-detected' }]);
    expect(await getRunScreenshot(fixture, runId, ref)).toEqual({ kind: 'not-found' });
  });

  it('rejects a shared ref when a sibling step marks it omitted', async () => {
    const fixture = await screenshotFixture([
      { id: 'first', type: 'capture', status: 'passed', screenshot: ref },
      { id: 'second', type: 'capture', status: 'passed', screenshot: ref, screenshotOmitted: 'secret-detected' },
    ]);
    expect(await getRunScreenshot(fixture, runId, ref)).toEqual({ kind: 'not-found' });
  });

  it.each(['../step.png', '/project/.runs/screenshots-run/case/step.png', 'a\\step.png', 'C:step.png', './step.png', 'a//step.png'])(
    'rejects unsafe or non-normalized ref %s', async (candidate) => {
      const fixture = await screenshotFixture([{ id: 'step', type: 'capture', status: 'passed', screenshot: candidate }]);
      expect(await getRunScreenshot(fixture, runId, candidate)).toEqual({ kind: 'not-found' });
    },
  );

  it('rejects a screenshot when its report is unreadable', async () => {
    const storage = createInMemoryStorage();
    await putReport(storage, runId, '{not json');
    await storage.writeBinary(imagePath, png);
    expect(await getRunScreenshot(deps(storage), runId, ref)).toEqual({ kind: 'not-found' });
  });

  it('rejects a referenced image outside the run directory', async () => {
    const outside = '.runs/other-run/case/step.png';
    const fixture = await screenshotFixture([{ id: 'step', type: 'capture', status: 'passed', screenshot: outside }]);
    expect(await getRunScreenshot(fixture, runId, outside)).toEqual({ kind: 'not-found' });
  });

  it('rejects a referenced image whose path is missing', async () => {
    const fixture = await screenshotFixture([{ id: 'step', type: 'capture', status: 'passed', screenshot: 'missing.png' }]);
    expect(await getRunScreenshot(fixture, runId, 'missing.png')).toEqual({ kind: 'not-found' });
  });
});
