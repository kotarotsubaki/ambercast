import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFsStorage } from '../../src/adapters/storage/fs-storage.js';
import { REPORT_SCHEMA_VERSION, ReportEnvelope } from '../../src/report/schema.js';
import { getRunScreenshot } from '../../src/usecases/get-run-report.js';

const runId = '20260923T064012Z-screenshot';
const png = new Uint8Array([137, 80, 78, 71, 0, 255]);

async function withRun(
  assertion: (fixture: { projectRoot: string; runsDir: string; runDir: string; ref: string }) => Promise<void>,
): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'ambercast-screenshot-contract-'));
  const runsDir = join(projectRoot, '.runs');
  const runDir = join(runsDir, runId);
  const ref = `.runs/${runId}/case/step.png`;

  try {
    await mkdir(join(runDir, 'case'), { recursive: true });
    const envelope = ReportEnvelope.parse({
      schemaVersion: REPORT_SCHEMA_VERSION,
      command: 'run',
      startedAt: '2026-09-23T06:40:12Z',
      durationMs: 42,
      summary: { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 },
      errors: [],
      reportPersistence: 'persisted',
      results: [{
        id: 'case', file: 'case.test.md', planFile: 'case.ambercast.plan.json',
        status: 'passed', durationMs: 42, sessions: {}, explanation: 'Replay completed successfully.',
        steps: [{ id: 'step', type: 'capture', target: 'default', status: 'passed', screenshot: ref }],
      }],
    });
    await writeFile(join(runDir, 'report.json'), JSON.stringify(envelope));
    await writeFile(join(projectRoot, ref), png);
    await assertion({ projectRoot, runsDir, runDir, ref });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

describe('getRunScreenshot with real filesystem paths', () => {
  it('returns the exact bytes of a referenced image inside the run', async () => {
    await withRun(async ({ projectRoot, runsDir, ref }) => {
      await expect(getRunScreenshot({ storage: createFsStorage(), projectRoot, runsDir }, runId, ref))
        .resolves.toEqual({ kind: 'found', bytes: png });
    });
  });

  it('rejects a referenced image that escapes the run through a symlink', async () => {
    await withRun(async ({ projectRoot, runsDir, runDir, ref }) => {
      const escapedRef = `.runs/${runId}/case/escape/outside.png`;
      const outsidePath = join(projectRoot, 'outside.png');
      await writeFile(outsidePath, png);
      await symlink(projectRoot, join(runDir, 'case', 'escape'), 'dir');
      const reportPath = join(runDir, 'report.json');
      const envelope = JSON.parse(await readFile(reportPath, 'utf8'));
      envelope.results[0].steps[0].screenshot = escapedRef;
      await writeFile(reportPath, JSON.stringify(ReportEnvelope.parse(envelope)));

      expect(escapedRef).not.toBe(ref);
      await expect(getRunScreenshot({ storage: createFsStorage(), projectRoot, runsDir }, runId, escapedRef))
        .resolves.toEqual({ kind: 'not-found' });
    });
  });

  it('propagates a non-ENOENT binary read error', async (context) => {
    if (process.getuid?.() === 0) {
      context.skip('Root can read files after chmod removes read permission.');
      return;
    }

    await withRun(async ({ projectRoot, runsDir, ref }) => {
      const imagePath = join(projectRoot, ref);
      try {
        await chmod(imagePath, 0o000);
        let readError: unknown;
        try {
          await readFile(imagePath);
        } catch (error) {
          readError = error;
        }
        if (readError === undefined) {
          context.skip('File permissions are not enforced; cannot exercise a binary read error.');
          return;
        }
        expect(readError).toMatchObject({ code: 'EACCES' });
        await expect(getRunScreenshot({ storage: createFsStorage(), projectRoot, runsDir }, runId, ref))
          .rejects.toMatchObject({ code: 'EACCES' });
      } finally {
        await chmod(imagePath, 0o600);
      }
    });
  });
});
