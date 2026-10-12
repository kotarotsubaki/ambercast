import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_URL, MEMOS_IMAGE, PORT, HarnessError, assertPortFree, bootstrapAdmin,
  createDockerRunner, createExec, createRunRoot, generateAdminPassword,
  runProcess, waitReady,
// @ts-expect-error The production ESM script is deliberately untyped JavaScript.
} from '../../../scripts/lib/memos-harness.mjs';

const runner = createDockerRunner(createExec(runProcess));
const clock = { now: () => performance.now(), sleep };
type RunRoot = ReturnType<typeof createRunRoot>;

async function start(run: RunRoot) {
  await runner.startContainer({
    runId: run.runId, name: run.containerName, data: run.dataDir,
    uid: process.getuid!(), gid: process.getgid!(),
  });
  const elapsed = await waitReady({
    fetch, runner, name: run.containerName, clock, timeoutMs: 30_000,
  });
  expect(elapsed).toBeLessThanOrEqual(30_000);
}

async function bootstrap() {
  const requests: string[] = [];
  let hasAccessToken = false;
  // Observe real responses without retaining credentials or consuming the helper's body.
  const observedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const path = new URL(String(input)).pathname;
    requests.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/api/v1/auth/signin') {
      const body = await response.clone().json();
      hasAccessToken = typeof body.accessToken === 'string' && body.accessToken.length > 0;
    }
    return response;
  };
  await bootstrapAdmin({ fetch: observedFetch, username: 'verifier', password: generateAdminPassword() });
  expect(requests).toEqual([
    'GET /api/v1/instance/profile', 'POST /api/v1/users', 'POST /api/v1/auth/signin',
  ]);
  expect(hasAccessToken).toBe(true);
}

async function teardown(run: RunRoot) {
  // A failed Docker removal must not prevent attempting filesystem cleanup.
  try {
    await runner.removeContainer(run.containerName);
  } finally {
    rmSync(run.runRoot, { recursive: true, force: true });
  }
}

describe('lifecycle.verification', () => {
  let skipReason: string | undefined;
  beforeAll(async () => {
    try {
      await runner.checkDaemon();
    } catch (error) {
      const reason = `Docker daemon unavailable: ${error instanceof Error ? error.message : String(error)}`;
      console.warn(reason);
      skipReason = reason;
      return;
    }
    try {
      await assertPortFree(PORT);
    } catch (error) {
      if (!(error instanceof HarnessError) || (error as { stage: string }).stage !== 'port') throw error;
      console.warn((error as Error).message);
      skipReason = (error as Error).message;
      return;
    }
    if (!(await runner.hasImage(MEMOS_IMAGE))) await runner.pullImage(MEMOS_IMAGE);
  });

  it('TEST-60 real Docker lifecycle: start, readiness, bootstrap', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const run = createRunRoot(tmpdir(), randomBytes);
    try {
      await start(run);
      await bootstrap();
    } finally {
      await teardown(run);
    }
  });

  it('TEST-61 real Docker lifecycle: teardown, data isolation, MEMOS_RATE_LIMIT env', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const first = createRunRoot(tmpdir(), randomBytes);
    try {
      await start(first);
      await bootstrap();
    } finally {
      await teardown(first);
    }
    expect(existsSync(first.dataDir)).toBe(false);

    const second = createRunRoot(tmpdir(), randomBytes);
    try {
      expect(second.runId).not.toBe(first.runId);
      expect(second.containerName).not.toBe(first.containerName);
      await start(second);
      const response = await fetch(`${BASE_URL}/api/v1/instance/profile`, {
        signal: AbortSignal.timeout(5_000),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).needsSetup).toBe(true);
      expect(await runner.inspectEnv(second.containerName)).toContain('MEMOS_RATE_LIMIT=false');
      await bootstrap();
    } finally {
      await teardown(second);
    }
    expect(await runner.listContainers()).toEqual([]);
    expect(existsSync(second.dataDir)).toBe(false);
  });

  it('TEST-75 real Docker lifecycle: Memos reset remounts onto a fresh data-reset path, not the same one', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const run = createRunRoot(tmpdir(), randomBytes);
    const password = generateAdminPassword();
    try {
      await start(run);
      await bootstrapAdmin({ fetch, username: 'verifier', password });
      // Remount onto a fresh path (the GAP fix this test guards): deleting
      // and immediately re-mounting the SAME host path crashes Memos with
      // SQLITE_CANTOPEN on macOS/OrbStack.
      await runner.removeContainer(run.containerName);
      const resetDataDir = join(run.runRoot, 'data-reset');
      mkdirSync(resetDataDir);
      rmSync(run.dataDir, { recursive: true, force: true });
      const resetRun = { ...run, dataDir: resetDataDir };
      await start(resetRun);
      const profile = await fetch(`${BASE_URL}/api/v1/instance/profile`, { signal: AbortSignal.timeout(5_000) });
      expect(profile.status).toBe(200);
      expect((await profile.json()).needsSetup).toBe(true);
      await bootstrapAdmin({ fetch, username: 'verifier', password });
    } finally {
      await teardown(run);
    }
    expect(await runner.listContainers()).toEqual([]);
    expect(existsSync(run.runRoot)).toBe(false);
  });
});
