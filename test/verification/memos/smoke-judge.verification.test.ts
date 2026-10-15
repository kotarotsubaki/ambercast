import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { judgeSmokeReport } from './support/judge.js';

const hasReport = !!process.env.AMBERCAST_VERIFY_MEMOS_REPORT;

describe.skipIf(!hasReport)('smoke-judge.verification', () => {
  it('judges the replay report of the Memos smoke', async () => {
    const report = JSON.parse(readFileSync(process.env.AMBERCAST_VERIFY_MEMOS_REPORT!, 'utf8'));
    const artifactRoots = JSON.parse(process.env.AMBERCAST_VERIFY_MEMOS_ARTIFACT_ROOTS!);
    const secrets = JSON.parse(process.env.AMBERCAST_VERIFY_MEMOS_SECRETS!);
    const mode = process.env.AMBERCAST_VERIFY_MEMOS_MODE === 'disclosure-only' ? 'disclosure-only' : 'full';
    await judgeSmokeReport({ report, artifactRoots, secrets, mode });
  });
});
