import { describe, expect, it, vi } from 'vitest';
import { getRunReport, listRunReports, type GetRunReportDeps } from '#usecases/get-run-report.js';

const runId = 'run-legacy-312';
const legacy = {
  schemaVersion: '3.12', command: 'run', startedAt: '2026-11-26T00:00:00Z', durationMs: 1,
  summary: { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 },
  errors: [], reportPersistence: 'persisted',
  results: [{
    id: 'login', file: 'login.test.md', planFile: 'login.ambercast.plan.json',
    status: 'passed', durationMs: 1, aiCalls: 0, sessions: {}, explanation: 'The case passed.',
    steps: [{ id: 'submit', type: 'action', target: 'web', status: 'passed', binding: { provenance: 'grounding', confirmed: true } }],
  }],
};

function deps(): GetRunReportDeps {
  return {
    projectRoot: '/project', runsDir: '/project/.runs',
    storage: {
      listDirectories: vi.fn().mockResolvedValue([runId]),
      readText: vi.fn().mockResolvedValue(JSON.stringify(legacy)),
      readBinary: vi.fn().mockResolvedValue(new Uint8Array()),
      realPath: vi.fn().mockImplementation(async (path: string) => path),
    },
  };
}

describe('stored run compatibility after neighbor reporting changes', () => {
  it('reads a stored 3.12 detail through compatibility without synthesizing evidence', async () => {
    const result = await getRunReport(deps(), runId);
    expect(result.kind).toBe('readable');
    if (result.kind !== 'readable') throw new Error('Expected stored run to be readable.');
    expect.soft(result.exact).toBe(false);
    expect(result.schemaVersion).toBe('3.12');
    expect(result.envelope).toEqual(legacy);
    const row = result.envelope.results[0];
    expect(row).not.toHaveProperty('warnings');
    expect(row).toHaveProperty('steps.0.binding', { provenance: 'grounding', confirmed: true });
    expect(row).not.toHaveProperty('steps.0.binding.ignoredNames');
    expect(row).not.toHaveProperty('steps.0.difference');
    expect(row).not.toHaveProperty('steps.0.changedNames');
  });

  it('uses the same compatible projection in the run listing', async () => {
    const results = await listRunReports(deps());
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ kind: 'readable', runId, schemaVersion: '3.12', exact: false, envelope: legacy });
  });
});
