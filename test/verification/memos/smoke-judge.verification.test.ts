import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { judgeSmokeReport, parseJudgeEnv } from './support/judge.js';

const hasReport = !!process.env.AMBERCAST_VERIFY_MEMOS_REPORT;
const parsed = hasReport ? parseJudgeEnv(process.env) : undefined;

describe.skipIf(!parsed)('smoke-judge.verification', () => {
  it('judges the replay report of the Memos smoke', async () => {
    if (!parsed) throw new Error('AMBERCAST_VERIFY_MEMOS_REPORT is required');
    const { artifactRoots, secrets, mode, expectedCases } = parsed;
    if (artifactRoots === undefined) throw new Error('AMBERCAST_VERIFY_MEMOS_ARTIFACT_ROOTS is required');
    if (secrets === undefined) throw new Error('AMBERCAST_VERIFY_MEMOS_SECRETS is required');
    const report = JSON.parse(readFileSync(parsed.reportFile, 'utf8'));
    await judgeSmokeReport({
      report, artifactRoots, secrets, mode,
      ...(expectedCases === undefined ? {} : { expectedCases }),
    });
  });
});
